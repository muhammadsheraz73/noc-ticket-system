import mongoose from 'mongoose';
import tenantScope from './plugins/tenantScope.js';

/** Admin-manageable ticket issue types (Fiber Cut, LOS, …). */
const issueTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    defaultEttrMinutes: { type: Number, default: 60, min: 5 },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true },
);

issueTypeSchema.plugin(tenantScope);
issueTypeSchema.index({ tenant: 1, name: 1 }, { unique: true });

export default mongoose.model('IssueType', issueTypeSchema, 'issue_types');
