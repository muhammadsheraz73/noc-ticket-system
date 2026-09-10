import mongoose from 'mongoose';
import { CONNECTION_TYPES } from '../utils/constants.js';

/** Source device/port ➜ destination device/port link, optionally tied to a customer. */
const connectionSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: '' },

    sourceDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkDevice', index: true },
    sourceDeviceName: { type: String, trim: true, default: '' },
    sourcePort: { type: String, trim: true, default: '', index: true },

    destinationDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkDevice', index: true },
    destinationDeviceName: { type: String, trim: true, default: '' },
    destinationPort: { type: String, trim: true, default: '', index: true },

    vlan: { type: String, trim: true, default: '', index: true },
    connectionType: { type: String, enum: CONNECTION_TYPES, default: 'Fiber', index: true },
    sfpSpeed: { type: String, trim: true, default: '' },
    sfpType: { type: String, trim: true, default: '' },
    ponPort: { type: String, trim: true, default: '' },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
    customerReferenceNumber: { type: String, trim: true, default: '', index: true },

    status: { type: String, enum: ['Active', 'Down', 'Planned', 'Decommissioned'], default: 'Active' },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

connectionSchema.index({
  label: 'text',
  sourceDeviceName: 'text',
  sourcePort: 'text',
  destinationDeviceName: 'text',
  destinationPort: 'text',
  vlan: 'text',
  notes: 'text',
});

export default mongoose.model('Connection', connectionSchema, 'connections');
