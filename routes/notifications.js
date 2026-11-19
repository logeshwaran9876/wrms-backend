import express from 'express';
import { Notification } from '../models/Notification.js';

const router = express.Router();

// GET all notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ timestamp: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE notification
router.post('/', async (req, res) => {
  try {
    const { id, title, message, type } = req.body;
    const notifId = id || `n-${Date.now()}`;
    const newNotif = new Notification({
      id: notifId,
      title,
      message,
      type: type || 'info',
      timestamp: new Date().toISOString(),
      read: false,
    });
    const saved = await newNotif.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// MARK SINGLE AS READ
router.put('/:id/read', async (req, res) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { id: req.params.id },
      { $set: { read: true } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Notification not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// MARK ALL AS READ
router.put('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({ read: false }, { $set: { read: true } });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE notification
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Notification.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Notification not found' });
    res.json({ message: 'Notification deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
