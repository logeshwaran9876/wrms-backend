import express from 'express';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { hashPassword, verifyPassword, generateToken } from '../utils/authUtils.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Default bootstrap passwords for initial users
const DEFAULT_PASSWORDS = {
  'admin@company.com': 'Admin@12345',
  'logesh@company.local': 'Logesh@12345',
};

/**
 * POST /api/auth/login
 * Authenticates user credentials and returns a signed Bearer token
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find user (case-insensitive)
    let user = await User.findOne({
      email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') },
    });

    if (!user) {
      // If super_admin doesn't exist at all, auto-provision
      if (cleanEmail === 'admin@company.com') {
        const { hash, salt } = hashPassword('Admin@12345');
        user = new User({
          id: 'u-admin',
          name: 'Administrator',
          email: 'admin@company.com',
          passwordHash: hash,
          passwordSalt: salt,
          role: 'super_admin',
          status: 'active',
          lastLogin: new Date().toISOString(),
        });
        await user.save();
      } else {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    }

    // Auto-migrate legacy user without password
    if (!user.passwordHash || !user.passwordSalt) {
      const defaultPwd = DEFAULT_PASSWORDS[user.email.toLowerCase()] || 'Admin@12345';
      if (password === defaultPwd) {
        const { hash, salt } = hashPassword(defaultPwd);
        user.passwordHash = hash;
        user.passwordSalt = salt;
        await user.save();
      } else {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    } else {
      // Verify password
      const isValid = verifyPassword(password, user.passwordHash, user.passwordSalt);
      if (!isValid) {
        await AuditLog.create({
          id: `log-${Date.now().toString().slice(-6)}`,
          action: 'Failed Login Attempt',
          category: 'auth',
          actor: cleanEmail,
          target: 'WRMS Management Console',
          timestamp: new Date().toISOString(),
          details: `Failed login attempt for user ${cleanEmail}`,
        });
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ message: 'Your account is currently deactivated.' });
    }

    // Update lastLogin timestamp
    user.lastLogin = new Date().toISOString();
    await user.save();

    // Generate token
    const token = generateToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });

    // Record audit log
    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Super Admin Login',
      category: 'auth',
      actor: user.name,
      target: 'WRMS Management Console',
      timestamp: new Date().toISOString(),
      details: `${user.role === 'super_admin' ? 'Super Admin' : user.role} logged in successfully`,
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLogin: user.lastLogin,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Internal server error during login' });
  }
});

/**
 * GET /api/auth/me
 * Returns authenticated user profile
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      lastLogin: user.lastLogin,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/auth/logout
 * Records logout event and terminates session
 */
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = req.user || null;
      if (decoded?.name) {
        await AuditLog.create({
          id: `log-${Date.now().toString().slice(-6)}`,
          action: 'User Logout',
          category: 'auth',
          actor: decoded.name,
          target: 'WRMS Management Console',
          timestamp: new Date().toISOString(),
          details: `${decoded.name} signed out of WRMS Console`,
        });
      }
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
