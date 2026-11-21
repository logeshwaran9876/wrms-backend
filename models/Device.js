import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    employeeId: { type: String },
    employeeName: { type: String },
    departmentId: { type: String },
    osVersion: { type: String, default: 'Windows 11 Pro 23H2' },
    agentVersion: { type: String, default: '2.4.1' },
    policyId: { type: String },
    policyName: { type: String },
    lastSync: { type: String, default: () => new Date().toISOString() },
    status: {
      type: String,
      enum: ['applied', 'partial', 'failed', 'pending', 'uninstalled'],
      default: 'applied',
    },
    online: { type: Boolean, default: true },
    ipAddress: { type: String, default: '' },
    publicIp: { type: String, default: '' },
    macAddress: { type: String, default: '' },
    location: {
      city: { type: String, default: '' },
      region: { type: String, default: '' },
      country: { type: String, default: '' },
      countryCode: { type: String, default: '' },
      isp: { type: String, default: '' },
    },
    firewallStatus: {
      type: String,
      enum: ['enabled', 'partial', 'disabled', 'unknown'],
      default: 'enabled',
    },
    firewallEnabled: { type: Boolean, default: true },
    targetFirewallState: {
      type: String,
      enum: ['on', 'off', 'as-is'],
      default: 'on',
    },
    openPorts: [
      {
        port: { type: Number, required: true },
        protocol: { type: String, default: 'TCP' },
        processName: { type: String, default: '' },
        isAllowed: { type: Boolean, default: true },
        isBlocked: { type: Boolean, default: false },
      },
    ],
    blockedPorts: [
      {
        port: { type: Number, required: true },
        protocol: { type: String, default: 'TCP' },
        blockedAt: { type: String, default: () => new Date().toISOString() },
        reason: { type: String, default: 'Manual Admin Block' },
      },
    ],
    openPortsCount: { type: Number, default: 0 },
    disallowedPortsCount: { type: Number, default: 0 },
    unenrolledAt: { type: String },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const Device = mongoose.model('Device', deviceSchema);
