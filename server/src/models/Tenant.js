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
    /** Short line printed in the invoice band and under the name on reports. */
    tagline: { type: String, trim: true, default: '' },
    /** Logo as a PNG/JPEG data URL — kept in the document so it works on serverless hosts too. */
    logo: { type: String, default: '' },
    /** Bank accounts printed on this client's quotations and invoices for payment. */
    bankAccounts: {
      type: [
        new mongoose.Schema(
          {
            title: { type: String, trim: true, required: true },
            bank: { type: String, trim: true, default: '' },
            accountNumber: { type: String, trim: true, default: '' },
            iban: { type: String, trim: true, uppercase: true, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Default terms & conditions printed on every new quotation. */
    quotationTerms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    /** Accent colour the panel and this client's invoices are painted in. */
    themeColor: { type: String, default: '' },
    /** Panel features the owner has locked for every login of this client (keys of MODULES). */
    lockedModules: { type: [String], default: [] },
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
