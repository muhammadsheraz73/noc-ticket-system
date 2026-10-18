import { Router } from 'express';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireOwner } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { seedTenantDefaults } from '../services/tenantService.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES } from '../utils/constants.js';
import { tenantSchema, tenantUpdateSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireOwner);

async function assertNameFree(name, excludeId) {
  const filter = { name };
  if (excludeId) filter._id = { $ne: excludeId };
  const taken = await Tenant.exists(filter).collation({ locale: 'en', strength: 2 });
  if (taken) throw ApiError.conflict(`A client named "${name}" already exists`);
}

/** GET /api/tenants — every client with how many logins it has. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [tenants, counts] = await Promise.all([
      Tenant.find().select('-logo').sort({ name: 1 }).lean(),
      User.aggregate([
        { $match: { role: { $ne: ROLES.SUPERADMIN }, tenant: { $ne: null } } },
        { $group: { _id: '$tenant', users: { $sum: 1 } } },
      ]),
    ]);
    const byTenant = new Map(counts.map((c) => [String(c._id), c.users]));

    res.json({
      success: true,
      items: tenants.map((t) => ({ ...t, userCount: byTenant.get(String(t._id)) || 0 })),
    });
  }),
);

/** GET /api/tenants/:id — one client in full, logo included (for the edit form). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) throw ApiError.notFound('Client not found');
    res.json({ success: true, tenant });
  }),
);

/** POST /api/tenants */
router.post(
  '/',
  validate(tenantSchema),
  asyncHandler(async (req, res) => {
    await assertNameFree(req.body.name);
    const tenant = await Tenant.create(req.body);
    await seedTenantDefaults(tenant._id);

    await recordAudit({
      req,
      action: 'create',
      entityType: 'Tenant',
      entityId: tenant._id,
      entityLabel: tenant.name,
    });
    res.status(201).json({ success: true, tenant });
  }),
);

/** PUT /api/tenants/:id — deactivating a client blocks every one of its logins. */
router.put(
  '/:id',
  validate(tenantUpdateSchema),
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) throw ApiError.notFound('Client not found');

    if (req.body.name) await assertNameFree(req.body.name, tenant._id);

    Object.assign(tenant, req.body);
    await tenant.save();

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Tenant',
      entityId: tenant._id,
      entityLabel: tenant.name,
    });
    res.json({ success: true, tenant });
  }),
);

export default router;
