import mongoose from 'mongoose';

const usbRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    action: { type: String, enum: ['allow', 'block', 'read_only'], default: 'block' },
    scope: { type: String, enum: ['global', 'employee', 'device'], default: 'global' },
    scopeTarget: { type: String },
    exception: { type: Boolean, default: false },
    expiresAt: { type: String },
    createdAt: { type: String, default: () => new Date().toISOString() },
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

export const UsbRule = mongoose.model('UsbRule', usbRuleSchema);
