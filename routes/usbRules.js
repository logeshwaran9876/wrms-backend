import express from 'express';
import { UsbRule } from '../models/UsbRule.js';
import { AuditLog } from '../models/AuditLog.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

// GET all USB rules
router.get('/', async (req, res) => {
  try {
    const { search, action, scope } = req.query;
    const filter = {};
    if (action && action !== 'all') filter.action = action;
    if (scope && scope !== 'all') filter.scope = scope;
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { scopeTarget: { $regex: esc, $options: 'i' } },
      ];
    }
    const rules = await UsbRule.find(filter).sort({ createdAt: -1 });
    res.json(rules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single rule
router.get('/:id', async (req, res) => {
  try {
    const rule = await UsbRule.findOne({ id: req.params.id });
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json(rule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE USB rule
router.post('/', async (req, res) => {
  try {
    const { id, name, action, scope, scopeTarget, exception, expiresAt } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Policy name is required' });
    }

    const ruleId = id || `u-${Date.now()}`;
    const newRule = new UsbRule({
      id: ruleId,
      name: name.trim(),
      action: action || 'block',
      scope: scope || 'global',
      scopeTarget: scope !== 'global' ? scopeTarget : undefined,
      exception: !!exception,
      expiresAt: exception ? (expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()) : undefined,
      createdAt: new Date().toISOString(),
    });
    const saved = await newRule.save();

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'USB Rule Added',
      category: 'policy',
      actor: 'Admin',
      target: saved.name,
      timestamp: new Date().toISOString(),
      details: `Created USB ${saved.action} rule: ${saved.name}`,
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE USB rule
router.put('/:id', async (req, res) => {
  try {
    const updated = await UsbRule.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Rule not found' });

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'USB Rule Updated',
      category: 'policy',
      actor: 'Admin',
      target: updated.name,
      timestamp: new Date().toISOString(),
      details: `Updated USB rule ${updated.name} to action: ${updated.action}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE USB rule
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await UsbRule.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Rule not found' });

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'USB Rule Deleted',
      category: 'policy',
      actor: 'Admin',
      target: deleted.name,
      timestamp: new Date().toISOString(),
      details: `Removed USB rule: ${deleted.name}`,
    });

    res.json({ message: 'Rule deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
