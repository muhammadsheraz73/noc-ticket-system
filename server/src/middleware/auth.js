import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { runWithTenant } from '../utils/tenantContext.js';
import { ROLES } from '../utils/constants.js';

/** Extra token lifetime beyond the idle limit, so a request made just before the browser's own sign-out still succeeds. */
const GRACE_MINUTES = 2;
/** A token older than this is swapped for a fresh one on the next request. */
const RENEW_AFTER_SECONDS = 60;

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: `${env.sessionIdleMinutes + GRACE_MINUTES}m` },
  );
}

/**
 * Sliding session: every authenticated request older than a minute gets a
 * renewed token in `X-Session-Token`, so an active user stays signed in while
 * an idle one's token simply runs out on the server too.
 */
function renewToken(res, user, payload) {
  if (Date.now() / 1000 - (payload.iat || 0) > RENEW_AFTER_SECONDS) {
    res.setHeader('X-Session-Token', signToken(user));
  }
}

/**
 * The only APIs a billing-department (Accounts) login may reach. Kept as one
 * allowlist here rather than per router, so a newly added route stays closed
 * to them until somebody decides otherwise.
 */
const ACCOUNTS_ALLOWED = [
  { prefix: '/api/auth' },
  { prefix: '/api/billing' },
  { prefix: '/api/invoices' },
  { prefix: '/api/quotations' },
  // Read-only lookups the billing screens need: customer picker, letterhead, currency.
  { prefix: '/api/customers', readOnly: true },
  { prefix: '/api/company', readOnly: true },
  { prefix: '/api/meta', readOnly: true },
];

function accountsMayUse(req) {
  const path = req.originalUrl.split('?')[0];
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  return ACCOUNTS_ALLOWED.some(
    (rule) => (path === rule.prefix || path.startsWith(`${rule.prefix}/`)) && (!rule.readOnly || isRead),
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
  return asyncHandler(async (req, res, next) => {
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
      renewToken(res, user, payload);
      return next();
    }

    if (allow === 'owner') throw ApiError.forbidden('Only the panel owner can do this');

    // A login that is not attached to a live client must never see any data.
    const tenant = user.tenant ? await Tenant.findById(user.tenant).select('-logo').lean() : null;
    if (!tenant || !tenant.isActive) {
      throw ApiError.unauthorized('Your company account is inactive. Please contact support.');
    }

    if (user.role === ROLES.ACCOUNTS && !accountsMayUse(req)) {
      throw ApiError.forbidden('The billing panel only has access to billing, invoices and quotations');
    }

    req.user = user;
    req.tenant = tenant;
    renewToken(res, user, payload);
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
