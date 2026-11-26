import mongoose from 'mongoose';

const dailyAppEntrySchema = new mongoose.Schema(
  {
    executable: { type: String, required: true },
    appName: { type: String, required: true },
    publisher: { type: String, default: 'Unknown' },
    activeSeconds: { type: Number, default: 0 },
    launchCount: { type: Number, default: 0 },
    firstUsedAt: { type: String, default: '' },
    lastUsedAt: { type: String, default: '' },
  },
  { _id: false }
);

const dailyAppUsageSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    employeeId: { type: String, default: '' },
    employeeName: { type: String, default: '' },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD local calendar day
    totalActiveSeconds: { type: Number, default: 0 },
    totalIdleSeconds: { type: Number, default: 0 },
    lastUpdatedAt: { type: String, default: () => new Date().toISOString() },
    apps: [dailyAppEntrySchema],
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

dailyAppUsageSchema.index({ deviceId: 1, date: 1 }, { unique: true });

export const DailyAppUsage = mongoose.model('DailyAppUsage', dailyAppUsageSchema);
