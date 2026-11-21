import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { connectDB } from './config/db.js';
import { seedDatabase } from './routes/seed.js';
import { User } from './models/User.js';
import { hashPassword } from './utils/authUtils.js';

import usersRouter from './routes/users.js';
import departmentsRouter from './routes/departments.js';
import devicesRouter from './routes/devices.js';
import websiteRulesRouter from './routes/websiteRules.js';
import applicationRulesRouter from './routes/applicationRules.js';
import browserRulesRouter from './routes/browserRules.js';
import usbRulesRouter from './routes/usbRules.js';
import policiesRouter from './routes/policies.js';
import auditLogsRouter from './routes/auditLogs.js';
import notificationsRouter from './routes/notifications.js';
import dashboardRouter from './routes/dashboard.js';
import reportsRouter from './routes/reports.js';
import authRouter from './routes/auth.js';
import seedRouter from './routes/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Secret', 'X-Device-Id'],
}));
app.use(express.json());

// Request logger for API calls
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.originalUrl.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      connected: isConnected,
      name: mongoose.connection.name,
      host: mongoose.connection.host,
    },
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/website-rules', websiteRulesRouter);
app.use('/api/application-rules', applicationRulesRouter);
app.use('/api/browser-rules', browserRulesRouter);
app.use('/api/usb-rules', usbRulesRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/seed', seedRouter);

// Root API Status Endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'WRMS Central Enforcement & Policy API',
    version: '1.0.0',
    healthCheck: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

// 404 Handler for undefined API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Fallback 404 for non-API routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'WRMS API Backend. Access API endpoints at /api/*' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start Server and connect to MongoDB
async function startServer() {
  try {
    await connectDB();
    await seedDatabase(false);

    // Ensure super_admin and existing users have secure password hashes
    const unhashedUsers = await User.find({
      $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }],
    });
    for (const u of unhashedUsers) {
      const defaultPwd = u.email === 'admin@company.com' ? 'Admin@12345' : 'Employee@12345';
      const { hash, salt } = hashPassword(defaultPwd);
      u.passwordHash = hash;
      u.passwordSalt = salt;
      await u.save();
      console.log(`[Auth] Initialized password for user ${u.email} (${u.role})`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`===============================================`);
      console.log(`  WRMS Express Server running on port ${PORT}`);
      console.log(`  Health Check: http://localhost:${PORT}/api/health`);
      console.log(`  MongoDB: ${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/windows_monitoring'}`);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
