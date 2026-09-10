import { Router } from 'express';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import Customer from '../models/Customer.js';
import FieldTeam from '../models/FieldTeam.js';
import Invoice from '../models/Invoice.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex, parsePagination, parseSort } from '../utils/search.js';
import { ROLES, CLOSED_STATUSES } from '../utils/constants.js';
import {
  createTicketSchema,
  updateTicketSchema,
  assignTicketSchema,
  resolveTicketSchema,
} from '../validators/schemas.js';
import {
  createTicket,
  decorateTicket,
  refreshGeneratedText,
  pushHistory,
} from '../services/ticketService.js';
import { fieldEngineerScope } from '../services/searchService.js';
import { analyzeTicket, aiStatusInfo } from '../services/aiService.js';
import { addMinutes } from '../utils/datetime.js';
import { findInternalLeaks } from '../utils/ticketFormatter.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(requireAuth);

const canOperate = requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR);

/** GET /api/tickets */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };

    if (req.user.role === ROLES.FIELD_ENGINEER) {
      filter.assignedTo = await fieldEngineerScope(req.user);
    }

    if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
    if (req.query.priority) filter.priority = { $in: String(req.query.priority).split(',') };
    if (req.query.issueType) filter.issueType = String(req.query.issueType);
    if (req.query.assignedTo && mongoose.isValidObjectId(req.query.assignedTo)) {
      filter.assignedTo = req.query.assignedTo;
    }
    if (req.query.customer) filter.customerReferenceNumber = String(req.query.customer);
    if (req.query.open === 'true') filter.status = { $nin: CLOSED_STATUSES };
    if (req.query.overdue === 'true') {
      filter.status = { $nin: CLOSED_STATUSES };
      filter.ettrAt = { $lt: new Date() };
    }

    if (req.query.q) {
      const q = String(req.query.q).trim();
      const rx = containsRegex(q);
      const asNumber = Number.parseInt(q, 10);
      filter.$or = [
        ...(Number.isFinite(asNumber) && /^\d+$/.test(q) ? [{ ticketNumber: asNumber }] : []),
        { customerReferenceNumber: rx },
        { customerName: rx },
        { issueType: rx },
        { remarks: rx },
        { assignedToName: rx },
      ];
    }

    const sort = parseSort(req.query.sort, { createdAt: -1 }, [
      'createdAt',
      'ticketNumber',
      'ettrAt',
      'priority',
      'status',
    ]);

    const [items, total] = await Promise.all([
      Ticket.find(filter).sort(sort).skip(skip).limit(limit).populate('customer').lean(),
      Ticket.countDocuments(filter),
    ]);

    const now = new Date();
    res.json({
      success: true,
      serverTime: now,
      items: items.map((t) => decorateTicket(t, t.customer, now)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }),
);

/** POST /api/tickets — creates the ticket, then runs AI analysis without blocking. */
router.post(
  '/',
  canOperate,
  validate(createTicketSchema),
  asyncHandler(async (req, res) => {
    const { ticket, customer } = await createTicket({ payload: req.body, user: req.user });

    await recordAudit({
      req,
      action: 'create',
      entityType: 'Ticket',
      entityId: ticket._id,
      entityLabel: `TID ${ticket.ticketNumber}`,
      after: ticket,
    });

    // Respond immediately — AI must never delay or block ticket creation.
    res.status(201).json({
      success: true,
      ticket: decorateTicket(ticket, customer),
      customer,
      ai: aiStatusInfo(),
    });

    if (req.body.runAiAnalysis !== false) {
      runAnalysisInBackground(ticket._id, customer);
    }
  }),
);

/** GET /api/tickets/:id — by Mongo id or by TID. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    const customer = await Customer.findById(ticket.customer).lean();
    const invoices = await Invoice.find({ ticket: ticket._id, isDeleted: false }).lean();

    res.json({
      success: true,
      ticket: decorateTicket(ticket, customer),
      customer,
      invoices,
    });
  }),
);

/**
 * GET /api/tickets/:id/verify-visibility
 * Proves the generated ticket contains no internal network data
 * (acceptance test #5).
 */
router.get(
  '/:id/verify-visibility',
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    const customer = await Customer.findById(ticket.customer).lean();
    const decorated = decorateTicket(ticket, customer);
    const leaks = findInternalLeaks(decorated.generatedText, customer);

    res.json({
      success: true,
      ticketNumber: ticket.ticketNumber,
      compliant: leaks.length === 0,
      leaks,
      checkedFields: ['address', 'type', 'sourcePort', 'destinationPort', 'vlan'],
      generatedText: decorated.generatedText,
    });
  }),
);

/** PUT /api/tickets/:id */
router.put(
  '/:id',
  validate(updateTicketSchema),
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    const before = ticket.toObject();

    // A field engineer may only move the status and add a note on their own tickets.
    if (req.user.role === ROLES.FIELD_ENGINEER) {
      const allowed = ['status', 'note', 'remarks'];
      for (const key of Object.keys(req.body)) {
        if (!allowed.includes(key)) {
          throw ApiError.forbidden('Field engineers can only update status and remarks');
        }
      }
    } else if (![ROLES.ADMIN, ROLES.NOC_OPERATOR].includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to update tickets');
    }

    if (req.body.status && req.body.status !== ticket.status) {
      pushHistory(ticket, {
        user: req.user,
        action: 'status_change',
        from: ticket.status,
        to: req.body.status,
        note: req.body.note,
      });

      if (CLOSED_STATUSES.includes(req.body.status) && !ticket.resolvedAt) {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = req.user._id;
      }
      if (!CLOSED_STATUSES.includes(req.body.status)) {
        ticket.resolvedAt = undefined;
        ticket.closedAt = undefined;
      }
      if (req.body.status === 'Closed') ticket.closedAt = new Date();
      ticket.status = req.body.status;
    }

    if (req.body.ettrMinutes && req.body.ettrMinutes !== ticket.ettrMinutes) {
      pushHistory(ticket, {
        user: req.user,
        action: 'ettr_change',
        from: `${ticket.ettrMinutes}m`,
        to: `${req.body.ettrMinutes}m`,
      });
      ticket.ettrMinutes = req.body.ettrMinutes;
      // ETTR always recomputes from the stored creation time on server clock.
      ticket.ettrAt = addMinutes(ticket.createdAt, req.body.ettrMinutes);
    }

    for (const field of ['issueType', 'remarks', 'priority']) {
      if (req.body[field] !== undefined && req.body[field] !== ticket[field]) {
        pushHistory(ticket, {
          user: req.user,
          action: `${field}_change`,
          from: ticket[field],
          to: req.body[field],
        });
        ticket[field] = req.body[field];
      }
    }

    const customer = await Customer.findById(ticket.customer);
    await refreshGeneratedText(ticket, customer);
    await ticket.save();

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Ticket',
      entityId: ticket._id,
      entityLabel: `TID ${ticket.ticketNumber}`,
      before,
      after: ticket,
    });

    res.json({ success: true, ticket: decorateTicket(ticket, customer) });
  }),
);

/** POST /api/tickets/:id/assign */
router.post(
  '/:id/assign',
  canOperate,
  validate(assignTicketSchema),
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);

    const assignee = await FieldTeam.findOne({ _id: req.body.assignedTo, isActive: true });
    if (!assignee) throw ApiError.badRequest('The selected field team/member is not available');

    const previous = ticket.assignedToName || 'unassigned';
    ticket.assignedTo = assignee._id;
    ticket.assignedToName = assignee.name;
    ticket.assignedAt = new Date();
    if (ticket.status === 'New') ticket.status = 'In Progress';

    pushHistory(ticket, {
      user: req.user,
      action: 'assigned',
      from: previous,
      to: assignee.name,
      note: req.body.note,
    });

    const customer = await Customer.findById(ticket.customer);
    await refreshGeneratedText(ticket, customer);
    await ticket.save();

    await recordAudit({
      req,
      action: 'assign',
      entityType: 'Ticket',
      entityId: ticket._id,
      entityLabel: `TID ${ticket.ticketNumber}`,
      meta: { from: previous, to: assignee.name },
    });

    res.json({ success: true, ticket: decorateTicket(ticket, customer) });
  }),
);

/** POST /api/tickets/:id/resolve */
router.post(
  '/:id/resolve',
  requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER),
  validate(resolveTicketSchema),
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    if (CLOSED_STATUSES.includes(ticket.status)) {
      throw ApiError.badRequest(`Ticket is already ${ticket.status}`);
    }

    const from = ticket.status;
    ticket.status = req.body.status;
    ticket.resolvedAt = new Date();
    ticket.resolvedBy = req.user._id;
    ticket.resolutionRemarks = req.body.resolutionRemarks;
    if (req.body.status === 'Closed') ticket.closedAt = new Date();

    pushHistory(ticket, {
      user: req.user,
      action: 'resolved',
      from,
      to: req.body.status,
      note: req.body.resolutionRemarks,
    });

    const customer = await Customer.findById(ticket.customer);
    await refreshGeneratedText(ticket, customer);
    await ticket.save();

    await recordAudit({
      req,
      action: 'resolve',
      entityType: 'Ticket',
      entityId: ticket._id,
      entityLabel: `TID ${ticket.ticketNumber}`,
      meta: { from, to: req.body.status },
    });

    res.json({ success: true, ticket: decorateTicket(ticket, customer) });
  }),
);

/** POST /api/tickets/:id/analyze — retry the AI analysis on demand. */
router.post(
  '/:id/analyze',
  canOperate,
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);
    const customer = await Customer.findById(ticket.customer).lean();

    ticket.ai = { ...(ticket.ai?.toObject?.() ?? ticket.ai ?? {}), status: 'pending' };
    await ticket.save();

    const analysis = await analyzeTicket({
      issueType: ticket.issueType,
      remarks: ticket.remarks,
      priority: ticket.priority,
      ettrMinutes: ticket.ettrMinutes,
      customer,
    });

    ticket.ai = analysis;
    await ticket.save();

    res.json({ success: true, ai: analysis });
  }),
);

/** DELETE /api/tickets/:id — admin-only soft delete. */
router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const ticket = await findTicket(req.params.id, req.user);

    const invoices = await Invoice.countDocuments({ ticket: ticket._id, isDeleted: false });
    if (invoices > 0) {
      throw ApiError.badRequest(`This ticket has ${invoices} linked invoice(s) and cannot be deleted`);
    }

    ticket.isDeleted = true;
    ticket.deletedAt = new Date();
    await ticket.save();

    await recordAudit({
      req,
      action: 'soft_delete',
      entityType: 'Ticket',
      entityId: ticket._id,
      entityLabel: `TID ${ticket.ticketNumber}`,
    });

    res.json({ success: true, message: 'Ticket archived (soft deleted)' });
  }),
);

/** Look a ticket up by Mongo id or TID, applying the caller's visibility scope. */
async function findTicket(idOrNumber, user) {
  const value = String(idOrNumber || '').trim();
  const filter = { isDeleted: false };

  if (mongoose.isValidObjectId(value)) {
    filter._id = value;
  } else if (/^\d+$/.test(value)) {
    filter.ticketNumber = Number.parseInt(value, 10);
  } else {
    throw ApiError.badRequest('Provide a ticket id or TID number');
  }

  if (user.role === ROLES.FIELD_ENGINEER) {
    filter.assignedTo = await fieldEngineerScope(user);
  }

  const ticket = await Ticket.findOne(filter);
  if (!ticket) throw ApiError.notFound(`No ticket found for "${value}"`);
  return ticket;
}

/** Fire-and-forget AI analysis; failures are stored on the ticket, never thrown. */
function runAnalysisInBackground(ticketId, customer) {
  setImmediate(async () => {
    try {
      const ticket = await Ticket.findById(ticketId).lean();
      if (!ticket) return;

      const analysis = await analyzeTicket({
        issueType: ticket.issueType,
        remarks: ticket.remarks,
        priority: ticket.priority,
        ettrMinutes: ticket.ettrMinutes,
        customer,
      });
      await Ticket.updateOne({ _id: ticketId }, { $set: { ai: analysis } });
    } catch (error) {
      logger.warn(`Background AI analysis failed for ticket ${ticketId}: ${error.message}`);
      await Ticket.updateOne(
        { _id: ticketId },
        { $set: { 'ai.status': 'failed', 'ai.error': error.message, 'ai.analyzedAt': new Date() } },
      ).catch(() => {});
    }
  });
}

export default router;
