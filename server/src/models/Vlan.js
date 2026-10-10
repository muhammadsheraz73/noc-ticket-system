import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';

const vlanSchema = new mongoose.Schema(
  {
    vlanId: { type: Number, required: true },
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: '' },
    pop: { type: mongoose.Schema.Types.ObjectId, ref: 'Pop' },
    popName: { type: String, default: '' },
    subnet: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

vlanSchema.index({ name: 'text', description: 'text', subnet: 'text' });

vlanSchema.plugin(tenantScope);
vlanSchema.index({ tenant: 1, vlanId: 1 }, { unique: true });

export default mongoose.model('Vlan', vlanSchema, 'vlans');
