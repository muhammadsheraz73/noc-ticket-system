import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { runWithTenant } from '../utils/tenantContext.js';
import { ROLES } from '../utils/constants.js';

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

/**
 * Validates the JWT, loads the account and its client, and runs the rest of
 * the request inside that client's tenant scope.
 *
 * `allow` decides who may pass:
 *  - 'tenant' — a client login (the default for all business data)
 *  - 'owner'  — the panel owner only (clients and logins management)
 *  - 'any'    — either (sign-in housekeeping such as /auth/me)
 */
function authenticate(allow) {
  return asyncHandler(async (req, _res, next) => {
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

    const isOwner = user.role === ROLES.SUPERADMIN;

    if (isOwner) {
      if (allow === 'tenant') throw ApiError.forbidden('The owner account has no client data');
      req.user = user;
      return next();
    }

    if (allow === 'owner') throw ApiError.forbidden('Only the panel owner can do this');

    // A login that is not attached to a live client must never see any data.
    const tenant = user.tenant ? await Tenant.findById(user.tenant).select('-logo').lean() : null;
    if (!tenant || !tenant.isActive) {
      throw ApiError.unauthorized('Your company account is inactive. Please contact support.');
    }

    req.user = user;
    req.tenant = tenant;
    return runWithTenant(tenant._id, next);
  });
}

/** Rejects the request unless a valid JWT belongs to an active client login. */
export const requireAuth = authenticate('tenant');

/** The panel owner only. */
export const requireOwner = authenticate('owner');

/** Owner or client login — for endpoints that are about the account itself. */
export const requireAnyAuth = authenticate('any');

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
