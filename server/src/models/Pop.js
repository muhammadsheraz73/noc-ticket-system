import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';

/** Point of Presence — the "Connected From" source location. */
const popSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, index: true },
    address: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

popSchema.index({ code: 'text', name: 'text', address: 'text' });

popSchema.plugin(tenantScope);
popSchema.index({ tenant: 1, code: 1 }, { unique: true });

export default mongoose.model('Pop', popSchema, 'pops');
