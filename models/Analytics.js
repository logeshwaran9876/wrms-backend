import mongoose from 'mongoose';

const blockedAccessEventSchema = new mongoose.Schema({
  time: { type: String, default: () => new Date().toISOString() },
  device: { type: String, required: true },
  domain: { type: String, required: true },
  employee: { type: String, required: true },
});

const recentAdminActionSchema = new mongoose.Schema({
  action: { type: String, required: true },
  target: { type: String, required: true },
  actor: { type: String, required: true },
  time: { type: String, default: () => new Date().toISOString() },
});

const websiteAccessTrendSchema = new mongoose.Schema({
  date: { type: String, required: true },
  blocked: { type: Number, default: 0 },
  allowed: { type: Number, default: 0 },
});

const blockedCategorySchema = new mongoose.Schema({
  category: { type: String, required: true },
  count: { type: Number, default: 0 },
});

const policyComplianceSchema = new mongoose.Schema({
  department: { type: String, required: true },
  compliance: { type: Number, default: 100 },
  devices: { type: Number, default: 0 },
});

export const BlockedAccessEvent = mongoose.model('BlockedAccessEvent', blockedAccessEventSchema);
export const RecentAdminAction = mongoose.model('RecentAdminAction', recentAdminActionSchema);
export const WebsiteAccessTrend = mongoose.model('WebsiteAccessTrend', websiteAccessTrendSchema);
export const BlockedCategory = mongoose.model('BlockedCategory', blockedCategorySchema);
export const PolicyCompliance = mongoose.model('PolicyCompliance', policyComplianceSchema);
