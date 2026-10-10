import { Router } from 'express';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import Subscriber from '../models/Subscriber.js';
import BillingRecord from '../models/BillingRecord.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadSpreadsheet } from '../middleware/upload.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex, parsePagination } from '../utils/search.js';
import { ROLES } from '../utils/constants.js';
import { parseBillingWorkbook } from '../services/billingImport.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR));

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone }).format(new Date());
const currentPeriod = () => today().slice(0, 7);
const period = (value) => {
  const p = String(value || currentPeriod());
  if (!PERIOD.test(p)) throw ApiError.badRequest('Period must look like 2026-10');
  return p;
};
const num = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw ApiError.badRequest(`${label} must be a positive number`);
  return n;
};
const findOr404 = async (Model, id, label) => {
  const doc = mongoose.isValidObjectId(id) ? await Model.findById(id) : null;
  if (!doc) throw ApiError.notFound(`${label} not found`);
  return doc;
};

/* ------------------------------ subscribers ------------------------------ */

router.get(
  '/subscribers',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ username: rx }, { address: rx }, { package: rx }, { contact: rx }];
    }
    const [items, total] = await Promise.all([
      Subscriber.find(filter).sort({ usernameKey: 1 }).skip(skip).limit(limit).lean(),
      Subscriber.countDocuments(filter),
    ]);
    res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  }),
);

const subscriberFields = (body) => ({
  username: String(body.username || '').trim(),
  activationDate: body.activationDate || undefined,
  package: String(body.package || '').trim(),
  status: body.status === 'Inactive' ? 'Inactive' : 'Active',
  address: String(body.address || '').trim(),
  contact: String(body.contact || '').trim(),
  monthlyFee: num(body.monthlyFee ?? 0, 'Monthly fee'),
  notes: String(body.notes || '').trim(),
});

router.post(
  '/subscribers',
  asyncHandler(async (req, res) => {
    const data = subscriberFields(req.body);
    if (!data.username) throw ApiError.badRequest('Username is required');
    if (await Subscriber.exists({ usernameKey: data.username.toLowerCase() })) {
      throw ApiError.badRequest(`Subscriber "${data.username}" already exists`);
    }
    const subscriber = await Subscriber.create(data);
    await recordAudit({ req, action: 'create', entityType: 'Subscriber', entityId: subscriber._id, entityLabel: subscriber.username, after: subscriber });
    res.status(201).json({ success: true, subscriber });
  }),
);

router.put(
  '/subscribers/:id',
  asyncHandler(async (req, res) => {
    const subscriber = await findOr404(Subscriber, req.params.id, 'Subscriber');
    const before = subscriber.toObject();
    const data = subscriberFields({ ...before, ...req.body });
    if (!data.username) throw ApiError.badRequest('Username is required');
    const clash = await Subscriber.exists({ usernameKey: data.username.toLowerCase(), _id: { $ne: subscriber._id } });
    if (clash) throw ApiError.badRequest(`Subscriber "${data.username}" already exists`);
    Object.assign(subscriber, data);
    await subscriber.save();
    await recordAudit({ req, action: 'update', entityType: 'Subscriber', entityId: subscriber._id, entityLabel: subscriber.username, before, after: subscriber });
    res.json({ success: true, subscriber });
  }),
);

router.delete(
  '/subscribers/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const subscriber = await findOr404(Subscriber, req.params.id, 'Subscriber');
    await BillingRecord.deleteMany({ subscriber: subscriber._id });
    await subscriber.deleteOne();
    await recordAudit({ req, action: 'delete', entityType: 'Subscriber', entityId: subscriber._id, entityLabel: subscriber.username });
    res.json({ success: true, message: 'Subscriber and billing history deleted' });
  }),
);

/**
 * POST /api/billing/subscribers/import?period=2026-10 — upload the old Excel sheet.
 * Creates/updates subscribers; if the sheet has a Fee, also creates that month's
 * bill, and a payment for whatever the "Received" column holds.
 */
router.post(
  '/subscribers/import',
  (req, res, next) => uploadSpreadsheet(req, res, (err) => (err ? next(err) : next())),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Please choose a spreadsheet to upload');
    const p = period(req.query.period);
    const rows = parseBillingWorkbook(req.file.buffer);
    if (!rows.length) throw ApiError.badRequest('No users found in the sheet');

    const result = { rows: rows.length, created: 0, updated: 0, billsCreated: 0, paymentsAdded: 0 };
    for (const row of rows) {
      let subscriber = await Subscriber.findOne({ usernameKey: row.username.toLowerCase() });
      const fields = {
        username: row.username,
        activationDate: row.activationDate,
        package: row.package,
        status: row.status,
        address: row.address,
        monthlyFee: row.fee,
      };
      if (subscriber) {
        Object.assign(subscriber, fields);
        result.updated += 1;
      } else {
        subscriber = new Subscriber(fields);
        result.created += 1;
      }
      await subscriber.save();

      if (row.status !== 'Active' || !row.fee) continue;
      let record = await BillingRecord.findOne({ subscriber: subscriber._id, period: p });
      if (!record) {
        record = new BillingRecord({
          subscriber: subscriber._id,
          username: subscriber.username,
          period: p,
          package: subscriber.package,
          address: subscriber.address,
          fee: row.fee,
        });
        result.billsCreated += 1;
      }
      if (row.received > 0 && record.payments.length === 0) {
        record.payments.push({
          amount: row.received,
          receivedBy: row.receivedBy,
          receivedAt: row.paymentDate || new Date(),
          note: 'Imported from Excel',
        });
        result.paymentsAdded += 1;
      }
      await record.save();
    }
    await recordAudit({ req, action: 'import', entityType: 'Billing', entityLabel: `${p} (${rows.length} rows)`, meta: result });
    res.json({ success: true, period: p, ...result });
  }),
);

/* ------------------------------ monthly bills ----------------------------- */

router.get(
  '/records',
  asyncHandler(async (req, res) => {
    const p = period(req.query.period);
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    const filter = { period: p };
    if (req.query.status) filter.paymentStatus = String(req.query.status);
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ username: rx }, { address: rx }, { package: rx }, { lastReceivedBy: rx }];
    }
    const [items, total, sums] = await Promise.all([
      BillingRecord.find(filter).sort({ username: 1 }).skip(skip).limit(limit).lean(),
      BillingRecord.countDocuments(filter),
      BillingRecord.aggregate([
        { $match: { period: p } },
        {
          $group: {
            _id: '$paymentStatus',
            fee: { $sum: '$fee' },
            received: { $sum: '$received' },
            arrears: { $sum: '$arrears' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const totals = { fee: 0, received: 0, arrears: 0, count: 0, byStatus: {} };
    for (const s of sums) {
      totals.fee += s.fee;
      totals.received += s.received;
      totals.arrears += s.arrears;
      totals.count += s.count;
      totals.byStatus[s._id] = s.count;
    }
    res.json({ success: true, period: p, items, totals, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  }),
);

/** POST /api/billing/records/generate { period } — a bill for every active subscriber. */
router.post(
  '/records/generate',
  asyncHandler(async (req, res) => {
    const p = period(req.body.period);
    const only = req.body.subscriberId;
    if (only && !mongoose.isValidObjectId(only)) throw ApiError.badRequest('Invalid subscriber');
    const subscribers = await Subscriber.find(only ? { _id: only } : { status: 'Active' }).lean();
    if (only && !subscribers.length) throw ApiError.notFound('Subscriber not found');
    const existing = new Set((await BillingRecord.find({ period: p }).distinct('subscriber')).map(String));
    const fresh = subscribers.filter((s) => !existing.has(String(s._id)));
    if (fresh.length) {
      await BillingRecord.insertMany(
        fresh.map((s) => ({
          subscriber: s._id,
          username: s.username,
          period: p,
          package: s.package,
          address: s.address,
          fee: s.monthlyFee,
          arrears: s.monthlyFee,
        })),
      );
    }
    await recordAudit({ req, action: 'create', entityType: 'Billing', entityLabel: `${p} bills`, meta: { created: fresh.length } });
    res.json({ success: true, period: p, created: fresh.length, alreadyExisting: subscribers.length - fresh.length });
  }),
);

/** PATCH /api/billing/records/:id — adjust the fee or notes of one bill. */
router.patch(
  '/records/:id',
  asyncHandler(async (req, res) => {
    const record = await findOr404(BillingRecord, req.params.id, 'Bill');
    if (req.body.fee !== undefined) record.fee = num(req.body.fee, 'Fee');
    if (req.body.notes !== undefined) record.notes = String(req.body.notes).trim();
    await record.save();
    res.json({ success: true, record });
  }),
);

/** POST /api/billing/records/:id/payments — record money received. */
router.post(
  '/records/:id/payments',
  asyncHandler(async (req, res) => {
    const record = await findOr404(BillingRecord, req.params.id, 'Bill');
    const amount = num(req.body.amount, 'Amount');
    if (amount <= 0) throw ApiError.badRequest('Amount must be greater than zero');
    const receivedAt = req.body.receivedAt ? new Date(req.body.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw ApiError.badRequest('Invalid date');
    record.payments.push({
      amount,
      receivedBy: String(req.body.receivedBy || req.user.name || '').trim(),
      receivedAt,
      note: String(req.body.note || '').trim(),
    });
    await record.save();
    await recordAudit({ req, action: 'payment', entityType: 'Billing', entityId: record._id, entityLabel: `${record.username} ${record.period}`, meta: { amount } });
    res.status(201).json({ success: true, record });
  }),
);

router.delete(
  '/records/:id/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const record = await findOr404(BillingRecord, req.params.id, 'Bill');
    const payment = record.payments.id(req.params.paymentId);
    if (!payment) throw ApiError.notFound('Payment not found');
    payment.deleteOne();
    await record.save();
    await recordAudit({ req, action: 'delete', entityType: 'Billing', entityId: record._id, entityLabel: `payment ${record.username} ${record.period}` });
    res.json({ success: true, record });
  }),
);

/* --------------------------------- export --------------------------------- */

/** GET /api/billing/export?period= — the month's ledger as an Excel file. */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const p = period(req.query.period);
    const records = await BillingRecord.find({ period: p }).sort({ username: 1 }).lean();
    const fmt = (d) =>
      d ? new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '';
    const rows = records.map((r) => ({
      USER: r.username,
      Unit: r.package,
      ADDRESS: r.address,
      Fee: r.fee,
      'Payment Status': r.paymentStatus.toUpperCase(),
      Received: r.received,
      Arrears: r.arrears,
      'Rec. By': r.lastReceivedBy,
      'Received At': fmt(r.lastReceivedAt),
    }));
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows), p);
    const buffer = xlsx.write(book, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="billing-${p}.xlsx"`);
    res.end(buffer);
  }),
);

export default router;
