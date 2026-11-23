import express from 'express';
import { User } from '../models/User.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

// GET current user
router.get('/me/current', async (req, res) => {
  try {
    let user = await User.findOne({ role: 'super_admin' });
    if (!user) {
      user = await User.findOne();
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET all users (supports ?search, ?role, ?departmentId, ?status)
router.get('/', async (req, res) => {
  try {
    const { search, role, departmentId, status } = req.query;
    const filter = {};

    if (role && role !== 'all') filter.role = role;
    if (departmentId && departmentId !== 'all') filter.departmentId = departmentId;
    if (status && status !== 'all') filter.status = status;
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { email: { $regex: esc, $options: 'i' } },
      ];
    }

    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single user
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE user
router.post('/', async (req, res) => {
  try {
    const { id, name, email, role, departmentId, status, lastLogin } = req.body;
    const userId = id || `u-${Date.now()}`;
    const newUser = new User({
      id: userId,
      name,
      email,
      role: role || 'employee',
      departmentId,
      status: status || 'active',
      lastLogin: lastLogin || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    const saved = await newUser.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE user
router.put('/:id', async (req, res) => {
  try {
    const updated = await User.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'User not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
