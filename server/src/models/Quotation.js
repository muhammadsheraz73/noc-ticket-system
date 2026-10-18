import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';
import { QUOTATION_STATUSES } from '../utils/constants.js';

const quotationItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    unit: { type: String, trim: true, default: '' },
    rate: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

/**
 * A price quotation sent to a customer or a prospect.
 *
 * Unlike an invoice it needs no ticket, and the "To" block is stored as
 * entered, so a quotation can go to somebody who is not a customer yet.
 */
const quotationSchema = new mongoose.Schema(
  {
    /** `QT-2026-0001` — per client, per year, generated server-side. */
    quoteNumber: { type: String, required: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
    customerReferenceNumber: { type: String, default: '' },

    clientName: { type: String, required: true, trim: true },
    clientCompany: { type: String, trim: true, default: '' },
    clientAddress: { type: String, trim: true, default: '' },
    clientPhone: { type: String, trim: true, default: '' },
    clientEmail: { type: String, trim: true, default: '' },

    subject: { type: String, trim: true, default: '' },
    issueDate: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true },

    items: { type: [quotationItemSchema], default: [] },

    subtotal: { type: Number, required: true, default: 0 },
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'PKR' },

    status: { type: String, enum: QUOTATION_STATUSES, default: 'Draft', index: true },
    statusChangedAt: { type: Date },
    notes: { type: String, default: '' },
    terms: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

quotationSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

quotationSchema.plugin(tenantScope);
quotationSchema.index({ tenant: 1, quoteNumber: 1 }, { unique: true });
quotationSchema.index({ tenant: 1, createdAt: -1 });

export default mongoose.model('Quotation', quotationSchema, 'quotations');
