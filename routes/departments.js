import express from 'express';
import { Department } from '../models/Department.js';
import { escapeRegex } from '../utils/regexUtils.js';

const router = express.Router();

// GET all departments
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const filter = {};
    if (search && search.trim()) {
      const esc = escapeRegex(search.trim());
      filter.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }
    const departments = await Department.find(filter).sort({ name: 1 });
    res.json(departments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single department
router.get('/:id', async (req, res) => {
  try {
    const dept = await Department.findOne({ id: req.params.id });
    if (!dept) return res.status(404).json({ message: 'Department not found' });
    res.json(dept);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// CREATE department
router.post('/', async (req, res) => {
  try {
    const { id, name, description, employeeCount, deviceCount, policyCount } = req.body;
    const deptId = id || `d-${Date.now()}`;
    const newDept = new Department({
      id: deptId,
      name,
      description: description || '',
      employeeCount: employeeCount || 0,
      deviceCount: deviceCount || 0,
      policyCount: policyCount || 0,
      createdAt: new Date().toISOString().split('T')[0],
    });
    const saved = await newDept.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE department
router.put('/:id', async (req, res) => {
  try {
    const updated = await Department.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Department not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE department
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Department.findOneAndDelete({ id: req.params.id });
    if (!deleted) return res.status(404).json({ message: 'Department not found' });
    res.json({ message: 'Department deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
