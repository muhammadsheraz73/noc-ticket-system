import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Rejects the request unless a valid JWT belongs to an active user. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) throw ApiError.unauthorized('Missing authentication token');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired session, please sign in again');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account is inactive or no longer exists');
  }

  req.user = user;
  next();
});

/**
 * Role gate. Usage: `router.post('/', requireAuth, requireRole(ROLES.ADMIN), handler)`
 * Admin always passes.
 */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === 'admin' || allowed.includes(req.user.role)) return next();
    return next(
      ApiError.forbidden(`This action requires one of the following roles: ${allowed.join(', ')}`),
    );
  };
}

export default requireAuth;
