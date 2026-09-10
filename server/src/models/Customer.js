import mongoose from 'mongoose';

/**
 * Customer master data.
 *
 * `address`, `type`, `sourcePort`, `destinationPort` and `vlan` are INTERNAL:
 * fully searchable and visible on the customer detail page, but structurally
 * excluded from generated ticket text (see utils/ticketFormatter.js).
 */
const customerSchema = new mongoose.Schema(
  {
    // --- Required master data ---
    customerReferenceNumber: {
      type: String,
      required: [true, 'Customer Reference Number is required'],
      unique: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Customer Name is required'], trim: true, index: true },
    address: { type: String, required: [true, 'Address is required'], trim: true },
    connectedFrom: { type: String, required: [true, 'Connected From is required'], trim: true, index: true },
    type: { type: String, required: [true, 'Type is required'], trim: true, uppercase: true, index: true },
    contactNumber: { type: String, required: [true, 'Contact Number is required'], trim: true, index: true },

    // --- Optional master data ---
    location: { type: String, trim: true, default: '' },

    // --- Internal network data ---
    destinationPort: { type: String, trim: true, default: '', index: true },
    sourcePort: { type: String, trim: true, default: '', index: true },
    vlan: { type: String, trim: true, default: '', index: true },

    notes: { type: String, trim: true, default: '' },

    // --- Soft delete ---
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerSchema.index({
  customerReferenceNumber: 'text',
  name: 'text',
  address: 'text',
  contactNumber: 'text',
  connectedFrom: 'text',
  vlan: 'text',
  sourcePort: 'text',
  destinationPort: 'text',
  notes: 'text',
});

customerSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('Customer', customerSchema, 'customers');
