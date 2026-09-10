import mongoose from 'mongoose';
import { DEVICE_TYPES } from '../utils/constants.js';

const portSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    portType: { type: String, trim: true, default: '' },
    speed: { type: String, trim: true, default: '' },
    sfpType: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['Free', 'In Use', 'Faulty', 'Reserved'], default: 'Free' },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

/** OLTs, switches, routers, ONUs and their ports/PON information. */
const networkDeviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    deviceType: { type: String, enum: DEVICE_TYPES, default: 'Switch', index: true },
    pop: { type: mongoose.Schema.Types.ObjectId, ref: 'Pop', index: true },
    popName: { type: String, default: '' },
    vendor: { type: String, trim: true, default: '' },
    model: { type: String, trim: true, default: '' },
    managementIp: { type: String, trim: true, default: '', index: true },
    serialNumber: { type: String, trim: true, default: '' },
    ports: { type: [portSchema], default: [] },
    notes: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

networkDeviceSchema.index({ name: 'text', model: 'text', managementIp: 'text', notes: 'text' });

export default mongoose.model('NetworkDevice', networkDeviceSchema, 'network_devices');
