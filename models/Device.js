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
    status: { type: String, enum: ['applied', 'partial', 'failed', 'pending'], default: 'applied' },
    online: { type: Boolean, default: true },
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
