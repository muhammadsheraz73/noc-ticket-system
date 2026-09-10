import { Router } from 'express';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import Connection from '../models/Connection.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadSpreadsheet } from '../middleware/upload.js';
import { customerSchema, customerUpdateSchema, importCommitSchema, importPreviewSchema } from '../validators/schemas.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex, parsePagination, parseSort } from '../utils/search.js';
import { ROLES, CUSTOMER_TYPES } from '../utils/constants.js';
import {
  parseWorkbook,
  suggestMapping,
  validateRows,
  importRows,
  buildTemplateWorkbook,
  IMPORTABLE_FIELDS,
} from '../services/importService.js';
import { decorateTicket } from '../services/ticketService.js';

const router = Router();
router.use(requireAuth);

const canWrite = requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR);

/** GET /api/customers/meta — form metadata (types, importable fields). */
router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const types = await Customer.distinct('type', { isDeleted: false });
    res.json({
      success: true,
      types: [...new Set([...CUSTOMER_TYPES, ...types.filter(Boolean)])],
      importableFields: IMPORTABLE_FIELDS,
    });
  }),
);

/** GET /api/customers/import/template — downloadable .xlsx template. */
router.get(
  '/import/template',
  canWrite,
  asyncHandler(async (_req, res) => {
    const buffer = buildTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
    res.send(buffer);
  }),
);

/** POST /api/customers/import/upload — parse the workbook and suggest a mapping. */
router.post(
  '/import/upload',
  canWrite,
  (req, res, next) => uploadSpreadsheet(req, res, (err) => (err ? next(err) : next())),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Please choose a spreadsheet to upload');

    const { headers, rows, sheetName, sheetNames } = parseWorkbook(req.file.buffer);
    const mapping = suggestMapping(headers);
    const validation = await validateRows(rows.slice(0, 200), mapping);

    res.json({
      success: true,
      fileName: req.file.originalname,
      sheetName,
      sheetNames,
      headers,
      rows,
      totalRows: rows.length,
      mapping,
      importableFields: IMPORTABLE_FIELDS,
      preview: validation.rows.slice(0, 50),
      summary: validation.summary,
    });
  }),
);

/** POST /api/customers/import/preview — re-validate after the user edits the mapping. */
router.post(
  '/import/preview',
  canWrite,
  validate(importPreviewSchema),
  asyncHandler(async (req, res) => {
    const validation = await validateRows(req.body.rows, req.body.mapping);
    res.json({
      success: true,
      preview: validation.rows.slice(0, 100),
      summary: validation.summary,
    });
  }),
);

/** POST /api/customers/import — commit the import and return a result report. */
router.post(
  '/import',
  canWrite,
  validate(importCommitSchema),
  asyncHandler(async (req, res) => {
    const { rows, mapping, duplicateStrategy } = req.body;
    const result = await importRows({ rows, mapping, duplicateStrategy, user: req.user });

    await recordAudit({
      req,
      action: 'import_customers',
      entityType: 'Customer',
      entityLabel: `${result.report.imported} imported, ${result.report.updated} updated`,
      meta: { ...result.report, details: undefined, duplicateStrategy },
    });

    res.json({ success: true, ...result });
  }),
);

/** GET /api/customers — paginated list with search + filters. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };

    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [
        { customerReferenceNumber: rx },
        { name: rx },
        { address: rx },
        { contactNumber: rx },
        { connectedFrom: rx },
        { vlan: rx },
        { sourcePort: rx },
        { destinationPort: rx },
      ];
    }
    if (req.query.type) filter.type = String(req.query.type).toUpperCase();
    if (req.query.connectedFrom) filter.connectedFrom = containsRegex(req.query.connectedFrom);

    const sort = parseSort(req.query.sort, { createdAt: -1 }, [
      'createdAt',
      'name',
      'customerReferenceNumber',
      'type',
      'connectedFrom',
    ]);

    const [items, total] = await Promise.all([
      Customer.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Customer.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }),
);

/** POST /api/customers */
router.post(
  '/',
  canWrite,
  validate(customerSchema),
  asyncHandler(async (req, res) => {
    const exists = await Customer.findOne({
      customerReferenceNumber: req.body.customerReferenceNumber,
    }).lean();
    if (exists) {
      throw ApiError.conflict(
        `Customer Reference Number "${req.body.customerReferenceNumber}" is already in use`,
        [{ field: 'customerReferenceNumber', message: 'Must be unique' }],
      );
    }

    const customer = await Customer.create({ ...req.body, createdBy: req.user._id });

    await recordAudit({
      req,
      action: 'create',
      entityType: 'Customer',
      entityId: customer._id,
      entityLabel: customer.customerReferenceNumber,
      after: customer,
    });

    res.status(201).json({ success: true, customer });
  }),
);

/**
 * GET /api/customers/:id — the complete internal record.
 * Accepts either the Mongo id or the Customer Reference Number.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await findCustomer(req.params.id);

    const [tickets, invoices, connections] = await Promise.all([
      Ticket.find({ customer: customer._id, isDeleted: false }).sort({ createdAt: -1 }).lean(),
      Invoice.find({ customer: customer._id, isDeleted: false }).sort({ createdAt: -1 }).lean(),
      Connection.find({ customer: customer._id }).lean(),
    ]);

    const now = new Date();
    res.json({
      success: true,
      customer,
      tickets: tickets.map((t) => decorateTicket(t, customer, now)),
      invoices,
      connections,
      stats: {
        totalTickets: tickets.length,
        openTickets: tickets.filter((t) => !['Resolved', 'Closed'].includes(t.status)).length,
        totalInvoices: invoices.length,
        unpaidInvoices: invoices.filter((i) => i.status === 'Unpaid').length,
        billedTotal: invoices
          .filter((i) => i.status !== 'Cancelled')
          .reduce((sum, i) => sum + (i.total || 0), 0),
      },
    });
  }),
);

/** PUT /api/customers/:id */
router.put(
  '/:id',
  canWrite,
  validate(customerUpdateSchema),
  asyncHandler(async (req, res) => {
    const customer = await findCustomer(req.params.id);
    const before = customer.toObject();

    if (
      req.body.customerReferenceNumber &&
      req.body.customerReferenceNumber !== customer.customerReferenceNumber
    ) {
      const clash = await Customer.findOne({
        customerReferenceNumber: req.body.customerReferenceNumber,
        _id: { $ne: customer._id },
      }).lean();
      if (clash) throw ApiError.conflict('Customer Reference Number is already in use');
    }

    Object.assign(customer, req.body, { updatedBy: req.user._id });
    await customer.save();

    // Keep the denormalized copies on existing tickets/invoices in step.
    await Promise.all([
      Ticket.updateMany(
        { customer: customer._id },
        { $set: { customerReferenceNumber: customer.customerReferenceNumber, customerName: customer.name } },
      ),
      Invoice.updateMany(
        { customer: customer._id },
        { $set: { customerReferenceNumber: customer.customerReferenceNumber, customerName: customer.name } },
      ),
    ]);

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Customer',
      entityId: customer._id,
      entityLabel: customer.customerReferenceNumber,
      before,
      after: customer,
    });

    res.json({ success: true, customer });
  }),
);

/** DELETE /api/customers/:id — admin-only soft delete, always audited. */
router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const customer = await findCustomer(req.params.id);

    const openTickets = await Ticket.countDocuments({
      customer: customer._id,
      isDeleted: false,
      status: { $nin: ['Resolved', 'Closed'] },
    });
    if (openTickets > 0) {
      throw ApiError.badRequest(
        `This customer has ${openTickets} open ticket(s). Resolve or close them before deleting.`,
      );
    }

    customer.isDeleted = true;
    customer.deletedAt = new Date();
    customer.deletedBy = req.user._id;
    await customer.save();

    await recordAudit({
      req,
      action: 'soft_delete',
      entityType: 'Customer',
      entityId: customer._id,
      entityLabel: customer.customerReferenceNumber,
      before: customer,
    });

    res.json({ success: true, message: 'Customer archived (soft deleted)' });
  }),
);

/** POST /api/customers/:id/restore */
router.post(
  '/:id/restore',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw ApiError.notFound('Customer not found');

    customer.isDeleted = false;
    customer.deletedAt = undefined;
    customer.deletedBy = undefined;
    await customer.save();

    await recordAudit({
      req,
      action: 'restore',
      entityType: 'Customer',
      entityId: customer._id,
      entityLabel: customer.customerReferenceNumber,
    });

    res.json({ success: true, customer });
  }),
);

async function findCustomer(idOrRef) {
  const value = String(idOrRef || '').trim();
  const customer = mongoose.isValidObjectId(value)
    ? await Customer.findById(value)
    : await Customer.findOne({ customerReferenceNumber: value });

  if (!customer) throw ApiError.notFound(`No customer found for "${value}"`);
  return customer;
}

export default router;
