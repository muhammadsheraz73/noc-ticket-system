import { Router } from 'express';
import FieldTeam from '../models/FieldTeam.js';
import Ticket from '../models/Ticket.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES, CLOSED_STATUSES } from '../utils/constants.js';
import { fieldTeamSchema, fieldTeamUpdateSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

const canWrite = requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR);

/** GET /api/field-teams */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.kind) filter.kind = req.query.kind;
    if (req.query.active !== 'all') filter.isActive = true;
    // Tickets can only be assigned to a member with a linked login account.
    if (req.query.assignable === 'true') filter.user = { $ne: null };

    const items = await FieldTeam.find(filter)
      .sort({ kind: 1, name: 1 })
      .populate('team', 'name')
      .populate('user', 'name email role')
      .lean();

    const workload = await Ticket.aggregate([
      { $match: { isDeleted: false, status: { $nin: CLOSED_STATUSES }, assignedTo: { $ne: null } } },
      { $group: { _id: '$assignedTo', open: { $sum: 1 } } },
    ]);
    const workloadById = new Map(workload.map((w) => [String(w._id), w.open]));

    res.json({
      success: true,
      items: items.map((item) => ({ ...item, openTickets: workloadById.get(String(item._id)) || 0 })),
    });
  }),
);

/** GET /api/field-teams/:id — record plus its ticket history. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const member = await FieldTeam.findById(req.params.id).populate('team', 'name').lean();
    if (!member) throw ApiError.notFound('Field team/member not found');

    const tickets = await Ticket.find({ assignedTo: member._id, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, member, tickets });
  }),
);

/** POST /api/field-teams */
router.post(
  '/',
  canWrite,
  validate(fieldTeamSchema),
  asyncHandler(async (req, res) => {
    const member = await FieldTeam.create(req.body);
    await recordAudit({
      req,
      action: 'create',
      entityType: 'FieldTeam',
      entityId: member._id,
      entityLabel: member.name,
      after: member,
    });
    res.status(201).json({ success: true, member });
  }),
);

/** PUT /api/field-teams/:id */
router.put(
  '/:id',
  canWrite,
  validate(fieldTeamUpdateSchema),
  asyncHandler(async (req, res) => {
    const member = await FieldTeam.findById(req.params.id);
    if (!member) throw ApiError.notFound('Field team/member not found');

    const before = member.toObject();
    Object.assign(member, req.body);
    await member.save();

    // Keep the denormalized name on open tickets in step.
    if (before.name !== member.name) {
      await Ticket.updateMany({ assignedTo: member._id }, { $set: { assignedToName: member.name } });
    }

    await recordAudit({
      req,
      action: 'update',
      entityType: 'FieldTeam',
      entityId: member._id,
      entityLabel: member.name,
      before,
      after: member,
    });

    res.json({ success: true, member });
  }),
);

/** DELETE /api/field-teams/:id — deactivate rather than delete. */
router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const member = await FieldTeam.findById(req.params.id);
    if (!member) throw ApiError.notFound('Field team/member not found');

    const open = await Ticket.countDocuments({
      assignedTo: member._id,
      isDeleted: false,
      status: { $nin: CLOSED_STATUSES },
    });
    if (open > 0) {
      throw ApiError.badRequest(`${member.name} still has ${open} open ticket(s). Reassign them first.`);
    }

    member.isActive = false;
    await member.save();

    await recordAudit({
      req,
      action: 'deactivate',
      entityType: 'FieldTeam',
      entityId: member._id,
      entityLabel: member.name,
    });

    res.json({ success: true, message: `${member.name} deactivated` });
  }),
);

export default router;
