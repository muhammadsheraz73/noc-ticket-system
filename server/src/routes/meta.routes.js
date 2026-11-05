import { Router } from 'express';
import IssueType from '../models/IssueType.js';
import AuditLog from '../models/AuditLog.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { issueTypeSchema } from '../validators/schemas.js';
import Tenant from '../models/Tenant.js';
import { DEFAULT_ISSUE_TYPES, LATER_ISSUE_TYPES } from '../utils/constants.js';
import { getTenantId } from '../utils/tenantContext.js';

/**
 * Give an existing client the issue types added since it was created
 * (LATER_ISSUE_TYPES) — once. Only inserts a type the client does not have
 * (`$setOnInsert`), so a type it already has, even switched off, is never
 * touched; the client is then marked so a type it later deletes stays gone.
 */
async function ensureLaterIssueTypes() {
  const tenantId = getTenantId();
  if (!tenantId) return;
  const tenant = await Tenant.findById(tenantId).select('issueTypesAdded').lean();
  const missing = LATER_ISSUE_TYPES.filter((name) => !(tenant?.issueTypesAdded || []).includes(name));
  if (!missing.length) return;
  for (const name of missing) {
    await IssueType.updateOne(
      { name },
      { $setOnInsert: { name, sortOrder: DEFAULT_ISSUE_TYPES.indexOf(name) * 10, defaultEttrMinutes: 120, isActive: true } },
      { upsert: true },
    );
  }
  await Tenant.updateOne({ _id: tenantId }, { $addToSet: { issueTypesAdded: { $each: missing } } });
}
import { parsePagination } from '../utils/search.js';
import env from '../config/env.js';
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  INVOICE_STATUSES,
  CUSTOMER_TYPES,
  ETTR_PRESETS,
  ROLES,
  ROLE_LABELS,
  ROLE_VALUES,
} from '../utils/constants.js';

const router = Router();
router.use(requireAuth);

/** GET /api/meta — everything the UI needs to build its dropdowns. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    await ensureLaterIssueTypes();
    const issueTypes = await IssueType.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    res.json({
      success: true,
      serverTime: new Date(),
      timezone: env.timezone,
      currency: env.invoice.currency,
      issueTypes,
      statuses: TICKET_STATUSES,
      priorities: TICKET_PRIORITIES,
      invoiceStatuses: INVOICE_STATUSES,
      customerTypes: CUSTOMER_TYPES,
      ettrPresets: ETTR_PRESETS,
      roles: ROLE_VALUES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    });
  }),
);

/** POST /api/meta/issue-types — admin manages the issue-type list. */
router.post(
  '/issue-types',
  requireRole(ROLES.ADMIN),
  validate(issueTypeSchema),
  asyncHandler(async (req, res) => {
    const exists = await IssueType.findOne({ name: req.body.name }).lean();
    if (exists) throw ApiError.conflict('This issue type already exists');

    const issueType = await IssueType.create(req.body);
    await recordAudit({
      req,
      action: 'create',
      entityType: 'IssueType',
      entityId: issueType._id,
      entityLabel: issueType.name,
    });
    res.status(201).json({ success: true, issueType });
  }),
);

/** PUT /api/meta/issue-types/:id */
router.put(
  '/issue-types/:id',
  requireRole(ROLES.ADMIN),
  validate(issueTypeSchema.partial()),
  asyncHandler(async (req, res) => {
    const issueType = await IssueType.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!issueType) throw ApiError.notFound('Issue type not found');

    await recordAudit({
      req,
      action: 'update',
      entityType: 'IssueType',
      entityId: issueType._id,
      entityLabel: issueType.name,
    });
    res.json({ success: true, issueType });
  }),
);

/** GET /api/meta/audit-logs — admin-only audit trail. */
router.get(
  '/audit-logs',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
    const filter = {};
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.action) filter.action = req.query.action;

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }),
);

export default router;
