import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0.01 },
  receivedBy: { type: String, trim: true, default: '' },
  receivedAt: { type: Date, required: true, default: Date.now },
  note: { type: String, trim: true, default: '' },
});

/** One subscriber's bill for one month, plus every payment received against it. */
const billingRecordSchema = new mongoose.Schema(
  {
    subscriber: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscriber', required: true, index: true },
    username: { type: String, required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    package: { type: String, default: '' },
    address: { type: String, default: '' },
    fee: { type: Number, required: true, min: 0 },
    received: { type: Number, default: 0 },
    arrears: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['Pending', 'Partial', 'Received'], default: 'Pending', index: true },
    lastReceivedBy: { type: String, default: '' },
    lastReceivedAt: { type: Date },
    payments: { type: [paymentSchema], default: [] },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

billingRecordSchema.index({ subscriber: 1, period: 1 }, { unique: true });
billingRecordSchema.index({ 'payments.receivedAt': 1 });

/** Keep the derived totals in step with the payments array. */
billingRecordSchema.pre('save', function recompute(next) {
  this.received = this.payments.reduce((sum, p) => sum + p.amount, 0);
  this.arrears = Math.max(0, this.fee - this.received);
  this.paymentStatus = this.received <= 0 ? 'Pending' : this.received >= this.fee ? 'Received' : 'Partial';
  const last = this.payments[this.payments.length - 1];
  this.lastReceivedBy = last?.receivedBy || '';
  this.lastReceivedAt = last?.receivedAt;
  next();
});

billingRecordSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

billingRecordSchema.plugin(tenantScope);

export default mongoose.model('BillingRecord', billingRecordSchema, 'billing_records');
