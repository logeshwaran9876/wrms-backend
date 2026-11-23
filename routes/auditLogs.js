import express from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

// Helper to sanitize messy raw IDs like WRMS-DEV-a65e3e96-034a-403b-a221-9da7b8d29f20
function cleanRawId(str) {
  if (!str) return '';
  return str
    .replace(/pol-WRMS-DEV-[a-f0-9-]+/gi, 'Dynamic Workstation Policy')
    .replace(/WRMS-DEV-[a-f0-9-]+/gi, 'DESKTOP-0MOUMVJ')
    .replace(/\s*\(\s*\)/g, '')
    .trim();
}

function formatSimpleId(id, index) {
  if (!id) return `#LOG-${index || 1000}`;
  const num = id.replace(/\D/g, '');
  if (num.length >= 4) {
    return `#LOG-${num.slice(-4)}`;
  }
  return `#${id.toUpperCase().replace(/^LOG-?/, 'LOG-')}`;
}

// GET all audit logs (supports server-side ?page, ?limit, ?search, ?category)
router.get('/', async (req, res) => {
  try {
    const { search, category, page, limit } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { action: { $regex: esc, $options: 'i' } },
        { actor: { $regex: esc, $options: 'i' } },
        { target: { $regex: esc, $options: 'i' } },
        { details: { $regex: esc, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    const [total, rawLogs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limitNum).lean(),
    ]);

    const sanitizedLogs = rawLogs.map((log, idx) => ({
      ...log,
      displayId: formatSimpleId(log.id, total - skip - idx),
      actor: cleanRawId(log.actor),
      target: cleanRawId(log.target),
      details: cleanRawId(log.details),
    }));

    const totalPages = Math.ceil(total / limitNum) || 1;

    res.json({
      logs: sanitizedLogs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET CSV export of audit logs
router.get('/export/csv', async (req, res) => {
  try {
    const { category, search } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { action: { $regex: esc, $options: 'i' } },
        { actor: { $regex: esc, $options: 'i' } },
        { target: { $regex: esc, $options: 'i' } },
        { details: { $regex: esc, $options: 'i' } },
      ];
    }

    const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(1000).lean();

    const headers = ['Log ID', 'Who (Actor)', 'Action', 'For Who (Target)', 'Category', 'When (Timestamp)', 'Details'];
    const rows = logs.map((l, i) => [
      formatSimpleId(l.id, i + 1),
      `"${cleanRawId(l.actor).replace(/"/g, '""')}"`,
      `"${(l.action || '').replace(/"/g, '""')}"`,
      `"${cleanRawId(l.target).replace(/"/g, '""')}"`,
      `"${(l.category || '').replace(/"/g, '""')}"`,
      `"${l.timestamp || ''}"`,
      `"${cleanRawId(l.details).replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=wrms-audit-logs-${Date.now()}.csv`);
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single audit log
router.get('/:id', async (req, res) => {
  try {
    const log = await AuditLog.findOne({ id: req.params.id }).lean();
    if (!log) return res.status(404).json({ message: 'Audit log not found' });
    res.json({
      ...log,
      displayId: formatSimpleId(log.id, 1),
      actor: cleanRawId(log.actor),
      target: cleanRawId(log.target),
      details: cleanRawId(log.details),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE audit log
router.post('/', async (req, res) => {
  try {
    const { id, action, category, actor, target, details, timestamp } = req.body;
    const logId = id || `log-${Date.now().toString().slice(-6)}`;
    const newLog = new AuditLog({
      id: logId,
      action,
      category,
      actor: cleanRawId(actor || 'System'),
      target: cleanRawId(target || 'System'),
      details: cleanRawId(details || ''),
      timestamp: timestamp || new Date().toISOString(),
    });
    const saved = await newLog.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE single audit log
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await AuditLog.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Audit log not found' });
    res.json({ message: 'Audit log deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CLEAR all audit logs
router.delete('/', async (req, res) => {
  try {
    await AuditLog.deleteMany({});
    res.json({ message: 'All audit logs cleared' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
