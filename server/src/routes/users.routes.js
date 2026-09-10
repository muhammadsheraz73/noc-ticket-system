import { Router } from 'express';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES, ROLE_LABELS, ROLE_VALUES } from '../utils/constants.js';
import { createUserSchema, updateUserSchema } from '../validators/schemas.js';

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
    const exists = await User.findOne({ email: req.body.email }).lean();
    if (exists) throw ApiError.conflict('A user with this email already exists');

    const user = await User.create({
      name: req.body.name,
      email: req.body.email,
      role: req.body.role,
      phone: req.body.phone,
      isActive: req.body.isActive,
      passwordHash: await User.hashPassword(req.body.password),
    });

    await recordAudit({
      req,
      action: 'create',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.email,
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

    await recordAudit({
      req,
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.email,
      before,
      after: user,
    });

    res.json({ success: true, user });
  }),
);

/** DELETE /api/users/:id — deactivates the account. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }

    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    user.isActive = false;
    await user.save();

    await recordAudit({
      req,
      action: 'deactivate',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.email,
    });

    res.json({ success: true, message: `${user.name} deactivated` });
  }),
);

export default router;
