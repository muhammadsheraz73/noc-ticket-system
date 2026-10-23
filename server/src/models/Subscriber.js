import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';

/** A broadband user billed every month (one row of the old Excel billing sheet). */
const subscriberSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    usernameKey: { type: String, required: true },
    activationDate: { type: Date },
    package: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
    address: { type: String, trim: true, default: '' },
    contact: { type: String, trim: true, default: '' },
    monthlyFee: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, trim: true, default: '' },
    /** The customer master record this billing user belongs to, once linked from Billing → Users. */
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
  },
  { timestamps: true },
);

subscriberSchema.pre('validate', function setKey(next) {
  if (this.username) this.usernameKey = this.username.trim().toLowerCase();
  next();
});

subscriberSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

subscriberSchema.plugin(tenantScope);
subscriberSchema.index({ tenant: 1, usernameKey: 1 }, { unique: true });

export default mongoose.model('Subscriber', subscriberSchema, 'subscribers');
