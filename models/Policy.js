import mongoose from 'mongoose';

const policySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    version: { type: Number, default: 1 },
    createdBy: { type: String, default: 'Admin' },
    updatedAt: { type: String, default: () => new Date().toISOString() },
    active: { type: Boolean, default: true },
    assignments: {
      departments: [{ type: String }],
      employees: [{ type: String }],
      devices: [{ type: String }],
    },
    rules: {
      website: { type: Number, default: 0 },
      application: { type: Number, default: 0 },
      browser: { type: Number, default: 0 },
      usb: { type: Number, default: 0 },
    },
    timeRestrictions: {
      enabled: { type: Boolean, default: false },
      days: [{ type: String }],
      start: { type: String },
      end: { type: String },
    },
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

export const Policy = mongoose.model('Policy', policySchema);
