import { Router } from 'express';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import Invoice from '../models/Invoice.js';
import FieldTeam from '../models/FieldTeam.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { startOfLocalDay } from '../utils/datetime.js';
import { CLOSED_STATUSES, ROLES } from '../utils/constants.js';
import { decorateTicket } from '../services/ticketService.js';
import { fieldEngineerScope, assigneeFilter } from '../services/searchService.js';
import { recentActivityFor, ACTIVITY_SCOPE_LABELS } from '../services/activityService.js';

const router = Router();
router.use(requireAuth);

/** GET /api/dashboard */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const todayStart = startOfLocalDay(now);

    const ticketScope = { isDeleted: false };
    if (req.user.role === ROLES.FIELD_ENGINEER) {
      Object.assign(ticketScope, assigneeFilter(await fieldEngineerScope(req.user)));
    }

    const openFilter = { ...ticketScope, status: { $nin: CLOSED_STATUSES } };
    const canSeeInvoices = [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR].includes(req.user.role);

    const [
      totalCustomers,
      totalTickets,
      openTickets,
      urgentTickets,
      overdueTickets,
      inProgressTickets,
      onHoldTickets,
      resolvedToday,
      createdToday,
      pendingInvoices,
      totalFieldMembers,
      byIssueType,
      byPriority,
      recentTickets,
      recentActivity,
      invoiceTotals,
    ] = await Promise.all([
      Customer.countDocuments({ isDeleted: false }),
      Ticket.countDocuments(ticketScope),
      Ticket.countDocuments(openFilter),
      Ticket.countDocuments({ ...openFilter, priority: 'Urgent' }),
      Ticket.countDocuments({ ...openFilter, ettrAt: { $lt: now } }),
      Ticket.countDocuments({ ...ticketScope, status: 'In Progress' }),
      Ticket.countDocuments({ ...ticketScope, status: 'On Hold' }),
      Ticket.countDocuments({ ...ticketScope, resolvedAt: { $gte: todayStart } }),
      Ticket.countDocuments({ ...ticketScope, createdAt: { $gte: todayStart } }),
      canSeeInvoices
        ? Invoice.countDocuments({ isDeleted: false, status: { $in: ['Draft', 'Unpaid'] } })
        : Promise.resolve(0),
      FieldTeam.countDocuments({ isActive: true, kind: 'member' }),
      Ticket.aggregate([
        { $match: openFilter },
        { $group: { _id: '$issueType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.aggregate([
        { $match: openFilter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Ticket.find(ticketScope).sort({ createdAt: -1 }).limit(8).populate('customer').lean(),
      recentActivityFor(req.user, 12),
      canSeeInvoices
        ? Invoice.aggregate([
            { $match: { isDeleted: false, status: { $ne: 'Cancelled' } } },
            { $group: { _id: '$status', amount: { $sum: '$total' }, count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      serverTime: now,
      stats: {
        totalCustomers,
        totalTickets,
        openTickets,
        urgentTickets,
        overdueTickets,
        inProgressTickets,
        onHoldTickets,
        resolvedToday,
        createdToday,
        pendingInvoices,
        totalFieldMembers,
      },
      charts: {
        byIssueType: byIssueType.map((r) => ({ label: r._id || 'Unknown', count: r.count })),
        byPriority: byPriority.map((r) => ({ label: r._id || 'Unknown', count: r.count })),
      },
      invoiceTotals,
      recentTickets: recentTickets.map((t) => decorateTicket(t, t.customer, now)),
      activityScope: ACTIVITY_SCOPE_LABELS[req.user.role] || '',
      recentActivity: recentActivity.map((entry) => ({
        _id: entry._id,
        actorName: entry.actorName,
        action: entry.action,
        entityType: entry.entityType,
        entityLabel: entry.entityLabel,
        note: entry.meta?.note || '',
        createdAt: entry.createdAt,
      })),
    });
  }),
);

export default router;
