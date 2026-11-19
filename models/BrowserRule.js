import mongoose from 'mongoose';

const browserRuleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    browser: {
      type: String,
      enum: ['chrome', 'brave', 'firefox', 'edge', 'opera', 'all'],
      required: true,
    },
    // Only two core control types: 'private_browsing' and 'extensions'
    controlType: {
      type: String,
      enum: ['private_browsing', 'extensions'],
      required: true,
    },
    name: { type: String, required: true },
    description: { type: String, required: true },
    enabled: { type: Boolean, default: true }, // true = BLOCKED / RESTRICTED, false = ALLOWED
    scope: { type: String, enum: ['global', 'device'], default: 'global' },
    scopeTarget: { type: String, default: 'all' },
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

export const BrowserRule = mongoose.model('BrowserRule', browserRuleSchema);
