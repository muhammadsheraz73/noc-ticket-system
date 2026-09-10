import mongoose from 'mongoose';

/** Point of Presence — the "Connected From" source location. */
const popSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    address: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

popSchema.index({ code: 'text', name: 'text', address: 'text' });

export default mongoose.model('Pop', popSchema, 'pops');
