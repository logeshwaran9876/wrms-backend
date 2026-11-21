import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    action: { type: String, required: true },
    category: {
      type: String,
      enum: ['auth', 'policy', 'website', 'application', 'permission', 'device', 'devices', 'security', 'usb', 'port', 'software'],
      required: true,
    },
    actor: { type: String, required: true },
    target: { type: String, required: true },
    timestamp: { type: String, default: () => new Date().toISOString() },
    details: { type: String, default: '' },
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

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
