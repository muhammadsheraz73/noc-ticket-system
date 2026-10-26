import { Router } from 'express';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES, ROLE_LABELS } from '../utils/constants.js';
import { resetPasswordSchema, teamMemberSchema, teamMemberUpdateSchema } from '../validators/schemas.js';
import { assertCredentialsFree } from './users.routes.js';

/**
 * A client's billing department: Accounts logins the client's own Admin
 * creates. They share the client's data but only reach billing, invoices and
 * quotations (see ACCOUNTS_ALLOWED in middleware/auth.js), so everything they
 * do shows up in the Admin's panel too.
 */
const router = Router();
router.use(requireAuth);
router.use((req, _res, next) => (
  req.user.role === ROLES.ADMIN
    ? next()
    : next(ApiError.forbidden('Only the client admin can manage the billing team'))
));

/** Users are not tenant-scoped by the plugin, so every query names the client explicitly. */
const scope = (req) => ({ tenant: req.tenant._id, role: ROLES.ACCOUNTS });

async function findMember(req) {
  const member = await User.findOne({ ...scope(req), _id: req.params.id });
  if (!member) throw ApiError.notFound('Team member not found');
  return member;
}

const present = (user) => ({ ...user.toJSON(), roleLabel: ROLE_LABELS[user.role] });

/** GET /api/team */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await User.find(scope(req)).sort({ createdAt: -1 });
    res.json({ success: true, items: members.map(present) });
  }),
);

/** POST /api/team */
router.post(
  '/',
  validate(teamMemberSchema),
  asyncHandler(async (req, res) => {
    await assertCredentialsFree(req.body);

    const member = await User.create({
      tenant: req.tenant._id,
      role: ROLES.ACCOUNTS,
      name: req.body.name,
      username: req.body.username,
      email: req.body.email,
      phone: req.body.phone,
      isActive: req.body.isActive,
      passwordHash: await User.hashPassword(req.body.password),
    });

    await recordAudit({
      req,
      action: 'create',
      entityType: 'User',
      entityId: member._id,
      entityLabel: member.username,
      after: member,
    });

    res.status(201).json({ success: true, user: present(member) });
  }),
);

/** PUT /api/team/:id */
router.put(
  '/:id',
  validate(teamMemberUpdateSchema),
  asyncHandler(async (req, res) => {
    const member = await findMember(req);
    const before = member.toObject();
    const { password, ...rest } = req.body;

    await assertCredentialsFree(rest, member._id);

    Object.assign(member, rest);
    if (password) member.passwordHash = await User.hashPassword(password);
    await member.save();

    await recordAudit({
      req,
      action: 'update',
      entityType: 'User',
      entityId: member._id,
      entityLabel: member.username,
      before,
      after: member,
    });

    res.json({ success: true, user: present(member) });
  }),
);

/** POST /api/team/:id/reset-password */
router.post(
  '/:id/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const member = await findMember(req);
    member.passwordHash = await User.hashPassword(req.body.password);
    await member.save();

    await recordAudit({
      req,
      action: 'change_password',
      entityType: 'User',
      entityId: member._id,
      entityLabel: member.username,
    });

    res.json({ success: true, message: `Password reset for ${member.name}`, user: present(member) });
  }),
);

/** DELETE /api/team/:id — invoices and quotations they made stay, with their name on them. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const member = await findMember(req);
    await member.deleteOne();

    await recordAudit({
      req,
      action: 'delete',
      entityType: 'User',
      entityId: member._id,
      entityLabel: member.username,
    });

    res.json({ success: true, message: `${member.name} permanently deleted` });
  }),
);

export default router;
