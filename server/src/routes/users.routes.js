import { Router } from 'express';
import User from '../models/User.js';
import FieldTeam from '../models/FieldTeam.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES, ROLE_LABELS, ROLE_VALUES } from '../utils/constants.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema } from '../validators/schemas.js';

/**
 * A login account needs a FieldTeam record to be assignable to tickets.
 * Rather than making an admin create and link one by hand, keep it in sync
 * with the account automatically — every role is assignable — and mirror
 * the account's active state (never delete it — it may still carry ticket
 * history).
 */
async function syncFieldTeamLink(user) {
  const existing = await FieldTeam.findOne({ user: user._id });

  if (existing) {
    if (existing.isActive !== user.isActive) {
      existing.isActive = user.isActive;
      await existing.save();
    }
    return;
  }

  if (user.isActive) {
    await FieldTeam.create({
      name: user.name,
      kind: 'member',
      phone: user.phone || '',
      user: user._id,
      isActive: true,
    });
  }
}

/**
 * Reject a username or email already taken by somebody else. Mongo's unique
 * index is the last line of defence, but it is not built on serverless
 * deployments (`autoIndex: false`), so the check has to be explicit.
 */
async function assertCredentialsFree({ username, email }, excludeId) {
  const clashes = [];
  if (username) clashes.push({ username });
  if (email) clashes.push({ email });
  if (!clashes.length) return;

  const filter = { $or: clashes };
  if (excludeId) filter._id = { $ne: excludeId };

  const taken = await User.findOne(filter).select('username email').lean();
  if (!taken) return;

  if (username && taken.username === username) {
    throw ApiError.conflict(`The username "${username}" is already taken`);
  }
  throw ApiError.conflict('A user with this email already exists');
}

const router = Router();
router.use(requireAuth, requireRole(ROLES.ADMIN));

/** GET /api/users */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      items: users.map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.role] })),
      roles: ROLE_VALUES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    });
  }),
);

/** POST /api/users */
router.post(
  '/',
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    await assertCredentialsFree(req.body);

    const user = await User.create({
      name: req.body.name,
      username: req.body.username,
      email: req.body.email,
      role: req.body.role,
      phone: req.body.phone,
      isActive: req.body.isActive,
      passwordHash: await User.hashPassword(req.body.password),
    });

    await syncFieldTeamLink(user);

    await recordAudit({
      req,
      action: 'create',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.username,
      after: user,
    });

    res.status(201).json({ success: true, user });
  }),
);

/** PUT /api/users/:id */
router.put(
  '/:id',
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    const before = user.toObject();
    const { password, ...rest } = req.body;

    await assertCredentialsFree(rest, user._id);

    // An admin must not lock themselves out.
    if (String(user._id) === String(req.user._id)) {
      if (rest.isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');
      if (rest.role && rest.role !== ROLES.ADMIN) {
        throw ApiError.badRequest('You cannot remove your own admin role');
      }
    }

    Object.assign(user, rest);
    if (password) user.passwordHash = await User.hashPassword(password);
    await user.save();
    await syncFieldTeamLink(user);

    await recordAudit({
      req,
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.username,
      before,
      after: user,
    });

    res.json({ success: true, user });
  }),
);

/**
 * POST /api/users/:id/reset-password — admin issues a new password.
 *
 * Separate from PUT so handing out fresh credentials never means re-submitting
 * the whole profile, and so the audit trail names the action for what it is.
 */
router.post(
  '/:id/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    user.passwordHash = await User.hashPassword(req.body.password);
    await user.save();

    await recordAudit({
      req,
      action: 'change_password',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.username,
    });

    res.json({ success: true, message: `Password reset for ${user.name}`, user });
  }),
);

/** DELETE /api/users/:id — permanently deletes the login account. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot delete your own account');
    }

    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    // Field team members keep their history, but the login link must not
    // dangle once the account is gone.
    await FieldTeam.updateMany({ user: user._id }, { $unset: { user: '' } });
    await user.deleteOne();

    await recordAudit({
      req,
      action: 'delete',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.username,
    });

    res.json({ success: true, message: `${user.name} permanently deleted` });
  }),
);

export default router;
