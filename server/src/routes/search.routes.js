import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { globalSearch } from '../services/searchService.js';

const router = Router();
router.use(requireAuth);

/** GET /api/search?q=... */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const results = await globalSearch(req.query.q, { user: req.user, limit });
    res.json({ success: true, ...results });
  }),
);

export default router;
