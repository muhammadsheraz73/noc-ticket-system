import mongoose from 'mongoose';

const vlanSchema = new mongoose.Schema(
  {
    vlanId: { type: Number, required: true, unique: true, index: true },
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

export default mongoose.model('Vlan', vlanSchema, 'vlans');
