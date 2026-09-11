import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import {
  ROLE_VALUES,
  ROLES,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
} from '../utils/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: USERNAME_MIN,
      maxlength: USERNAME_MAX,
      match: [USERNAME_PATTERN, "Username may only contain letters, digits, dot, underscore and hyphen"],
      index: true,
    },
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

/**
 * A free username derived from a name or an email. Used by the seeder and by
 * the backfill that gives usernames to accounts created before they existed;
 * an admin creating a user always picks the username themselves.
 */
userSchema.statics.deriveUsername = async function deriveUsername(source) {
  let base = String(source || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, USERNAME_MAX - 3);

  if (!base) base = "user";
  if (base.length < USERNAME_MIN) base = base.padEnd(USERNAME_MIN, "0");

  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix ? `${base}${suffix}` : base;
    if (!(await this.exists({ username: candidate }))) return candidate;
  }
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('User', userSchema, 'users');
