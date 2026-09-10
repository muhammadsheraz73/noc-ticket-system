import mongoose from 'mongoose';

/** Admin-manageable ticket issue types (Fiber Cut, LOS, …). */
const issueTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
    defaultEttrMinutes: { type: Number, default: 60, min: 5 },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true },
);

export default mongoose.model('IssueType', issueTypeSchema, 'issue_types');
