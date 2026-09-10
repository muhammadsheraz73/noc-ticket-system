import mongoose from 'mongoose';
import { FIELD_TEAM_KINDS } from '../utils/constants.js';

/**
 * A field team or an individual field member.
 * Tickets may be assigned to either (`kind`).
 */
const fieldTeamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    kind: { type: String, enum: FIELD_TEAM_KINDS, default: 'member', index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldTeam' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    area: { type: String, trim: true, default: '' },
    /** Optional link to a login account with the field_engineer role. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

fieldTeamSchema.index({ name: 'text', phone: 'text', area: 'text' });

export default mongoose.model('FieldTeam', fieldTeamSchema, 'field_teams');
