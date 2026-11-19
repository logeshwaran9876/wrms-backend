import express from 'express';
import { BrowserRule } from '../models/BrowserRule.js';
import { AuditLog } from '../models/AuditLog.js';
import { initialBrowserRules } from '../seedData.js';

const router = express.Router();

// Auto-seed or reset browser rules to 5-browser schema
export async function ensureBrowserRules() {
  const sample = await BrowserRule.findOne();
  // If collection is empty or uses old schema without controlType, reset with new 5-browser baseline
  if (!sample || !sample.controlType) {
    await BrowserRule.deleteMany({ scope: 'global' });
    await BrowserRule.insertMany(initialBrowserRules);
  }
}

// GET all browser rules
router.get('/', async (req, res) => {
  try {
    await ensureBrowserRules();
    const { browser, controlType } = req.query;
    const filter = { scope: 'global' };
    if (browser) filter.browser = browser;
    if (controlType) filter.controlType = controlType;

    const rules = await BrowserRule.find(filter).sort({ browser: 1, controlType: 1 });
    res.json(rules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST toggle setting for specific browser or all browsers
router.post('/toggle', async (req, res) => {
  try {
    const { browser, controlType, enabled } = req.body;
    await ensureBrowserRules();

    if (browser === 'all') {
      await BrowserRule.updateMany(
        { controlType, scope: 'global' },
        { $set: { enabled } }
      );
    } else {
      await BrowserRule.updateMany(
        { browser, controlType, scope: 'global' },
        { $set: { enabled } }
      );
    }

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Browser Rule Toggled',
      category: 'policy',
      actor: 'Admin',
      target: `${browser.toUpperCase()} - ${controlType}`,
      timestamp: new Date().toISOString(),
      details: `Set ${browser.toUpperCase()} ${controlType} to ${enabled ? 'BLOCKED' : 'ALLOWED'}`,
    });

    const updatedRules = await BrowserRule.find({ scope: 'global' }).sort({ browser: 1, controlType: 1 });
    res.json({ message: 'Browser policy updated successfully', rules: updatedRules });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT update individual rule
router.put('/:id', async (req, res) => {
  try {
    const { enabled } = req.body;
    const updated = await BrowserRule.findOneAndUpdate(
      { id: req.params.id },
      { $set: { enabled } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Rule not found' });

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Browser Rule Updated',
      category: 'policy',
      actor: 'Admin',
      target: `${updated.browser.toUpperCase()} - ${updated.controlType}`,
      timestamp: new Date().toISOString(),
      details: `${updated.name} set to ${updated.enabled ? 'BLOCKED' : 'ALLOWED'}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;
