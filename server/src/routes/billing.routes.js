import { Router } from 'express';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import Customer from '../models/Customer.js';
import Subscriber from '../models/Subscriber.js';
import BillingRecord from '../models/BillingRecord.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadSpreadsheet } from '../middleware/upload.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex, parsePagination } from '../utils/search.js';
import { ROLES } from '../utils/constants.js';
import { parseBillingWorkbook } from '../services/billingImport.js';
import { startOfLocalDay } from '../utils/datetime.js';
import { billNumber, renderBillSlips } from '../services/billSlipPdf.js';

const router = Router();
router.use(requireAuth);
// Monthly bills are run by the billing team (Accounts); requireRole also lets the Admin through.
router.use(requireRole(ROLES.ACCOUNTS));

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

/* --------------------------- customers → billing --------------------------- */

/**
 * The billing user for a customer: the one already linked to it, else an unlinked
 * billing user with the same name (e.g. imported from the Excel sheet). Never
 * returns a billing user that belongs to a different customer.
 */
const subscriberForCustomer = async (customer) =>
  (await Subscriber.findOne({ customer: customer._id })) ||
  Subscriber.findOne({ usernameKey: customer.name.trim().toLowerCase(), customer: { $exists: false } });

/**
 * GET /api/billing/customers?period=&q=&page=&limit= — every customer, with the
 * monthly fee on record (if any) and whether that month's bill exists.
 */
router.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const p = period(req.query.period);
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const filter = { isDeleted: false };
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ name: rx }, { customerReferenceNumber: rx }, { address: rx }, { contactNumber: rx }, { bandwidth: rx }];
    }
    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments(filter),
    ]);

    const ids = customers.map((c) => c._id);
    const nameKeys = customers.map((c) => c.name.trim().toLowerCase());
    const subscribers = await Subscriber.find({
      $or: [{ customer: { $in: ids } }, { usernameKey: { $in: nameKeys }, customer: { $exists: false } }],
    }).lean();
    const linked = new Map(subscribers.filter((s) => s.customer).map((s) => [String(s.customer), s]));
    const byName = new Map(subscribers.filter((s) => !s.customer).map((s) => [s.usernameKey, s]));
    const bills = await BillingRecord.find({ period: p, subscriber: { $in: subscribers.map((s) => s._id) } })
      .select('subscriber fee paymentStatus')
      .lean();
    const billBy = new Map(bills.map((b) => [String(b.subscriber), b]));

    const items = customers.map((c) => {
      const sub = linked.get(String(c._id)) || byName.get(c.name.trim().toLowerCase());
      const bill = sub ? billBy.get(String(sub._id)) : null;
      return {
        _id: c._id,
        name: c.name,
        customerReferenceNumber: c.customerReferenceNumber,
        address: c.address,
        contactNumber: c.contactNumber,
        bandwidth: c.bandwidth,
        status: c.status,
        monthlyFee: sub ? sub.monthlyFee : null,
        bill: bill ? { _id: bill._id, fee: bill.fee, paymentStatus: bill.paymentStatus } : null,
      };
    });
    res.json({ success: true, period: p, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  }),
);

/**
 * POST /api/billing/customers/:id/bill { period, fee } — create that month's bill
 * for a customer, or overwrite its fee if it already exists. The customer's
 * details are copied onto the bill and the fee is remembered for next month.
 */
router.post(
  '/customers/:id/bill',
  asyncHandler(async (req, res) => {
    const p = period(req.body.period);
    const fee = num(req.body.fee, 'Monthly fee');
    if (fee <= 0) throw ApiError.badRequest('Monthly fee must be greater than zero');
    const customer = mongoose.isValidObjectId(req.params.id)
      ? await Customer.findOne({ _id: req.params.id, isDeleted: false })
      : null;
    if (!customer) throw ApiError.notFound('Customer not found');

    let subscriber = await subscriberForCustomer(customer);
    if (!subscriber) {
      // Billing usernames are unique; two customers can share a name, so fall back to "Name (REF)".
      const taken = await Subscriber.exists({ usernameKey: customer.name.trim().toLowerCase() });
      subscriber = new Subscriber({
        username: taken ? `${customer.name} (${customer.customerReferenceNumber})` : customer.name,
      });
    }
    Object.assign(subscriber, {
      customer: customer._id,
      package: customer.bandwidth || subscriber.package,
      address: customer.address || subscriber.address,
      contact: customer.contactNumber || subscriber.contact,
      status: customer.status === 'Non Active' ? 'Inactive' : 'Active',
      monthlyFee: fee,
    });
    await subscriber.save();

    let record = await BillingRecord.findOne({ subscriber: subscriber._id, period: p });
    const created = !record;
    if (!record) record = new BillingRecord({ subscriber: subscriber._id, period: p });
    Object.assign(record, { username: subscriber.username, package: subscriber.package, address: subscriber.address, fee });
    await record.save();

    await recordAudit({
      req,
      action: created ? 'create' : 'update',
      entityType: 'Billing',
      entityId: record._id,
      entityLabel: `${subscriber.username} ${p}`,
      meta: { fee, customer: customer.customerReferenceNumber },
    });
    res.status(created ? 201 : 200).json({ success: true, created, record });
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

/**
 * DELETE /api/billing/records/:id — remove one month's bill (and its payments).
 * The billing user stays, so next month's bills are unaffected.
 */
router.delete(
  '/records/:id',
  asyncHandler(async (req, res) => {
    const record = await findOr404(BillingRecord, req.params.id, 'Bill');
    await record.deleteOne();
    await recordAudit({
      req,
      action: 'delete',
      entityType: 'Billing',
      entityId: record._id,
      entityLabel: `${record.username} ${record.period}`,
      before: record,
    });
    res.json({ success: true, message: `Bill for ${record.username} (${record.period}) deleted` });
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

/* -------------------------------- dashboard -------------------------------- */

/** "2026-10" → the `count` months ending there, oldest first. */
function lastPeriods(end, count) {
  const [year, month] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Sum of fee/received/arrears per period, plus how many bills sit in each status. */
async function periodTotals(periods) {
  const rows = await BillingRecord.aggregate([
    { $match: { period: { $in: periods } } },
    {
      $group: {
        _id: { period: '$period', status: '$paymentStatus' },
        fee: { $sum: '$fee' },
        received: { $sum: '$received' },
        arrears: { $sum: '$arrears' },
        count: { $sum: 1 },
      },
    },
  ]);
  const totals = new Map(periods.map((p) => [p, {
    period: p, fee: 0, received: 0, arrears: 0, count: 0, byStatus: { Received: 0, Partial: 0, Pending: 0 },
  }]));
  for (const r of rows) {
    const t = totals.get(r._id.period);
    t.fee += r.fee;
    t.received += r.received;
    t.arrears += r.arrears;
    t.count += r.count;
    t.byStatus[r._id.status] = r.count;
  }
  return periods.map((p) => totals.get(p));
}

/** GET /api/billing/dashboard — everything the billing team's home screen shows. */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const current = currentPeriod();
    const periods = lastPeriods(current, 6);
    const todayStart = startOfLocalDay(now);
    const monthStart = startOfLocalDay(new Date(`${current}-01T12:00:00Z`));

    const [
      trend,
      dues,
      collectedToday,
      collectedThisMonth,
      defaulters,
      recentPayments,
      invoiceGroups,
      overdueInvoices,
      quotationGroups,
      recentInvoices,
      recentQuotations,
    ] = await Promise.all([
      periodTotals(periods),
      BillingRecord.aggregate([
        { $match: { arrears: { $gt: 0 } } },
        { $group: { _id: null, amount: { $sum: '$arrears' }, bills: { $sum: 1 }, users: { $addToSet: '$subscriber' } } },
      ]),
      BillingRecord.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.receivedAt': { $gte: todayStart } } },
        { $group: { _id: null, amount: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
      ]),
      BillingRecord.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.receivedAt': { $gte: monthStart } } },
        { $group: { _id: null, amount: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
      ]),
      BillingRecord.aggregate([
        { $match: { arrears: { $gt: 0 } } },
        { $sort: { period: 1 } },
        {
          $group: {
            _id: '$subscriber',
            username: { $last: '$username' },
            address: { $last: '$address' },
            arrears: { $sum: '$arrears' },
            months: { $sum: 1 },
            oldest: { $first: '$period' },
          },
        },
        { $sort: { arrears: -1 } },
        { $limit: 6 },
      ]),
      BillingRecord.aggregate([
        { $unwind: '$payments' },
        { $sort: { 'payments.receivedAt': -1 } },
        { $limit: 8 },
        {
          $project: {
            _id: '$payments._id',
            username: 1,
            period: 1,
            amount: '$payments.amount',
            receivedBy: '$payments.receivedBy',
            receivedAt: '$payments.receivedAt',
          },
        },
      ]),
      Invoice.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', amount: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { isDeleted: false, status: 'Unpaid', dueDate: { $lt: now } } },
        { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Quotation.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', amount: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Invoice.find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('invoiceNumber customerName total currency status dueDate createdAt')
        .lean(),
      Quotation.find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('quoteNumber clientName subject total status createdAt')
        .lean(),
    ]);

    const byStatus = (groups) => Object.fromEntries(groups.map((g) => [g._id, { amount: g.amount, count: g.count }]));

    res.json({
      success: true,
      serverTime: now,
      period: current,
      thisMonth: trend[trend.length - 1],
      lastMonth: trend[trend.length - 2],
      trend,
      dues: {
        amount: dues[0]?.amount || 0,
        bills: dues[0]?.bills || 0,
        users: dues[0]?.users.length || 0,
      },
      collectedToday: { amount: collectedToday[0]?.amount || 0, count: collectedToday[0]?.count || 0 },
      collectedThisMonth: { amount: collectedThisMonth[0]?.amount || 0, count: collectedThisMonth[0]?.count || 0 },
      defaulters: defaulters.map((d) => ({ ...d, subscriber: d._id, _id: undefined })),
      recentPayments,
      invoices: { ...byStatus(invoiceGroups), overdue: { amount: overdueInvoices[0]?.amount || 0, count: overdueInvoices[0]?.count || 0 } },
      quotations: byStatus(quotationGroups),
      recentInvoices,
      recentQuotations,
    });
  }),
);

/* -------------------------------- bill slips -------------------------------- */

/**
 * What each slip needs besides the bill: the customer it belongs to and any
 * dues left unpaid from earlier months.
 */
async function slipData(records) {
  const subscriberIds = [...new Set(records.map((r) => String(r.subscriber)))];
  const [subscribers, older] = await Promise.all([
    Subscriber.find({ _id: { $in: subscriberIds } }).select('customer contact').lean(),
    BillingRecord.find({ subscriber: { $in: subscriberIds }, arrears: { $gt: 0 } }).select('subscriber period arrears').lean(),
  ]);
  const customers = await Customer.find({ _id: { $in: subscribers.map((s) => s.customer).filter(Boolean) } })
    .select('name customerReferenceNumber contactNumber')
    .lean();
  const subscriberById = new Map(subscribers.map((s) => [String(s._id), s]));
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  return records.map((record) => {
    const sub = subscriberById.get(String(record.subscriber));
    const customer = sub?.customer ? customerById.get(String(sub.customer)) : null;
    const previousDues = older
      .filter((o) => String(o.subscriber) === String(record.subscriber) && o.period < record.period)
      .reduce((sum, o) => sum + o.arrears, 0);
    return {
      record,
      previousDues,
      customer: {
        name: customer?.name || record.username,
        customerReferenceNumber: customer?.customerReferenceNumber || '',
        contactNumber: customer?.contactNumber || sub?.contact || '',
      },
    };
  });
}

/** The client's letterhead, for every slip. */
async function slipCompany(req) {
  const tenant = await Tenant.findById(req.tenant._id).lean();
  return {
    name: tenant.name,
    address: tenant.address,
    phone: tenant.phone,
    email: tenant.email,
    website: tenant.website,
    logo: tenant.logo,
    color: tenant.themeColor,
    bankAccounts: tenant.bankAccounts || [],
  };
}

/** Only an explicit download is labelled as a PDF (see the quotation PDF route for why). */
function sendPdf(req, res, buffer, filename) {
  const isDownload = req.query.download === 'true';
  res.setHeader('Content-Type', isDownload ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  if (isDownload) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
}

/** GET /api/billing/records/:id/slip[?download=true] — one bill's slip. */
router.get(
  '/records/:id/slip',
  asyncHandler(async (req, res) => {
    const record = await findOr404(BillingRecord, req.params.id, 'Bill');
    const [slips, company] = await Promise.all([slipData([record.toObject()]), slipCompany(req)]);
    const buffer = await renderBillSlips(slips, company);
    const safeName = record.username.replace(/[\\/:*?"<>|]/g, '').trim();
    sendPdf(req, res, buffer, `Bill ${billNumber(record)} - ${safeName}.pdf`);
  }),
);

/** GET /api/billing/slips?period=2026-10[&status=Pending][&download=true] — every slip of a month, one per page. */
router.get(
  '/slips',
  asyncHandler(async (req, res) => {
    const p = period(req.query.period);
    const filter = { period: p };
    if (req.query.status) filter.paymentStatus = String(req.query.status);
    const records = await BillingRecord.find(filter).sort({ username: 1 }).lean();
    if (!records.length) throw ApiError.notFound(`No bills for ${p}`);
    const [slips, company] = await Promise.all([slipData(records), slipCompany(req)]);
    const buffer = await renderBillSlips(slips, company);
    sendPdf(req, res, buffer, `Bills ${p}.pdf`);
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
