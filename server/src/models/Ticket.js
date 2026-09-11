import mongoose from 'mongoose';
import { TICKET_STATUSES, TICKET_PRIORITIES, AI_STATUSES } from '../utils/constants.js';

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    action: { type: String, required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const aiSchema = new mongoose.Schema(
  {
    status: { type: String, enum: AI_STATUSES, default: 'pending' },
    category: { type: String, default: '' },
    suggestedPriority: { type: String, default: '' },
    summary: { type: String, default: '' },
    troubleshootingSteps: { type: [String], default: [] },
    customerResponse: { type: String, default: '' },
    model: { type: String, default: '' },
    error: { type: String, default: '' },
    analyzedAt: { type: Date },
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    /** Server-generated unique TID. */
    ticketNumber: { type: Number, required: true, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    /** Denormalized business key so search/joins stay fast. */
    customerReferenceNumber: { type: String, required: true, index: true },
    customerName: { type: String, required: true },

    issueType: { type: String, required: true, trim: true, index: true },
    remarks: { type: String, trim: true, default: '' },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'Medium', index: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'New', index: true },

    /** ETTR duration in minutes; ettrAt is derived from server time. */
    ettrMinutes: { type: Number, required: true, min: 5, default: 60 },
    ettrAt: { type: Date, required: true, index: true },

    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedByName: { type: String, default: '' },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldTeam', index: true },
    assignedToName: { type: String, default: '' },
    assignedAt: { type: Date },

    /** Optional second responder. Never mentioned in the generated ticket text. */
    assignedHelper: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldTeam', index: true },
    assignedHelperName: { type: String, default: '' },

    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolutionRemarks: { type: String, default: '' },
    closedAt: { type: Date },

    /** Snapshot of the standardized ticket text as of the last save. */
    generatedText: { type: String, default: '' },

    ai: { type: aiSchema, default: () => ({}) },
    history: { type: [historySchema], default: [] },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

ticketSchema.index({ status: 1, priority: 1, createdAt: -1 });
ticketSchema.index({ remarks: 'text', issueType: 'text', customerName: 'text' });

ticketSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('Ticket', ticketSchema, 'tickets');
