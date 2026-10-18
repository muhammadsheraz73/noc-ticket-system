import { Router } from 'express';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES } from '../utils/constants.js';
import { companyProfileSchema } from '../validators/schemas.js';

/**
 * The signed-in client's own company profile — the letterhead printed on its
 * quotations. Name, colour and status stay with the panel owner.
 */
const router = Router();
router.use(requireAuth);

const PROFILE_FIELDS = 'name contactName phone email address website logo quotationTerms bankAccounts themeColor';

/** GET /api/company */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const company = await Tenant.findById(req.tenant._id).select(PROFILE_FIELDS).lean();
    res.json({ success: true, company });
  }),
);

/** PUT /api/company — client admins only. */
router.put(
  '/',
  requireRole(ROLES.ADMIN),
  validate(companyProfileSchema),
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findById(req.tenant._id);
    if (!tenant) throw ApiError.notFound('Company not found');

    Object.assign(tenant, req.body);
    await tenant.save();

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Company',
      entityId: tenant._id,
      entityLabel: tenant.name,
      meta: { fields: Object.keys(req.body).filter((k) => k !== 'logo').concat('logo' in req.body ? ['logo'] : []) },
    });

    const company = await Tenant.findById(tenant._id).select(PROFILE_FIELDS).lean();
    res.json({ success: true, company });
  }),
);

export default router;
