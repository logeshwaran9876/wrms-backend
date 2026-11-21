import mongoose from 'mongoose';

const deviceSoftwareSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    executable: { type: String, default: '' },
    publisher: { type: String, default: 'Unknown' },
    version: { type: String, default: '1.0.0' },
    installDate: { type: String, default: () => new Date().toISOString().split('T')[0] },
    installLocation: { type: String, default: '' },
    status: {
      type: String,
      enum: ['installed', 'uninstalled'],
      default: 'installed',
    },
    executionCount: { type: Number, default: 0 },
    lastUsed: { type: String, default: () => new Date().toISOString() },
    isBlocked: { type: Boolean, default: false },
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

export const DeviceSoftware = mongoose.model('DeviceSoftware', deviceSoftwareSchema);
