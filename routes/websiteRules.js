import express from 'express';
import { WebsiteRule } from '../models/WebsiteRule.js';
import { Device } from '../models/Device.js';
import { AuditLog } from '../models/AuditLog.js';

export function normalizeDomain(raw) {
  if (!raw) return '';
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//i, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  d = d.split(':')[0];
  d = d.replace(/^\.+|\.+$/g, '');
  return d;
}

const router = express.Router();

// GET all website rules
router.get('/', async (req, res) => {
  try {
    const { search, action, scope } = req.query;
    const filter = {};
    if (action && action !== 'all') filter.action = action;
    if (scope && scope !== 'all') filter.scope = scope;
    if (search) {
      filter.$or = [
        { domain: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }
    const rules = await WebsiteRule.find(filter).sort({ createdAt: -1 });
    res.json(rules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single rule
router.get('/:id', async (req, res) => {
  try {
    const rule = await WebsiteRule.findOne({ id: req.params.id });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE website rule
router.post('/', async (req, res) => {
  try {
    const { id, domain, category, action, scope, scopeTarget, schedule } = req.body;
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain) {
      return res.status(400).json({ message: 'Valid domain is required' });
    }

    const ruleId = id || `w-${Date.now()}`;
    const newRule = new WebsiteRule({
      id: ruleId,
      domain: cleanDomain,
      category: category || 'General',
      action: action || 'block',
      scope: scope || 'global',
      scopeTarget: scope !== 'global' ? scopeTarget : undefined,
      schedule,
      createdAt: new Date().toISOString(),
    });
    const saved = await newRule.save();

    // If global rule, synchronize to all active devices so device-level overrides stay consistent
    if ((scope || 'global') === 'global') {
      const devices = await Device.find({});
      for (const dev of devices) {
        if (!dev.deviceId) continue;
        const existingDevRule = await WebsiteRule.findOne({
          scope: 'device',
          scopeTarget: dev.deviceId,
          domain: cleanDomain,
        });
        if (!existingDevRule) {
          await WebsiteRule.create({
            id: `w-dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            domain: cleanDomain,
            category: category || 'General',
            action: action || 'block',
            scope: 'device',
            scopeTarget: dev.deviceId,
            schedule,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Log action
    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Website Rule Added',
      category: 'website',
      actor: 'Admin',
      target: saved.domain,
      timestamp: new Date().toISOString(),
      details: `Added ${saved.scope} ${saved.action} rule for ${saved.domain}`,
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// BULK CREATE website rules
router.post('/bulk', async (req, res) => {
  try {
    const { domains, action, category, scope } = req.body;
    if (!Array.isArray(domains) || domains.length === 0) {
      return res.status(400).json({ message: 'Domains array is required' });
    }

    const createdRules = [];
    for (const d of domains) {
      const clean = normalizeDomain(d);
      if (!clean) continue;
      const rule = new WebsiteRule({
        id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        domain: clean,
        category: category || 'Bulk Added',
        action: action || 'block',
        scope: scope || 'global',
        createdAt: new Date().toISOString(),
      });
      const saved = await rule.save();
      createdRules.push(saved);
    }

    res.status(201).json({ message: `Added ${createdRules.length} rules`, rules: createdRules });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE website rule
router.put('/:id', async (req, res) => {
  try {
    const updated = await WebsiteRule.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Rule not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE website rule
router.delete('/:id', async (req, res) => {
  try {
    const rule = await WebsiteRule.findOne({ id: req.params.id });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });

    const domainNormalized = rule.domain.toLowerCase().trim();

    if (rule.scope === 'global') {
      // Deleting a global rule cleanly deletes all rules for this domain across all scopes
      await WebsiteRule.deleteMany({ domain: domainNormalized });
    } else {
      await WebsiteRule.deleteOne({ id: req.params.id });
    }

    // Audit log
    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Website Rule Deleted',
      category: 'website',
      actor: 'Admin',
      target: rule.domain,
      timestamp: new Date().toISOString(),
      details: `Deleted ${rule.scope} rule for ${rule.domain}. All associated blocks removed.`,
    });

    res.json({ message: 'Rule deleted successfully', id: req.params.id, domain: rule.domain });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
