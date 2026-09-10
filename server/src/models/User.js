import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import { ROLE_VALUES, ROLES } from '../utils/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.NOC_OPERATOR, index: true },
    phone: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('User', userSchema, 'users');
