import { Router } from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex, parsePagination, parseSort } from '../utils/search.js';
import { ROLES } from '../utils/constants.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  updateInvoiceStatusSchema,
} from '../validators/schemas.js';
import { calculateTotals, generateInvoiceNumber } from '../services/invoiceService.js';
import { streamInvoicePdf } from '../services/pdfService.js';
import { addDays } from '../utils/datetime.js';
import { decorateTicket } from '../services/ticketService.js';

const router = Router();
router.use(requireAuth);

const canRead = requireRole(ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR);
const canWrite = requireRole(ROLES.ADMIN, ROLES.ACCOUNTS);

/**
 * GET /api/invoices/lookup/:ticketNumber
 * The invoice module's entry point: enter a Ticket ID, get the linked
 * customer + ticket data pre-filled.
 */
router.get(
  '/lookup/:ticketNumber',
  canRead,
  asyncHandler(async (req, res) => {
    const ticketNumber = Number.parseInt(req.params.ticketNumber, 10);
    if (!Number.isFinite(ticketNumber)) throw ApiError.badRequest('Ticket ID must be a number');

    const ticket = await Ticket.findOne({ ticketNumber, isDeleted: false });
    if (!ticket) throw ApiError.notFound(`No ticket found with TID ${ticketNumber}`);

    const customer = await Customer.findById(ticket.customer).lean();
    const existing = await Invoice.find({ ticket: ticket._id, isDeleted: false }).lean();

    res.json({
      success: true,
      ticket: decorateTicket(ticket, customer),
      customer,
      existingInvoices: existing,
      defaults: {
        currency: env.invoice.currency,
        taxPercent: env.invoice.taxPercent,
        dueDays: env.invoice.dueDays,
        issueDate: new Date(),
        dueDate: addDays(new Date(), env.invoice.dueDays),
      },
    });
  }),
);

/** POST /api/invoices/preview — totals without saving. */
router.post(
  '/preview',
  canWrite,
  asyncHandler(async (req, res) => {
    const totals = calculateTotals({
      items: req.body.items || [],
      discountType: req.body.discountType,
      discountValue: req.body.discountValue,
      taxPercent: req.body.taxPercent,
    });
    res.json({ success: true, ...totals, currency: env.invoice.currency });
  }),
);

/** GET /api/invoices */
router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };

    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    if (req.query.customer) filter.customerReferenceNumber = String(req.query.customer);
    if (req.query.ticketNumber) filter.ticketNumber = Number.parseInt(req.query.ticketNumber, 10);

    if (req.query.q) {
      const q = String(req.query.q).trim();
      const rx = containsRegex(q);
      const asNumber = Number.parseInt(q, 10);
      filter.$or = [
        { invoiceNumber: rx },
        { customerName: rx },
        { customerReferenceNumber: rx },
        ...(Number.isFinite(asNumber) && /^\d+$/.test(q) ? [{ ticketNumber: asNumber }] : []),
      ];
    }

    const sort = parseSort(req.query.sort, { createdAt: -1 }, [
      'createdAt',
      'invoiceNumber',
      'total',
      'dueDate',
      'status',
    ]);

    const [items, total] = await Promise.all([
      Invoice.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter),
    ]);

    const totals = await Invoice.aggregate([
      { $match: { ...filter, status: { $ne: 'Cancelled' } } },
      { $group: { _id: '$status', amount: { $sum: '$total' }, count: { $sum: 1 } } },
    ]);

    res.json({
      success: true,
      items,
      totalsByStatus: totals,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }),
);

/** POST /api/invoices — always created from an existing ticket. */
router.post(
  '/',
  canWrite,
  validate(createInvoiceSchema),
  asyncHandler(async (req, res) => {
    const ticket = await Ticket.findOne({ ticketNumber: req.body.ticketNumber, isDeleted: false });
    if (!ticket) throw ApiError.badRequest(`No ticket found with TID ${req.body.ticketNumber}`);

    const customer = await Customer.findById(ticket.customer);
    if (!customer) throw ApiError.badRequest('The ticket is not linked to a valid customer');

    const totals = calculateTotals(req.body);
    const issueDate = req.body.issueDate || new Date();
    const dueDate = req.body.dueDate || addDays(issueDate, env.invoice.dueDays);

    const invoice = await Invoice.create({
      invoiceNumber: await generateInvoiceNumber(issueDate),
      ticket: ticket._id,
      ticketNumber: ticket.ticketNumber,
      customer: customer._id,
      customerReferenceNumber: customer.customerReferenceNumber,
      customerName: customer.name,
      customerAddress: customer.address,
      customerContact: customer.contactNumber,
      issueDate,
      dueDate,
      items: totals.items,
      subtotal: totals.subtotal,
      discountType: req.body.discountType,
      discountValue: req.body.discountValue,
      discountAmount: totals.discountAmount,
      taxPercent: req.body.taxPercent,
      taxAmount: totals.taxAmount,
      total: totals.total,
      currency: env.invoice.currency,
      status: req.body.status,
      notes: req.body.notes,
      createdBy: req.user._id,
      createdByName: req.user.name,
    });

    await recordAudit({
      req,
      action: 'create',
      entityType: 'Invoice',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      after: invoice,
    });

    res.status(201).json({ success: true, invoice });
  }),
);

/** GET /api/invoices/:id */
router.get(
  '/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const invoice = await findInvoice(req.params.id);
    const ticket = await Ticket.findById(invoice.ticket).lean();
    const customer = await Customer.findById(invoice.customer).lean();
    res.json({ success: true, invoice, ticket, customer });
  }),
);

/** GET /api/invoices/:id/pdf */
router.get(
  '/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const invoice = await findInvoice(req.params.id);
    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${invoice.invoiceNumber}.pdf"`);
    streamInvoicePdf(invoice, res);
  }),
);

/** PUT /api/invoices/:id */
router.put(
  '/:id',
  canWrite,
  validate(updateInvoiceSchema),
  asyncHandler(async (req, res) => {
    const invoice = await findInvoice(req.params.id);
    if (invoice.status === 'Paid') throw ApiError.badRequest('A paid invoice cannot be edited');
    const before = invoice.toObject();

    const merged = {
      items: req.body.items ?? invoice.items,
      discountType: req.body.discountType ?? invoice.discountType,
      discountValue: req.body.discountValue ?? invoice.discountValue,
      taxPercent: req.body.taxPercent ?? invoice.taxPercent,
    };
    const totals = calculateTotals(merged);

    Object.assign(invoice, {
      ...merged,
      items: totals.items,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      total: totals.total,
      issueDate: req.body.issueDate ?? invoice.issueDate,
      dueDate: req.body.dueDate ?? invoice.dueDate,
      status: req.body.status ?? invoice.status,
      notes: req.body.notes ?? invoice.notes,
    });
    await invoice.save();

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Invoice',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      before,
      after: invoice,
    });

    res.json({ success: true, invoice });
  }),
);

/** PATCH /api/invoices/:id/status */
router.patch(
  '/:id/status',
  canWrite,
  validate(updateInvoiceStatusSchema),
  asyncHandler(async (req, res) => {
    const invoice = await findInvoice(req.params.id);
    const from = invoice.status;
    invoice.status = req.body.status;
    await invoice.save();

    await recordAudit({
      req,
      action: 'status_change',
      entityType: 'Invoice',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
      meta: { from, to: invoice.status },
    });

    res.json({ success: true, invoice });
  }),
);

/** DELETE /api/invoices/:id — admin-only soft delete. */
router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const invoice = await findInvoice(req.params.id);
    invoice.isDeleted = true;
    invoice.deletedAt = new Date();
    await invoice.save();

    await recordAudit({
      req,
      action: 'soft_delete',
      entityType: 'Invoice',
      entityId: invoice._id,
      entityLabel: invoice.invoiceNumber,
    });

    res.json({ success: true, message: 'Invoice archived (soft deleted)' });
  }),
);

async function findInvoice(idOrNumber) {
  const value = String(idOrNumber || '').trim();
  const invoice = mongoose.isValidObjectId(value)
    ? await Invoice.findOne({ _id: value, isDeleted: false })
    : await Invoice.findOne({ invoiceNumber: value, isDeleted: false });

  if (!invoice) throw ApiError.notFound(`No invoice found for "${value}"`);
  return invoice;
}

export default router;
