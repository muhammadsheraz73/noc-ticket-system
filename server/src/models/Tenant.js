import mongoose from 'mongoose';

/** One client company that has bought the panel. Its users only ever see its own data. */
const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    contactName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    // --- Letterhead used on quotations (and anything else printed for this client) ---
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },
    /** Logo as a PNG/JPEG data URL — kept in the document so it works on serverless hosts too. */
    logo: { type: String, default: '' },
    /** Default terms & conditions printed on every new quotation. */
    quotationTerms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    /** Accent colour the panel and this client's invoices are painted in. */
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
