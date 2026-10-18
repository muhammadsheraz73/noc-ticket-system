import { Router } from 'express';
import mongoose from 'mongoose';
import Quotation from '../models/Quotation.js';
import Customer from '../models/Customer.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { nextSequence } from '../utils/sequence.js';
import { containsRegex, parsePagination } from '../utils/search.js';
import { calculateTotals } from '../services/invoiceService.js';
import { renderQuotationPdf } from '../services/quotationPdf.js';
import { DEFAULT_QUOTATION_TERMS, ROLES } from '../utils/constants.js';
import { quotationSchema, quotationStatusSchema, quotationUpdateSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR));

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VALID_DAYS = 15;
const OPEN_STATUSES = ['Draft', 'Sent'];

/** `QT-2026-0001` — per client and per year, never reused. */
async function generateQuoteNumber(date = new Date()) {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone, year: 'numeric' }).format(date);
  const seq = await nextSequence(`quoteNumber:${year}`, 1);
  return `QT-${year}-${String(seq).padStart(4, '0')}`;
}

/** Recalculate every money field server-side; the browser's numbers are hints only. */
function priced(body) {
  const totals = calculateTotals({
    items: body.items,
    discountType: body.discountType,
    discountValue: body.discountValue,
    taxPercent: body.taxPercent,
  });
  return {
    items: totals.items.map((item, i) => ({ ...item, unit: String(body.items[i]?.unit || '').trim() })),
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    total: totals.total,
  };
}

/** Draft/Sent quotations past their valid-until date read as expired. */
function decorate(q, now = new Date()) {
  const expired = OPEN_STATUSES.includes(q.status) && new Date(q.validUntil) < now;
  return { ...q, isExpired: expired, displayStatus: expired ? 'Expired' : q.status };
}

async function findQuotation(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Quotation not found');
  const quotation = await Quotation.findOne({ _id: id, isDeleted: false });
  if (!quotation) throw ApiError.notFound('Quotation not found');
  return quotation;
}

async function linkedCustomer(id) {
  if (!id) return null;
  const customer = await Customer.findOne({ _id: id, isDeleted: false }).lean();
  if (!customer) throw ApiError.badRequest('The selected customer no longer exists');
  return customer;
}

/** GET /api/quotations/defaults — what a new quotation starts with. */
router.get(
  '/defaults',
  asyncHandler(async (req, res) => {
    const now = new Date();
    res.json({
      success: true,
      issueDate: now,
      validUntil: new Date(now.getTime() + DEFAULT_VALID_DAYS * DAY),
      terms: req.tenant?.quotationTerms || DEFAULT_QUOTATION_TERMS,
      currency: env.invoice.currency,
      hasLetterhead: Boolean(req.tenant?.address || (await Tenant.exists({ _id: req.tenant._id, logo: { $nin: ['', null] } }))),
    });
  }),
);

/** GET /api/quotations — list, search and the summary tiles (all time, this month, average). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25 });
    const filter = { isDeleted: false };

    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ quoteNumber: rx }, { clientName: rx }, { clientCompany: rx }, { subject: rx }, { customerReferenceNumber: rx }];
    }
    const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone, year: 'numeric', month: '2-digit' })
      .format(now).slice(0, 7);

    const [items, total, [summary]] = await Promise.all([
      Quotation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-items -terms -notes').lean(),
      Quotation.countDocuments(filter),
      Quotation.aggregate([
        { $match: { isDeleted: false } },
        {
          $addFields: {
            inMonth: { $eq: [{ $dateToString: { format: '%Y-%m', date: '$issueDate', timezone: env.timezone } }, monthKey] },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            value: { $sum: '$total' },
            monthCount: { $sum: { $cond: ['$inMonth', 1, 0] } },
            monthValue: { $sum: { $cond: ['$inMonth', '$total', 0] } },
          },
        },
      ]),
    ]);

    const s = summary || { count: 0, value: 0, monthCount: 0, monthValue: 0 };
    res.json({
      success: true,
      items: items.map((q) => decorate(q, now)),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        total: { count: s.count, value: s.value },
        thisMonth: { count: s.monthCount, value: s.monthValue },
        average: s.count ? s.value / s.count : 0,
      },
    });
  }),
);

/** POST /api/quotations */
router.post(
  '/',
  validate(quotationSchema),
  asyncHandler(async (req, res) => {
    const customer = await linkedCustomer(req.body.customer);
    const issueDate = req.body.issueDate || new Date();
    const validUntil = req.body.validUntil || new Date(issueDate.getTime() + DEFAULT_VALID_DAYS * DAY);
    if (validUntil < issueDate) throw ApiError.badRequest('Valid-until date cannot be before the quotation date', [{ field: 'validUntil', message: 'Must be on or after the quotation date' }]);

    const quotation = await Quotation.create({
      ...req.body,
      ...priced(req.body),
      customer: customer?._id,
      customerReferenceNumber: customer?.customerReferenceNumber || '',
      quoteNumber: await generateQuoteNumber(issueDate),
      issueDate,
      validUntil,
      currency: env.invoice.currency,
      statusChangedAt: new Date(),
      createdBy: req.user._id,
      createdByName: req.user.name,
    });

    await recordAudit({ req, action: 'create', entityType: 'Quotation', entityId: quotation._id, entityLabel: quotation.quoteNumber });
    res.status(201).json({ success: true, quotation: decorate(quotation.toJSON()) });
  }),
);

/** GET /api/quotations/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const quotation = await findQuotation(req.params.id);
    res.json({ success: true, quotation: decorate(quotation.toJSON()) });
  }),
);

/** PUT /api/quotations/:id — full edit. */
router.put(
  '/:id',
  validate(quotationUpdateSchema),
  asyncHandler(async (req, res) => {
    const quotation = await findQuotation(req.params.id);

    const previousStatus = quotation.status;
    const merged = { ...quotation.toObject(), ...req.body };
    if (new Date(merged.validUntil) < new Date(merged.issueDate)) {
      throw ApiError.badRequest('Valid-until date cannot be before the quotation date', [{ field: 'validUntil', message: 'Must be on or after the quotation date' }]);
    }

    Object.assign(quotation, req.body, priced(merged));
    // The form always sends the whole "To" block with it — then a missing
    // customer means the link was removed.
    if (req.body.clientName !== undefined) {
      const customer = await linkedCustomer(req.body.customer);
      quotation.customer = customer?._id;
      quotation.customerReferenceNumber = customer?.customerReferenceNumber || '';
    }
    if (quotation.status !== previousStatus) quotation.statusChangedAt = new Date();
    await quotation.save();

    await recordAudit({ req, action: 'update', entityType: 'Quotation', entityId: quotation._id, entityLabel: quotation.quoteNumber });
    res.json({ success: true, quotation: decorate(quotation.toJSON()) });
  }),
);

/** PATCH /api/quotations/:id/status — Draft → Sent → Accepted / Rejected. */
router.patch(
  '/:id/status',
  validate(quotationStatusSchema),
  asyncHandler(async (req, res) => {
    const quotation = await findQuotation(req.params.id);
    const from = quotation.status;
    quotation.status = req.body.status;
    quotation.statusChangedAt = new Date();
    await quotation.save();

    await recordAudit({
      req, action: 'status_change', entityType: 'Quotation', entityId: quotation._id, entityLabel: quotation.quoteNumber,
      meta: { from, to: quotation.status },
    });
    res.json({ success: true, quotation: decorate(quotation.toJSON()) });
  }),
);

/** POST /api/quotations/:id/duplicate — a fresh Draft with the same lines. */
router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    // eslint-disable-next-line no-unused-vars
    const { _id, createdAt, updatedAt, deletedAt, ...source } = (await findQuotation(req.params.id)).toObject();
    const now = new Date();
    const copy = await Quotation.create({
      ...source,
      quoteNumber: await generateQuoteNumber(now),
      status: 'Draft',
      statusChangedAt: now,
      issueDate: now,
      validUntil: new Date(now.getTime() + DEFAULT_VALID_DAYS * DAY),
      createdBy: req.user._id,
      createdByName: req.user.name,
    });

    await recordAudit({ req, action: 'create', entityType: 'Quotation', entityId: copy._id, entityLabel: copy.quoteNumber, meta: { duplicatedFrom: source.quoteNumber } });
    res.status(201).json({ success: true, quotation: decorate(copy.toJSON()) });
  }),
);

/** DELETE /api/quotations/:id — archive (admin only). */
router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const quotation = await findQuotation(req.params.id);
    quotation.isDeleted = true;
    quotation.deletedAt = new Date();
    await quotation.save();

    await recordAudit({ req, action: 'delete', entityType: 'Quotation', entityId: quotation._id, entityLabel: quotation.quoteNumber });
    res.json({ success: true, message: `${quotation.quoteNumber} deleted` });
  }),
);

/** GET /api/quotations/:id/pdf[?download=true] — on the client's own letterhead. */
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const quotation = await findQuotation(req.params.id);
    // req.tenant is a light copy; the logo lives on the full document.
    const tenant = await Tenant.findById(req.tenant._id).lean();
    const buffer = await renderQuotationPdf(quotation.toObject(), {
      name: tenant.name,
      address: tenant.address,
      phone: tenant.phone,
      email: tenant.email,
      website: tenant.website,
      logo: tenant.logo,
      color: tenant.themeColor,
    });

    // Same reasoning as the invoice PDF: only an explicit download advertises
    // itself as a PDF, so embedded hosts never auto-save the preview fetch.
    const isDownload = req.query.download === 'true';
    res.setHeader('Content-Type', isDownload ? 'application/pdf' : 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    if (isDownload) res.setHeader('Content-Disposition', `attachment; filename="${quotation.quoteNumber}.pdf"`);
    res.end(buffer);
  }),
);

export default router;
