import { Router } from 'express';
import Pop from '../models/Pop.js';
import NetworkDevice from '../models/NetworkDevice.js';
import Connection from '../models/Connection.js';
import Vlan from '../models/Vlan.js';
import Customer from '../models/Customer.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex } from '../utils/search.js';
import { ROLES, DEVICE_TYPES, CONNECTION_TYPES } from '../utils/constants.js';
import { popSchema, deviceSchema, connectionSchema, vlanSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

// Network inventory is internal data — never exposed to field engineers.
router.use(requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR));

const canWrite = requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR);

router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, deviceTypes: DEVICE_TYPES, connectionTypes: CONNECTION_TYPES });
  }),
);

// ------------------------------------------------------------------ POPs
router.get(
  '/pops',
  asyncHandler(async (req, res) => {
    const filter = req.query.q
      ? { $or: [{ code: containsRegex(req.query.q) }, { name: containsRegex(req.query.q) }] }
      : {};
    const items = await Pop.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, items });
  }),
);

router.post(
  '/pops',
  canWrite,
  validate(popSchema),
  asyncHandler(async (req, res) => {
    const pop = await Pop.create(req.body);
    await recordAudit({ req, action: 'create', entityType: 'Pop', entityId: pop._id, entityLabel: pop.code });
    res.status(201).json({ success: true, pop });
  }),
);

router.put(
  '/pops/:id',
  canWrite,
  validate(popSchema.partial()),
  asyncHandler(async (req, res) => {
    const pop = await Pop.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pop) throw ApiError.notFound('POP not found');
    await recordAudit({ req, action: 'update', entityType: 'Pop', entityId: pop._id, entityLabel: pop.code });
    res.json({ success: true, pop });
  }),
);

router.delete(
  '/pops/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const inUse = await NetworkDevice.countDocuments({ pop: req.params.id });
    if (inUse) throw ApiError.badRequest(`${inUse} device(s) still reference this POP`);
    const pop = await Pop.findByIdAndDelete(req.params.id);
    if (!pop) throw ApiError.notFound('POP not found');
    await recordAudit({ req, action: 'delete', entityType: 'Pop', entityId: pop._id, entityLabel: pop.code });
    res.json({ success: true, message: 'POP deleted' });
  }),
);

// --------------------------------------------------------------- Devices
router.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ name: rx }, { model: rx }, { managementIp: rx }, { serialNumber: rx }];
    }
    if (req.query.deviceType) filter.deviceType = req.query.deviceType;
    if (req.query.pop) filter.pop = req.query.pop;

    const items = await NetworkDevice.find(filter).sort({ name: 1 }).populate('pop', 'code name').lean();
    res.json({ success: true, items });
  }),
);

router.post(
  '/devices',
  canWrite,
  validate(deviceSchema),
  asyncHandler(async (req, res) => {
    const popName = req.body.pop ? (await Pop.findById(req.body.pop))?.name || '' : '';
    const device = await NetworkDevice.create({ ...req.body, popName });
    await recordAudit({
      req,
      action: 'create',
      entityType: 'NetworkDevice',
      entityId: device._id,
      entityLabel: device.name,
    });
    res.status(201).json({ success: true, device });
  }),
);

router.put(
  '/devices/:id',
  canWrite,
  validate(deviceSchema.partial()),
  asyncHandler(async (req, res) => {
    const patch = { ...req.body };
    if (patch.pop) patch.popName = (await Pop.findById(patch.pop))?.name || '';

    const device = await NetworkDevice.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!device) throw ApiError.notFound('Device not found');

    await recordAudit({
      req,
      action: 'update',
      entityType: 'NetworkDevice',
      entityId: device._id,
      entityLabel: device.name,
    });
    res.json({ success: true, device });
  }),
);

router.delete(
  '/devices/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const inUse = await Connection.countDocuments({
      $or: [{ sourceDevice: req.params.id }, { destinationDevice: req.params.id }],
    });
    if (inUse) throw ApiError.badRequest(`${inUse} connection(s) still reference this device`);

    const device = await NetworkDevice.findByIdAndDelete(req.params.id);
    if (!device) throw ApiError.notFound('Device not found');

    await recordAudit({
      req,
      action: 'delete',
      entityType: 'NetworkDevice',
      entityId: device._id,
      entityLabel: device.name,
    });
    res.json({ success: true, message: 'Device deleted' });
  }),
);

// ----------------------------------------------------------- Connections
router.get(
  '/connections',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [
        { label: rx },
        { sourcePort: rx },
        { destinationPort: rx },
        { vlan: rx },
        { sourceDeviceName: rx },
        { destinationDeviceName: rx },
        { customerReferenceNumber: rx },
      ];
    }
    if (req.query.customer) filter.customer = req.query.customer;

    const items = await Connection.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ success: true, items });
  }),
);

router.post(
  '/connections',
  canWrite,
  validate(connectionSchema),
  asyncHandler(async (req, res) => {
    const connection = await Connection.create(await hydrateConnection(req.body));
    await recordAudit({
      req,
      action: 'create',
      entityType: 'Connection',
      entityId: connection._id,
      entityLabel: connection.label || connection.vlan,
    });
    res.status(201).json({ success: true, connection });
  }),
);

router.put(
  '/connections/:id',
  canWrite,
  validate(connectionSchema.partial()),
  asyncHandler(async (req, res) => {
    const connection = await Connection.findByIdAndUpdate(
      req.params.id,
      await hydrateConnection(req.body),
      { new: true, runValidators: true },
    );
    if (!connection) throw ApiError.notFound('Connection not found');

    await recordAudit({
      req,
      action: 'update',
      entityType: 'Connection',
      entityId: connection._id,
      entityLabel: connection.label || connection.vlan,
    });
    res.json({ success: true, connection });
  }),
);

router.delete(
  '/connections/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const connection = await Connection.findByIdAndDelete(req.params.id);
    if (!connection) throw ApiError.notFound('Connection not found');
    await recordAudit({
      req,
      action: 'delete',
      entityType: 'Connection',
      entityId: connection._id,
      entityLabel: connection.label,
    });
    res.json({ success: true, message: 'Connection deleted' });
  }),
);

// ----------------------------------------------------------------- VLANs
router.get(
  '/vlans',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      const asNumber = Number.parseInt(req.query.q, 10);
      filter.$or = [
        { name: rx },
        { description: rx },
        ...(Number.isFinite(asNumber) ? [{ vlanId: asNumber }] : []),
      ];
    }
    const items = await Vlan.find(filter).sort({ vlanId: 1 }).lean();
    res.json({ success: true, items });
  }),
);

router.post(
  '/vlans',
  canWrite,
  validate(vlanSchema),
  asyncHandler(async (req, res) => {
    const popName = req.body.pop ? (await Pop.findById(req.body.pop))?.name || '' : '';
    const vlan = await Vlan.create({ ...req.body, popName });
    await recordAudit({
      req,
      action: 'create',
      entityType: 'Vlan',
      entityId: vlan._id,
      entityLabel: String(vlan.vlanId),
    });
    res.status(201).json({ success: true, vlan });
  }),
);

router.put(
  '/vlans/:id',
  canWrite,
  validate(vlanSchema.partial()),
  asyncHandler(async (req, res) => {
    const vlan = await Vlan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!vlan) throw ApiError.notFound('VLAN not found');
    await recordAudit({
      req,
      action: 'update',
      entityType: 'Vlan',
      entityId: vlan._id,
      entityLabel: String(vlan.vlanId),
    });
    res.json({ success: true, vlan });
  }),
);

router.delete(
  '/vlans/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const vlan = await Vlan.findByIdAndDelete(req.params.id);
    if (!vlan) throw ApiError.notFound('VLAN not found');
    await recordAudit({
      req,
      action: 'delete',
      entityType: 'Vlan',
      entityId: vlan._id,
      entityLabel: String(vlan.vlanId),
    });
    res.json({ success: true, message: 'VLAN deleted' });
  }),
);

/** Denormalize device/customer names so the records stay searchable on their own. */
async function hydrateConnection(body) {
  const patch = { ...body };
  if (patch.sourceDevice) {
    patch.sourceDeviceName = (await NetworkDevice.findById(patch.sourceDevice))?.name || '';
  }
  if (patch.destinationDevice) {
    patch.destinationDeviceName = (await NetworkDevice.findById(patch.destinationDevice))?.name || '';
  }
  if (patch.customer) {
    patch.customerReferenceNumber =
      (await Customer.findById(patch.customer))?.customerReferenceNumber || '';
  }
  return patch;
}

export default router;
