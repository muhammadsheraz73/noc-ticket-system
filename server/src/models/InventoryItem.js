import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';
import { INVENTORY_UNITS } from '../utils/constants.js';

/** One stock line (SKU): ONTs, routers, fiber cable, patch cords, SFPs, … */
const inventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, index: true },
    category: { type: String, trim: true, default: '', index: true },
    unit: { type: String, enum: INVENTORY_UNITS, default: 'pcs' },
    quantity: { type: Number, default: 0, min: 0 },
    /** Reorder level — at or below this the item is flagged as low stock. */
    minStock: { type: Number, default: 0, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    salePrice: { type: Number, default: 0, min: 0 },
    location: { type: String, trim: true, default: '' },
    supplier: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

inventoryItemSchema.plugin(tenantScope);
inventoryItemSchema.index({ tenant: 1, sku: 1 }, { unique: true });

export default mongoose.model('InventoryItem', inventoryItemSchema, 'inventory_items');
