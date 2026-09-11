import { Router } from 'express';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { loginSchema, changePasswordSchema } from '../validators/schemas.js';
import { recordAudit } from '../utils/audit.js';
import { ROLE_LABELS } from '../utils/constants.js';

const router = Router();

/** POST /api/auth/login */
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;

    // Admins hand out a username; the email works just as well as a login.
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    }).select('+passwordHash');

    // Same message for an unknown account and a wrong password — no enumeration.
    if (!user || !(await user.comparePassword(password))) {
      throw ApiError.unauthorized('Invalid username or password');
    }
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

    user.lastLoginAt = new Date();
    await user.save();

    await recordAudit({ req: { ...req, user }, action: 'login', entityType: 'User', entityId: user._id });

    res.json({
      success: true,
      token: signToken(user),
      user: { ...user.toJSON(), roleLabel: ROLE_LABELS[user.role] },
    });
  }),
);

/** GET /api/auth/me */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      user: { ...req.user.toJSON(), roleLabel: ROLE_LABELS[req.user.role] },
      serverTime: new Date(),
    });
  }),
);

/** POST /api/auth/logout — JWTs are stateless; this exists for the audit trail. */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await recordAudit({ req, action: 'logout', entityType: 'User', entityId: req.user._id });
    res.json({ success: true, message: 'Signed out' });
  }),
);

/** POST /api/auth/change-password */
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await user.comparePassword(req.body.currentPassword))) {
      throw ApiError.badRequest('Current password is incorrect');
    }

    user.passwordHash = await User.hashPassword(req.body.newPassword);
    await user.save();

    await recordAudit({ req, action: 'change_password', entityType: 'User', entityId: user._id });
    res.json({ success: true, message: 'Password updated' });
  }),
);

export default router;
