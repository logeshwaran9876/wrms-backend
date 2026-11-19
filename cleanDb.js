import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { User } from './models/User.js';
import { Department } from './models/Department.js';
import { Device } from './models/Device.js';
import { WebsiteRule } from './models/WebsiteRule.js';
import { ApplicationRule } from './models/ApplicationRule.js';
import { BrowserRule } from './models/BrowserRule.js';
import { UsbRule } from './models/UsbRule.js';
import { Policy } from './models/Policy.js';
import { AuditLog } from './models/AuditLog.js';
import { Notification } from './models/Notification.js';
import {
  BlockedAccessEvent,
  RecentAdminAction,
  WebsiteAccessTrend,
  BlockedCategory,
  PolicyCompliance,
} from './models/Analytics.js';

export async function cleanAndInitializeDatabase() {
  console.log('[CleanDB] Connecting to MongoDB...');
  await connectDB();

  console.log('[CleanDB] Removing all existing data from MongoDB...');
  await Promise.all([
    User.deleteMany({}),
    Department.deleteMany({}),
    Device.deleteMany({}),
    WebsiteRule.deleteMany({}),
    ApplicationRule.deleteMany({}),
    BrowserRule.deleteMany({}),
    UsbRule.deleteMany({}),
    Policy.deleteMany({}),
    AuditLog.deleteMany({}),
    Notification.deleteMany({}),
    BlockedAccessEvent.deleteMany({}),
    RecentAdminAction.deleteMany({}),
    WebsiteAccessTrend.deleteMany({}),
    BlockedCategory.deleteMany({}),
    PolicyCompliance.deleteMany({}),
  ]);

  console.log('[CleanDB] Creating clean operational baseline...');

  // 1. Core Administrator Account
  const adminUser = await User.create({
    id: 'u-admin',
    name: 'Administrator',
    email: 'admin@company.com',
    role: 'super_admin',
    status: 'active',
    createdAt: new Date().toISOString(),
  });

  // 2. Standard Enterprise Departments
  const departments = await Department.insertMany([
    { id: 'd-001', name: 'Human Resources', description: 'Recruitment, payroll, and employee relations', employeeCount: 0, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
    { id: 'd-002', name: 'Finance', description: 'Accounting, budgeting, and financial planning', employeeCount: 0, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
    { id: 'd-003', name: 'Development', description: 'Software engineering, DevOps, and IT systems', employeeCount: 0, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
    { id: 'd-004', name: 'Sales', description: 'Client acquisition and account management', employeeCount: 0, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
    { id: 'd-005', name: 'Marketing', description: 'Brand, content, and digital campaigns', employeeCount: 0, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
    { id: 'd-006', name: 'Administration', description: 'Office operations and executive support', employeeCount: 1, deviceCount: 0, policyCount: 1, createdAt: new Date().toISOString() },
  ]);

  // 3. Default Enterprise Policy
  const defaultPolicy = await Policy.create({
    id: 'p-002',
    name: 'Standard Security Policy',
    description: 'Default enterprise policy for managed Windows devices',
    version: 1,
    createdBy: 'Administrator',
    active: true,
    assignments: {
      departments: ['d-001', 'd-002', 'd-003', 'd-004', 'd-005', 'd-006'],
      employees: [],
      devices: [],
    },
    rules: {
      website: 4,
      application: 0,
      browser: 1,
      usb: 0,
    },
  });

  // 4. Baseline Global Website Rules (Ready for Device Assignment)
  const baselineWebsiteRules = await WebsiteRule.insertMany([
    {
      id: 'w-001',
      domain: 'youtube.com',
      category: 'Entertainment',
      action: 'block',
      scope: 'global',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'w-002',
      domain: 'facebook.com',
      category: 'Social Media',
      action: 'block',
      scope: 'global',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'w-003',
      domain: 'instagram.com',
      category: 'Social Media',
      action: 'block',
      scope: 'global',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'w-004',
      domain: 'tiktok.com',
      category: 'Entertainment',
      action: 'block',
      scope: 'global',
      createdAt: new Date().toISOString(),
    },
  ]);

  // 5. Initial Audit Log
  await AuditLog.create({
    id: `log-${Date.now()}`,
    action: 'Database Initialized',
    category: 'policy',
    actor: 'Administrator',
    target: 'MongoDB',
    timestamp: new Date().toISOString(),
    details: 'Database reset to clean baseline with 4 global rules (youtube.com, facebook.com, instagram.com, tiktok.com). Ready for device auto-registration and dynamic assignment.',
  });

  console.log('========================================================');
  console.log('   CLEAN DATABASE INITIALIZED SUCCESSFULLY');
  console.log('========================================================');
  console.log(`- Super Admin: ${adminUser.email} (ID: ${adminUser.id})`);
  console.log(`- Departments: ${departments.length} ready`);
  console.log(`- Default Policy: ${defaultPolicy.name} (ID: ${defaultPolicy.id})`);
  console.log(`- Global Website Rules: ${baselineWebsiteRules.length} (youtube.com, facebook.com, instagram.com, tiktok.com)`);
  console.log('- Devices: 0 (Awaiting real Windows Agent registration)');
  console.log('- Temporary Permissions: 0');
  console.log('========================================================');

  return {
    success: true,
    message: 'Database cleaned and operational baseline established',
  };
}

// Auto-run if executed directly via node server/cleanDb.js
if (process.argv[1] && process.argv[1].endsWith('cleanDb.js')) {
  cleanAndInitializeDatabase()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[CleanDB Error]', err);
      await mongoose.disconnect();
      process.exit(1);
    });
}
