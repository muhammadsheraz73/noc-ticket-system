import rateLimit from 'express-rate-limit';

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

/** Broad safety net for the rest of the API. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});
