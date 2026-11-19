import express from 'express';
import { User } from '../models/User.js';
import { Department } from '../models/Department.js';
import { Device } from '../models/Device.js';
import { WebsiteRule } from '../models/WebsiteRule.js';
import { ApplicationRule } from '../models/ApplicationRule.js';
import { BrowserRule } from '../models/BrowserRule.js';
import { UsbRule } from '../models/UsbRule.js';
import { Policy } from '../models/Policy.js';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import {
  BlockedAccessEvent,
  RecentAdminAction,
  WebsiteAccessTrend,
  BlockedCategory,
  PolicyCompliance,
} from '../models/Analytics.js';
import {
  initialUsers,
  initialDepartments,
  initialDevices,
  initialWebsiteRules,
  initialApplicationRules,
  initialBrowserRules,
  initialUsbRules,
  initialPolicies,
  initialAuditLogs,
  initialNotifications,
  initialBlockedAccessEvents,
  initialRecentAdminActions,
  initialWebsiteAccessTrend,
  initialBlockedCategories,
  initialPolicyComplianceData,
} from '../seedData.js';
import { cleanAndInitializeDatabase } from '../cleanDb.js';

export async function seedDatabase(force = false) {
  try {
    const userCount = await User.countDocuments();
    if (!force && userCount > 0) {
      console.log(`[Seed] Database already contains ${userCount} users. Skipping auto-seed.`);
      return { message: 'Database already seeded' };
    }

    if (!force) {
      console.log(`[Seed] Empty database detected. Establishing clean operational baseline...`);
      return await cleanAndInitializeDatabase();
    }

    console.log(`[Seed] Seeding MongoDB with initial data from mockData (force=true)...`);

    // Clear existing collections if forcing
    if (force || userCount === 0) {
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
    }

    // Insert all datasets
    const [
      users,
      depts,
      devs,
      webRules,
      appRules,
      browserRules,
      usbRules,
      policies,
      logs,
      notifs,
    ] = await Promise.all([
      User.insertMany(initialUsers),
      Department.insertMany(initialDepartments),
      Device.insertMany(initialDevices),
      WebsiteRule.insertMany(initialWebsiteRules),
      ApplicationRule.insertMany(initialApplicationRules),
      BrowserRule.insertMany(initialBrowserRules),
      UsbRule.insertMany(initialUsbRules),
      Policy.insertMany(initialPolicies),
      AuditLog.insertMany(initialAuditLogs),
      Notification.insertMany(initialNotifications),
      BlockedAccessEvent.insertMany(initialBlockedAccessEvents),
      RecentAdminAction.insertMany(initialRecentAdminActions),
      WebsiteAccessTrend.insertMany(initialWebsiteAccessTrend),
      BlockedCategory.insertMany(initialBlockedCategories),
      PolicyCompliance.insertMany(initialPolicyComplianceData),
    ]);

    console.log(`[Seed] Seeded successfully!`);
    return {
      success: true,
      counts: {
        users: users.length,
        departments: depts.length,
        devices: devs.length,
        websiteRules: webRules.length,
        applicationRules: appRules.length,
        browserRules: browserRules.length,
        usbRules: usbRules.length,
        policies: policies.length,
        auditLogs: logs.length,
        notifications: notifs.length,
      },
    };
  } catch (error) {
    console.error(`[Seed] Seeding error:`, error);
    throw error;
  }
}

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const result = await seedDatabase(true);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
