import { Router } from 'express';
import InventoryItem from '../models/InventoryItem.js';
import InventoryMovement from '../models/InventoryMovement.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../utils/audit.js';
import { containsRegex } from '../utils/search.js';
import { buildReport, fileDate, renderInventoryExcel, renderInventoryPdf } from '../services/inventoryExport.js';
import { ROLES, INVENTORY_UNITS } from '../utils/constants.js';
import {
  inventoryItemSchema,
  inventoryItemUpdateSchema,
  stockMovementSchema,
} from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN, ROLES.NOC_OPERATOR));

router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const categories = (await InventoryItem.distinct('category')).filter(Boolean).sort();
    res.json({ success: true, units: INVENTORY_UNITS, categories });
  }),
);

/**
 * GET /api/inventory/export?format=xlsx|pdf — the complete inventory.
 * Excel adds a by-category sheet and the full stock-movement ledger.
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
    const items = await InventoryItem.find({}).sort({ category: 1, name: 1 }).lean();
    const report = buildReport(items, {
      company: req.tenant?.name,
      color: req.tenant?.themeColor,
      generatedBy: req.user.name,
    });
    const name = `inventory-${fileDate(report.generatedAt)}.${format}`;

    let buffer;
    if (format === 'pdf') {
      buffer = await renderInventoryPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
    } else {
      const movements = await InventoryMovement.find({}).sort({ createdAt: -1 }).lean();
      buffer = await renderInventoryExcel(report, movements);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    await recordAudit({ req, action: 'export', entityType: 'InventoryItem', entityLabel: `${items.length} items (${format.toUpperCase()})` });

    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }),
);

// ----------------------------------------------------------------- items
router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.q) {
      const rx = containsRegex(req.query.q);
      filter.$or = [{ sku: rx }, { name: rx }, { category: rx }, { location: rx }, { supplier: rx }];
    }
    if (req.query.category) filter.category = req.query.category;
    if (req.query.lowStock === 'true') filter.$expr = { $lte: ['$quantity', '$minStock'] };

    const [items, all] = await Promise.all([
      InventoryItem.find(filter).sort({ name: 1 }).lean(),
      InventoryItem.find({}, 'quantity minStock costPrice').lean(),
    ]);

    const summary = {
      skus: all.length,
      units: all.reduce((sum, i) => sum + i.quantity, 0),
      lowStock: all.filter((i) => i.quantity <= i.minStock).length,
      value: all.reduce((sum, i) => sum + i.quantity * i.costPrice, 0),
    };
    res.json({ success: true, items, summary });
  }),
);

router.post(
  '/items',
  validate(inventoryItemSchema),
  asyncHandler(async (req, res) => {
    const item = await InventoryItem.create(req.body);
    if (item.quantity > 0) {
      await InventoryMovement.create({
        item: item._id,
        sku: item.sku,
        itemName: item.name,
        type: 'in',
        quantity: item.quantity,
        balanceAfter: item.quantity,
        note: 'Opening stock',
        by: req.user._id,
        byName: req.user.name,
      });
    }
    await recordAudit({ req, action: 'create', entityType: 'InventoryItem', entityId: item._id, entityLabel: item.sku });
    res.status(201).json({ success: true, item });
  }),
);

router.put(
  '/items/:id',
  validate(inventoryItemUpdateSchema),
  asyncHandler(async (req, res) => {
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) throw ApiError.notFound('Item not found');
    await recordAudit({ req, action: 'update', entityType: 'InventoryItem', entityId: item._id, entityLabel: item.sku });
    res.json({ success: true, item });
  }),
);

router.delete(
  '/items/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const item = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!item) throw ApiError.notFound('Item not found');
    await InventoryMovement.deleteMany({ item: item._id });
    await recordAudit({ req, action: 'delete', entityType: 'InventoryItem', entityId: item._id, entityLabel: item.sku });
    res.json({ success: true, message: 'Item deleted' });
  }),
);

// ------------------------------------------------------- stock movements
router.get(
  '/items/:id/movements',
  asyncHandler(async (req, res) => {
    const items = await InventoryMovement.find({ item: req.params.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, items });
  }),
);

/** Stock in / out / physical-count adjustment, applied atomically so two users can't oversell. */
router.post(
  '/items/:id/stock',
  validate(stockMovementSchema),
  asyncHandler(async (req, res) => {
    const { type, quantity, note } = req.body;
    let item;
    let moved = quantity;

    if (type === 'in') {
      item = await InventoryItem.findByIdAndUpdate(req.params.id, { $inc: { quantity } }, { new: true });
    } else if (type === 'out') {
      item = await InventoryItem.findOneAndUpdate(
        { _id: req.params.id, quantity: { $gte: quantity } },
        { $inc: { quantity: -quantity } },
        { new: true },
      );
      if (!item) {
        const current = await InventoryItem.findById(req.params.id);
        if (current) throw ApiError.badRequest(`Only ${current.quantity} ${current.unit} in stock`);
      }
    } else {
      const before = await InventoryItem.findByIdAndUpdate(req.params.id, { $set: { quantity } });
      if (before) {
        moved = Math.abs(quantity - before.quantity);
        item = await InventoryItem.findById(req.params.id);
      }
    }
    if (!item) throw ApiError.notFound('Item not found');

    const movement = await InventoryMovement.create({
      item: item._id,
      sku: item.sku,
      itemName: item.name,
      type,
      quantity: moved,
      balanceAfter: item.quantity,
      note,
      by: req.user._id,
      byName: req.user.name,
    });
    await recordAudit({
      req,
      action: `stock_${type}`,
      entityType: 'InventoryItem',
      entityId: item._id,
      entityLabel: item.sku,
      meta: { quantity: moved, balanceAfter: item.quantity },
    });
    res.status(201).json({ success: true, item, movement });
  }),
);

export default router;
