import { Router } from 'express';
import Customer from '../models/Customer.js';
import Ticket from '../models/Ticket.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';
import { analyzeTicket, aiStatusInfo } from '../services/aiService.js';
import { requireActiveCustomer } from '../services/ticketService.js';

const router = Router();
router.use(requireAuth);

/** GET /api/ai/status — lets the UI show whether AI is configured. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, ...aiStatusInfo() });
  }),
);

/**
 * POST /api/ai/analyze-ticket
 *
 * Works both for a draft (before the ticket exists) and for a saved ticket.
 * Never throws on AI failure — the caller gets a status object instead.
 */
router.post(
  '/analyze-ticket',
  requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR),
  asyncHandler(async (req, res) => {
    const { ticketNumber, customerId, issueType, remarks, priority, ettrMinutes } = req.body;

    let customer = null;
    let ticket = null;

    if (ticketNumber) {
      ticket = await Ticket.findOne({ ticketNumber: Number(ticketNumber), isDeleted: false });
      if (ticket) customer = await Customer.findById(ticket.customer).lean();
    }
    if (!customer && customerId) {
      customer = (await requireActiveCustomer(customerId)).toObject();
    }

    const analysis = await analyzeTicket({
      issueType: issueType || ticket?.issueType,
      remarks: remarks ?? ticket?.remarks,
      priority: priority || ticket?.priority,
      ettrMinutes: ettrMinutes || ticket?.ettrMinutes,
      customer,
    });

    if (ticket) {
      ticket.ai = analysis;
      await ticket.save();
    }

    res.json({ success: true, ai: analysis });
  }),
);

export default router;
