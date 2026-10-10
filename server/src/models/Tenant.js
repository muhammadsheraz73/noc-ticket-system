import mongoose from 'mongoose';

/** One client company that has bought the panel. Its users only ever see its own data. */
const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    contactName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    /** Branding shown to this client's users: a small image as a data URL, and an accent colour. */
    logo: { type: String, default: '' },
    themeColor: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

tenantSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('Tenant', tenantSchema, 'tenants');
