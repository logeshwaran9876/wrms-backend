import mongoose from 'mongoose';

const applicationRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    appName: { type: String, required: true },
    executableName: { type: String }, // e.g. "calc.exe", "notepad.exe"
    publisher: { type: String, default: 'Unknown' },
    action: { type: String, enum: ['allow', 'block'], default: 'block' },
    version: { type: String },
    scope: { type: String, enum: ['global', 'employee', 'device'], default: 'global' },
    scopeTarget: { type: String },
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

export const ApplicationRule = mongoose.model('ApplicationRule', applicationRuleSchema);
