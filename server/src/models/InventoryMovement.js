import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';
import { STOCK_MOVEMENT_TYPES } from '../utils/constants.js';

/** Every stock in / out / adjustment, so an item's balance can always be explained. */
const inventoryMovementSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    sku: { type: String, default: '' },
    itemName: { type: String, default: '' },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    quantity: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
  },
  { timestamps: true },
);

inventoryMovementSchema.plugin(tenantScope);

export default mongoose.model('InventoryMovement', inventoryMovementSchema, 'inventory_movements');
