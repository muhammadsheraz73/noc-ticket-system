import mongoose from 'mongoose';
import { INVOICE_STATUSES } from '../utils/constants.js';

const invoiceItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    rate: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

/** Invoices are always created FROM an existing ticket, and stay linked to both. */
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },

    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    ticketNumber: { type: Number, required: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerReferenceNumber: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    customerAddress: { type: String, default: '' },
    customerContact: { type: String, default: '' },

    issueDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date, required: true },

    items: { type: [invoiceItemSchema], default: [] },

    subtotal: { type: Number, required: true, default: 0 },
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'PKR' },

    status: { type: String, enum: INVOICE_STATUSES, default: 'Draft', index: true },
    notes: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

invoiceSchema.index({ invoiceNumber: 'text', customerName: 'text', notes: 'text' });

invoiceSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('Invoice', invoiceSchema, 'invoices');
