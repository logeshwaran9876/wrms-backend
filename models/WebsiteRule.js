import mongoose from 'mongoose';

const websiteRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    domain: { type: String, required: true },
    category: { type: String, default: 'General' },
    action: { type: String, enum: ['block', 'allow'], default: 'block' },
    scope: { type: String, enum: ['global', 'department', 'employee', 'device'], default: 'global' },
    scopeTarget: { type: String },
    schedule: {
      enabled: { type: Boolean, default: false },
      start: { type: String },
      end: { type: String },
    },
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

export const WebsiteRule = mongoose.model('WebsiteRule', websiteRuleSchema);
