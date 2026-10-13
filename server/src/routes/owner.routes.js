import { Router } from 'express';
import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import FieldTeam from '../models/FieldTeam.js';
import AuditLog from '../models/AuditLog.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { requireOwner } from '../middleware/auth.js';
import { parsePagination } from '../utils/search.js';
import { CLOSED_STATUSES, ROLES, TICKET_STATUSES } from '../utils/constants.js';

/**
 * Owner monitoring: a read-only, cross-client view of how every client is
 * using the panel. The owner request runs outside any tenant scope, so every
 * query here names the client(s) it is about explicitly.
 */
const router = Router();
router.use(requireOwner);

const DAY = 24 * 60 * 60 * 1000;
const RANGES = [7, 30, 90];

function rangeDays(value) {
  const days = Number.parseInt(value, 10);
  return RANGES.includes(days) ? days : 30;
}

/** `YYYY-MM-DD` in the operational timezone — matches Mongo's $dateToString. */
function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** The last `days` calendar days, oldest first, each with a zero count. */
function emptySeries(days, now) {
  return Array.from({ length: days }, (_, i) => ({ day: dayKey(new Date(now - (days - 1 - i) * DAY)), count: 0 }));
}

const dayExpr = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: env.timezone } });

/**
 * Every per-client number the monitoring pages show, for one or all clients.
 * Returns a Map of tenant id → metrics.
 */
async function collectMetrics(tenantIds, { days, now }) {
  const since = new Date(now - days * DAY);
  const ids = tenantIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const inTenants = { tenant: { $in: ids } };

  const [customers, tickets, trend, invoices, users, employees, activity] = await Promise.all([
    Customer.aggregate([
      { $match: { ...inTenants, isDeleted: false } },
      {
        $group: {
          _id: '$tenant',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } },
          added: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
        },
      },
    ]),
    Ticket.aggregate([
      { $match: { ...inTenants, isDeleted: false } },
      {
        $addFields: {
          isOpen: { $not: [{ $in: ['$status', CLOSED_STATUSES] }] },
          inRange: { $gte: ['$createdAt', since] },
          resolvedInRange: { $gte: ['$resolvedAt', since] },
        },
      },
      {
        $group: {
          _id: '$tenant',
          total: { $sum: 1 },
          open: { $sum: { $cond: ['$isOpen', 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: ['$isOpen', { $lt: ['$ettrAt', now] }] }, 1, 0] } },
          urgent: { $sum: { $cond: [{ $and: ['$isOpen', { $eq: ['$priority', 'Urgent'] }] }, 1, 0] } },
          unassigned: { $sum: { $cond: [{ $and: ['$isOpen', { $not: ['$assignedTo'] }] }, 1, 0] } },
          created: { $sum: { $cond: ['$inRange', 1, 0] } },
          resolved: { $sum: { $cond: ['$resolvedInRange', 1, 0] } },
          resolvedOnTime: {
            $sum: { $cond: [{ $and: ['$resolvedInRange', { $lte: ['$resolvedAt', '$ettrAt'] }] }, 1, 0] },
          },
          resolveMinutes: {
            $sum: {
              $cond: ['$resolvedInRange', { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 60000] }, 0],
            },
          },
          lastTicketAt: { $max: '$createdAt' },
        },
      },
    ]),
    Ticket.aggregate([
      { $match: { ...inTenants, isDeleted: false, createdAt: { $gte: new Date(now - (days - 1) * DAY - DAY) } } },
      { $group: { _id: { tenant: '$tenant', day: dayExpr('$createdAt') }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { ...inTenants, isDeleted: false, status: { $ne: 'Cancelled' } } },
      {
        $group: {
          _id: '$tenant',
          count: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$total', 0] } },
          outstanding: { $sum: { $cond: [{ $in: ['$status', ['Draft', 'Unpaid']] }, '$total', 0] } },
          billedInRange: { $sum: { $cond: [{ $gte: ['$issueDate', since] }, '$total', 0] } },
        },
      },
    ]),
    User.aggregate([
      { $match: { ...inTenants, role: { $ne: ROLES.SUPERADMIN } } },
      {
        $group: {
          _id: '$tenant',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          lastLoginAt: { $max: '$lastLoginAt' },
          activeInRange: { $sum: { $cond: [{ $gte: ['$lastLoginAt', since] }, 1, 0] } },
        },
      },
    ]),
    FieldTeam.aggregate([
      { $match: { ...inTenants, isActive: true, kind: 'member' } },
      { $group: { _id: '$tenant', total: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: inTenants },
      {
        $group: {
          _id: '$tenant',
          lastAt: { $max: '$createdAt' },
          actions: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const index = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const c = index(customers);
  const t = index(tickets);
  const inv = index(invoices);
  const u = index(users);
  const e = index(employees);
  const a = index(activity);

  const trendByTenant = new Map();
  for (const row of trend) {
    const key = String(row._id.tenant);
    if (!trendByTenant.has(key)) trendByTenant.set(key, new Map());
    trendByTenant.get(key).set(row._id.day, row.count);
  }

  const result = new Map();
  for (const id of ids) {
    const key = String(id);
    const tk = t.get(key) || {};
    const counts = trendByTenant.get(key) || new Map();
    const lastActiveAt = [a.get(key)?.lastAt, u.get(key)?.lastLoginAt].filter(Boolean).sort((x, y) => y - x)[0] || null;

    result.set(key, {
      customers: { total: c.get(key)?.total || 0, active: c.get(key)?.active || 0, added: c.get(key)?.added || 0 },
      tickets: {
        total: tk.total || 0,
        open: tk.open || 0,
        overdue: tk.overdue || 0,
        urgent: tk.urgent || 0,
        unassigned: tk.unassigned || 0,
        created: tk.created || 0,
        resolved: tk.resolved || 0,
        onTimeRate: tk.resolved ? Math.round((tk.resolvedOnTime / tk.resolved) * 100) : null,
        avgResolveMinutes: tk.resolved ? Math.round(tk.resolveMinutes / tk.resolved) : null,
        lastTicketAt: tk.lastTicketAt || null,
      },
      invoices: {
        count: inv.get(key)?.count || 0,
        paid: inv.get(key)?.paid || 0,
        outstanding: inv.get(key)?.outstanding || 0,
        billed: inv.get(key)?.billedInRange || 0,
      },
      logins: {
        total: u.get(key)?.total || 0,
        active: u.get(key)?.active || 0,
        activeInRange: u.get(key)?.activeInRange || 0,
        lastLoginAt: u.get(key)?.lastLoginAt || null,
      },
      employees: e.get(key)?.total || 0,
      actions: a.get(key)?.actions || 0,
      lastActiveAt,
      trend: emptySeries(days, now).map((d) => ({ ...d, count: counts.get(d.day) || 0 })),
    });
  }
  return result;
}

/**
 * A plain-language verdict on each client, with the reasons behind it, so the
 * owner sees at a glance who needs a call.
 */
function healthOf(tenant, m, now) {
  if (!tenant.isActive) return { level: 'suspended', label: 'Suspended', reasons: ['Client is suspended — its logins cannot sign in'] };

  const reasons = [];
  let level = 'healthy';
  const bump = (to) => {
    const order = ['healthy', 'attention', 'critical'];
    if (order.indexOf(to) > order.indexOf(level)) level = to;
  };

  if (m.logins.active === 0) {
    reasons.push('No active login — nobody at this client can sign in');
    bump('critical');
  }
  const idleDays = m.lastActiveAt ? Math.floor((now - new Date(m.lastActiveAt)) / DAY) : null;
  if (m.logins.active > 0 && idleDays === null) {
    reasons.push('Has never used the panel');
    bump('attention');
  } else if (idleDays !== null && idleDays >= 14) {
    reasons.push(`No activity for ${idleDays} days`);
    bump('critical');
  } else if (idleDays !== null && idleDays >= 5) {
    reasons.push(`No activity for ${idleDays} days`);
    bump('attention');
  }

  if (m.tickets.overdue > 0) {
    const share = m.tickets.open ? m.tickets.overdue / m.tickets.open : 0;
    reasons.push(`${m.tickets.overdue} ticket${m.tickets.overdue === 1 ? '' : 's'} past ETTR`);
    bump(m.tickets.overdue >= 5 || (m.tickets.overdue >= 3 && share >= 0.5) ? 'critical' : 'attention');
  }
  if (m.tickets.unassigned >= 3) {
    reasons.push(`${m.tickets.unassigned} open tickets not assigned to anyone`);
    bump('attention');
  }
  if (m.tickets.onTimeRate !== null && m.tickets.resolved >= 5 && m.tickets.onTimeRate < 60) {
    reasons.push(`Only ${m.tickets.onTimeRate}% resolved within ETTR`);
    bump('attention');
  }
  if (m.employees === 0) {
    reasons.push('No employees added — tickets cannot be assigned');
    bump('attention');
  }

  const label = { healthy: 'Healthy', attention: 'Needs attention', critical: 'Critical' }[level];
  return { level, label, reasons };
}

/** Last N audit entries, labelled with the client they belong to. */
async function recentActivity(filter, limit, tenantNames) {
  const rows = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('actorName actorRole action entityType entityLabel createdAt tenant meta')
    .lean();
  return rows.map((r) => ({ ...r, tenantName: tenantNames.get(String(r.tenant)) || '' }));
}

/** GET /api/owner/overview?days=30 — every client at a glance. */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const days = rangeDays(req.query.days);
    const tenants = await Tenant.find().sort({ name: 1 }).lean();
    const metrics = await collectMetrics(tenants.map((t) => t._id), { days, now });
    const names = new Map(tenants.map((t) => [String(t._id), t.name]));

    const clients = tenants.map((tenant) => {
      const m = metrics.get(String(tenant._id));
      return { ...tenant, metrics: m, health: healthOf(tenant, m, now) };
    });

    const sum = (pick) => clients.reduce((acc, cl) => acc + (pick(cl.metrics) || 0), 0);
    const platformTrend = emptySeries(days, now).map((d, i) => ({
      day: d.day,
      count: clients.reduce((acc, cl) => acc + cl.metrics.trend[i].count, 0),
    }));
    const resolved = sum((m) => m.tickets.resolved);
    const onTime = clients.reduce(
      (acc, cl) => acc + (cl.metrics.tickets.onTimeRate !== null ? (cl.metrics.tickets.onTimeRate / 100) * cl.metrics.tickets.resolved : 0),
      0,
    );

    res.json({
      success: true,
      serverTime: now,
      days,
      totals: {
        clients: clients.length,
        activeClients: clients.filter((cl) => cl.isActive).length,
        needsAttention: clients.filter((cl) => ['attention', 'critical'].includes(cl.health.level)).length,
        critical: clients.filter((cl) => cl.health.level === 'critical').length,
        customers: sum((m) => m.customers.total),
        customersAdded: sum((m) => m.customers.added),
        openTickets: sum((m) => m.tickets.open),
        overdueTickets: sum((m) => m.tickets.overdue),
        ticketsCreated: sum((m) => m.tickets.created),
        ticketsResolved: resolved,
        onTimeRate: resolved ? Math.round((onTime / resolved) * 100) : null,
        logins: sum((m) => m.logins.active),
        loginsActiveInRange: sum((m) => m.logins.activeInRange),
        billed: sum((m) => m.invoices.billed),
        outstanding: sum((m) => m.invoices.outstanding),
      },
      trend: platformTrend,
      clients,
      activity: await recentActivity({ tenant: { $in: tenants.map((t) => t._id) } }, 8, names),
    });
  }),
);

/** GET /api/owner/clients/:id?days=30 — one client in depth. */
router.get(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Client not found');
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) throw ApiError.notFound('Client not found');

    const now = new Date();
    const days = rangeDays(req.query.days);
    const since = new Date(now - days * DAY);
    const metrics = (await collectMetrics([tenant._id], { days, now })).get(String(tenant._id));
    const scope = { tenant: tenant._id };

    const [byStatus, byIssueType, workload, recentTickets, logins, activity] = await Promise.all([
      Ticket.aggregate([
        { $match: { ...scope, isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Ticket.aggregate([
        { $match: { ...scope, isDeleted: false, createdAt: { $gte: since } } },
        { $group: { _id: '$issueType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Ticket.aggregate([
        { $match: { ...scope, isDeleted: false, status: { $nin: CLOSED_STATUSES }, assignedTo: { $ne: null } } },
        {
          $group: {
            _id: '$assignedTo',
            name: { $first: '$assignedToName' },
            open: { $sum: 1 },
            overdue: { $sum: { $cond: [{ $lt: ['$ettrAt', now] }, 1, 0] } },
          },
        },
        { $sort: { open: -1 } },
        { $limit: 8 },
      ]),
      Ticket.find({ ...scope, isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('ticketNumber customerName customerReferenceNumber issueType priority status ettrAt createdAt resolvedAt assignedToName')
        .lean(),
      User.find({ ...scope, role: { $ne: ROLES.SUPERADMIN } })
        .sort({ lastLoginAt: -1 })
        .select('name username email isActive lastLoginAt createdAt')
        .lean(),
      recentActivity(scope, 25, new Map([[String(tenant._id), tenant.name]])),
    ]);

    const statusCounts = new Map(byStatus.map((r) => [r._id, r.count]));

    res.json({
      success: true,
      serverTime: now,
      days,
      client: { ...tenant, metrics, health: healthOf(tenant, metrics, now) },
      byStatus: TICKET_STATUSES.map((status) => ({ label: status, count: statusCounts.get(status) || 0 })),
      byIssueType: byIssueType.map((r) => ({ label: r._id || 'Unknown', count: r.count })),
      workload: workload.map((w) => ({ id: w._id, name: w.name || '—', open: w.open, overdue: w.overdue })),
      recentTickets: recentTickets.map((tk) => ({
        ...tk,
        overdue: !CLOSED_STATUSES.includes(tk.status) && new Date(tk.ettrAt) < now,
      })),
      logins,
      activity,
    });
  }),
);

/** GET /api/owner/activity?tenant=&page= — the full cross-client audit trail. */
router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 40 });
    const tenants = await Tenant.find().select('name').lean();
    const names = new Map(tenants.map((t) => [String(t._id), t.name]));

    const filter = { tenant: { $in: tenants.map((t) => t._id) } };
    if (req.query.tenant && mongoose.isValidObjectId(req.query.tenant)) filter.tenant = req.query.tenant;
    if (req.query.entityType) filter.entityType = req.query.entityType;

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('actorName actorRole action entityType entityLabel createdAt tenant meta')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items: items.map((r) => ({ ...r, tenantName: names.get(String(r.tenant)) || '' })),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);

export default router;
