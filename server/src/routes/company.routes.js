import { Router } from 'express';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { ROLES } from '../utils/constants.js';
import { companyProfileSchema } from '../validators/schemas.js';
import { buildClientWorkbook } from '../services/dataExport.js';
import { buildClientReportPdf } from '../services/dataReportPdf.js';
import env from '../config/env.js';

/**
 * The signed-in client's own company profile — the letterhead printed on its
 * quotations. Name, colour and status stay with the panel owner.
 */
const router = Router();
router.use(requireAuth);

const PROFILE_FIELDS = 'name contactName phone email address website tagline logo quotationTerms bankAccounts themeColor';

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

/**
 * GET /api/company/export — everything this client has, as one Excel file
 * (customers, tickets, invoices, quotations, bills, payments, stock…).
 * Client admins only. Read-only.
 */
router.get(
  '/export',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { buffer, counts } = await buildClientWorkbook();
    await recordAudit({ req, action: 'export', entityType: 'Company', entityId: req.tenant._id, entityLabel: `${req.tenant.name} (all data)`, meta: counts });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone }).format(new Date());
    const safeName = String(req.tenant.name).replace(/[\\/:*?"<>|]/g, '').trim();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName} - all data ${date}.xlsx"`);
    res.end(buffer);
  }),
);

/**
 * GET /api/company/export/pdf — the same complete data as the Excel file, as a
 * PDF on the client's letterhead: every record with all of its fields.
 * Client admins only. Read-only.
 */
router.get(
  '/export/pdf',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const tenant = await Tenant.findById(req.tenant._id).select('name logo themeColor').lean();
    const buffer = await buildClientReportPdf(tenant);
    await recordAudit({ req, action: 'export', entityType: 'Company', entityId: req.tenant._id, entityLabel: `${req.tenant.name} (all data, PDF)` });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: env.timezone }).format(new Date());
    const safeName = String(req.tenant.name).replace(/[\\/:*?"<>|]/g, '').trim();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName} - all data ${date}.pdf"`);
    res.end(buffer);
  }),
);

export default router;
