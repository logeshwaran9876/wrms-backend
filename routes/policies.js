import express from 'express';
import { Policy } from '../models/Policy.js';
import { AuditLog } from '../models/AuditLog.js';
import { WebsiteRule } from '../models/WebsiteRule.js';
import { ApplicationRule } from '../models/ApplicationRule.js';
import { BrowserRule } from '../models/BrowserRule.js';
import { UsbRule } from '../models/UsbRule.js';
import { Device } from '../models/Device.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

// Helper to count active rules across all subsystems
async function getLiveRuleCounts() {
  const [website, application, browser, usb] = await Promise.all([
    WebsiteRule.countDocuments({ action: 'block', scope: 'global' }),
    ApplicationRule.countDocuments({ action: 'block', scope: 'global' }),
    BrowserRule.countDocuments({ enabled: true, scope: 'global' }),
    UsbRule.countDocuments({ action: { $in: ['block', 'read_only'] }, scope: 'global' }),
  ]);
  return { website, application, browser, usb };
}

// GET all policies with dynamic rule counts
router.get('/', async (req, res) => {
  try {
    const { search, active } = req.query;
    const filter = {};
    if (active !== undefined && active !== 'all') {
      filter.active = active === 'true';
    }
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }

    const [policies, liveCounts, enrolledDevices] = await Promise.all([
      Policy.find(filter).sort({ updatedAt: -1 }).lean(),
      getLiveRuleCounts(),
      Device.find({}).select('id name deviceId employeeName').lean(),
    ]);

    // Attach dynamic live rule counts and device summary to policies
    const enriched = policies.map((p) => {
      const isDefaultOrActive = p.active;
      return {
        ...p,
        rules: isDefaultOrActive
          ? {
              website: Math.max(p.rules?.website || 0, liveCounts.website),
              application: Math.max(p.rules?.application || 0, liveCounts.application),
              browser: Math.max(p.rules?.browser || 0, liveCounts.browser),
              usb: Math.max(p.rules?.usb || 0, liveCounts.usb > 0 ? 1 : 0),
            }
          : p.rules || { website: 0, application: 0, browser: 0, usb: 0 },
        availableDevices: enrolledDevices.map((d) => ({
          id: d.id || d.deviceId,
          name: d.name,
          employeeName: d.employeeName,
        })),
      };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single policy
router.get('/:id', async (req, res) => {
  try {
    const policy = await Policy.findOne({ id: req.params.id }).lean();
    if (!policy) return res.status(404).json({ message: 'Policy not found' });
    const liveCounts = await getLiveRuleCounts();
    res.json({
      ...policy,
      rules: {
        website: Math.max(policy.rules?.website || 0, liveCounts.website),
        application: Math.max(policy.rules?.application || 0, liveCounts.application),
        browser: Math.max(policy.rules?.browser || 0, liveCounts.browser),
        usb: Math.max(policy.rules?.usb || 0, liveCounts.usb > 0 ? 1 : 0),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE policy
router.post('/', async (req, res) => {
  try {
    const { id, name, description, assignments, rules, timeRestrictions } = req.body;
    const policyId = id || `pol-${Date.now().toString().slice(-6)}`;
    const liveCounts = await getLiveRuleCounts();

    const newPolicy = new Policy({
      id: policyId,
      name,
      description: description || '',
      version: 1,
      createdBy: 'Admin',
      updatedAt: new Date().toISOString(),
      active: true,
      assignments: assignments || { departments: [], employees: [], devices: [] },
      rules: rules || liveCounts,
      timeRestrictions,
    });
    const saved = await newPolicy.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Policy Created',
      category: 'policy',
      actor: 'Admin',
      target: saved.name,
      timestamp: new Date().toISOString(),
      details: `Created new enterprise policy: ${saved.name} (v1)`,
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE policy (Full update & assignments)
router.put('/:id', async (req, res) => {
  try {
    const existing = await Policy.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ message: 'Policy not found' });

    const newVersion = (existing.version || 1) + 1;
    const updates = {
      ...req.body,
      version: newVersion,
      updatedAt: new Date().toISOString(),
    };

    const updated = await Policy.findOneAndUpdate(
      { id: req.params.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    // If devices are assigned, update device policy references
    if (req.body.assignments?.devices && Array.isArray(req.body.assignments.devices)) {
      await Device.updateMany(
        { $or: [{ id: { $in: req.body.assignments.devices } }, { deviceId: { $in: req.body.assignments.devices } }, { name: { $in: req.body.assignments.devices } }] },
        { $set: { policyId: updated.id, policyName: updated.name, updatedAt: new Date().toISOString() } }
      );
    }

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Policy Updated',
      category: 'policy',
      actor: 'Admin',
      target: updated.name,
      timestamp: new Date().toISOString(),
      details: `Updated policy: ${updated.name} to v${updated.version}. Assignments updated.`,
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ACTIVATE policy (Sets as active across assigned endpoints)
router.post('/:id/activate', async (req, res) => {
  try {
    const policy = await Policy.findOne({ id: req.params.id });
    if (!policy) return res.status(404).json({ message: 'Policy not found' });

    policy.active = true;
    policy.version = (policy.version || 1) + 1;
    policy.updatedAt = new Date().toISOString();
    await policy.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Policy Activated',
      category: 'policy',
      actor: 'Admin',
      target: policy.name,
      timestamp: new Date().toISOString(),
      details: `Policy ${policy.name} (v${policy.version}) activated and enforced for target endpoints.`,
    });

    res.json({ message: `Policy '${policy.name}' activated successfully`, policy });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE policy
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Policy.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Policy not found' });

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Policy Deleted',
      category: 'policy',
      actor: 'Admin',
      target: deleted.name,
      timestamp: new Date().toISOString(),
      details: `Deleted enterprise policy: ${deleted.name}`,
    });

    res.json({ message: 'Policy deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
