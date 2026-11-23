import express from 'express';
import { ApplicationRule } from '../models/ApplicationRule.js';
import { AuditLog } from '../models/AuditLog.js';
import { DeviceSoftware } from '../models/DeviceSoftware.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

export { escapeRegex };

export function normalizeExecutable(input) {
  if (!input) return '';
  let str = input.trim().toLowerCase();
  str = str.split(/[\\/]/).pop();
  if (str && !str.endsWith('.exe')) {
    str += '.exe';
  }
  return str;
}

// 1-Click block installed software directly from Inventory
router.post('/block-installed', async (req, res) => {
  try {
    const { appName, executable, publisher, scope, scopeTarget } = req.body;
    if (!appName || !appName.trim()) {
      return res.status(400).json({ message: 'appName is required' });
    }
    const cleanExe = normalizeExecutable(executable || appName);
    const escapedExe = escapeRegex(cleanExe);
    const ruleScope = scope || 'global';

    let rule = await ApplicationRule.findOne({
      $or: [
        { executableName: new RegExp(`^${escapedExe}$`, 'i'), scope: ruleScope },
        { appName: appName.trim(), scope: ruleScope },
      ],
    });

    if (rule) {
      rule.action = 'block';
      rule.executableName = cleanExe;
      await rule.save();
    } else {
      rule = new ApplicationRule({
        id: `a-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        appName: appName.trim(),
        executableName: cleanExe,
        publisher: publisher || 'Unknown',
        action: 'block',
        scope: ruleScope,
        scopeTarget: ruleScope !== 'global' ? scopeTarget : undefined,
        createdAt: new Date().toISOString(),
      });
      await rule.save();
    }

    // Update software inventory blocked state
    await DeviceSoftware.updateMany(
      { executable: new RegExp(`^${escapedExe}$`, 'i') },
      { $set: { isBlocked: true } }
    );

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Application Blocked',
      category: 'policy',
      actor: 'Admin',
      target: `${appName} (${cleanExe})`,
      timestamp: new Date().toISOString(),
      details: `Installed application ${appName} (${cleanExe}) was added to Application Control blocklist from software inventory.`,
    });

    res.status(200).json({ message: 'Application blocked successfully', rule });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1-Click unblock installed software
router.post('/unblock-installed', async (req, res) => {
  try {
    const { executable } = req.body;
    if (!executable) {
      return res.status(400).json({ message: 'executable is required' });
    }
    const cleanExe = normalizeExecutable(executable);
    const escapedExe = escapeRegex(cleanExe);

    await ApplicationRule.deleteMany({
      executableName: new RegExp(`^${escapedExe}$`, 'i'),
    });

    await DeviceSoftware.updateMany(
      { executable: new RegExp(`^${escapedExe}$`, 'i') },
      { $set: { isBlocked: false } }
    );

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Application Unblocked',
      category: 'policy',
      actor: 'Admin',
      target: cleanExe,
      timestamp: new Date().toISOString(),
      details: `Application ${cleanExe} was unblocked from Application Control blocklist.`,
    });

    res.status(200).json({ message: 'Application unblocked successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET all application rules
router.get('/', async (req, res) => {
  try {
    const { search, action, scope } = req.query;
    const filter = {};
    if (action && action !== 'all') filter.action = action;
    if (scope && scope !== 'all') filter.scope = scope;
    if (search && search.trim()) {
      const escaped = escapeRegex(search.trim());
      filter.$or = [
        { appName: { $regex: escaped, $options: 'i' } },
        { executableName: { $regex: escaped, $options: 'i' } },
        { publisher: { $regex: escaped, $options: 'i' } },
      ];
    }
    const rules = await ApplicationRule.find(filter).sort({ createdAt: -1 });
    res.json(rules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single rule
router.get('/:id', async (req, res) => {
  try {
    const rule = await ApplicationRule.findOne({ id: req.params.id });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE application rule
router.post('/', async (req, res) => {
  try {
    const { id, appName, executableName, publisher, action, version, scope, scopeTarget } = req.body;
    if (!appName || !appName.trim()) {
      return res.status(400).json({ message: 'Application name is required' });
    }

    const cleanExe = normalizeExecutable(executableName || appName);
    const ruleId = id || `a-${Date.now()}`;
    const newRule = new ApplicationRule({
      id: ruleId,
      appName: appName.trim(),
      executableName: cleanExe,
      publisher: publisher || 'Unknown',
      action: action || 'block',
      version,
      scope: scope || 'global',
      scopeTarget: scope !== 'global' ? scopeTarget : undefined,
      createdAt: new Date().toISOString(),
    });
    const saved = await newRule.save();

    // Log action
    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Application Rule Added',
      category: 'application',
      actor: 'Admin',
      target: `${saved.appName} (${cleanExe})`,
      timestamp: new Date().toISOString(),
      details: `Added ${saved.scope} ${saved.action} rule for ${saved.appName} (${cleanExe})`,
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE application rule
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.executableName || updateData.appName) {
      updateData.executableName = normalizeExecutable(updateData.executableName || updateData.appName);
    }
    const updated = await ApplicationRule.findOneAndUpdate(
      { id: req.params.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Rule not found' });

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Application Rule Updated',
      category: 'application',
      actor: 'Admin',
      target: `${updated.appName} (${updated.executableName})`,
      timestamp: new Date().toISOString(),
      details: `Updated application rule ${updated.appName} to action: ${updated.action}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE application rule
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await ApplicationRule.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Rule not found' });

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Application Rule Deleted',
      category: 'application',
      actor: 'Admin',
      target: `${deleted.appName} (${deleted.executableName})`,
      timestamp: new Date().toISOString(),
      details: `Removed ${deleted.action} rule for ${deleted.appName}`,
    });

    res.json({ message: 'Rule deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
