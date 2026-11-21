import express from 'express';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { WebsiteRule } from '../models/WebsiteRule.js';
import { ApplicationRule } from '../models/ApplicationRule.js';
import { UsbRule } from '../models/UsbRule.js';
import { BrowserRule } from '../models/BrowserRule.js';
import { AuditLog } from '../models/AuditLog.js';
import { DeviceSoftware } from '../models/DeviceSoftware.js';
import { MasterPort } from '../models/MasterPort.js';
import { normalizeDomain } from './websiteRules.js';
import { normalizeExecutable } from './applicationRules.js';

const router = express.Router();

/**
 * Automatically resolves Public IP & Geo-Location (City, Region, Country, ISP)
 * Queries free high-reliability geolocation service with rapid timeout.
 */
export async function resolveDeviceLocation(ip) {
  try {
    const isPrivate = !ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.');
    const url = isPrivate ? 'http://ip-api.com/json' : `http://ip-api.com/json/${ip}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'success') {
        return {
          publicIp: data.query || '',
          location: {
            city: data.city || '',
            region: data.regionName || data.region || '',
            country: data.country || '',
            countryCode: data.countryCode || '',
            isp: data.isp || '',
          },
        };
      }
    }
  } catch (err) {
    // Network or timeout
  }
  return null;
}

/**
 * Evaluates active listening ports against Master Allowed Ports baseline.
 */
export async function evaluatePorts(openPortsList, blockedPorts = []) {
  if (!Array.isArray(openPortsList)) return { ports: [], total: 0, disallowed: 0 };

  let masterPorts = await MasterPort.find({ active: true }).lean().catch(() => []);
  if (!masterPorts || masterPorts.length === 0) {
    masterPorts = [
      { port: 80, protocol: 'TCP' },
      { port: 443, protocol: 'TCP' },
      { port: 53, protocol: 'UDP' },
      { port: 123, protocol: 'UDP' },
      { port: 22, protocol: 'TCP' },
      { port: 3000, protocol: 'TCP' },
      { port: 5000, protocol: 'TCP' },
      { port: 5173, protocol: 'TCP' },
    ];
  }
  const allowedSet = new Set(masterPorts.map((p) => Number(p.port)));
  const blockedSet = new Set(
    (blockedPorts || []).map((p) => (typeof p === 'number' ? p : Number(p.port || p.Port)))
  );

  let disallowedCount = 0;
  const evaluated = openPortsList.map((item) => {
    const portNum = typeof item === 'number' ? item : Number(item.port || item.Port);
    const proto = (item.protocol || item.Protocol || 'TCP').toUpperCase();
    const proc = item.processName || item.ProcessName || '';
    const isBlocked = blockedSet.has(portNum) || item.isBlocked === true;
    const isAllowed = !isBlocked && allowedSet.has(portNum);
    if (!isAllowed) disallowedCount++;
    return {
      port: portNum,
      protocol: proto,
      processName: proc,
      isAllowed,
      isBlocked,
    };
  });

  return {
    ports: evaluated,
    total: evaluated.length,
    disallowed: disallowedCount,
  };
}

/**
 * Automatically find or create an employee for a device.
 * If the employee already exists (by ID, Name, or Email), reuses their record ("if already there then no need").
 * If the employee doesn't exist, automatically creates a new User document in MongoDB ("employ will create automatically").
 */
export async function findOrCreateEmployeeForDevice({
  employeeId,
  employeeName,
  employeeEmail,
  deviceName,
}) {
  // 1. If employeeId is passed and valid, find by ID
  if (employeeId) {
    const existingById = await User.findOne({ id: employeeId });
    if (existingById) return existingById;
  }

  // 2. Determine target name
  let targetName = (employeeName || '').trim();
  const isServiceOrMachine =
    !targetName ||
    targetName.endsWith('$') ||
    ['SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE'].includes(targetName.toUpperCase());

  if (isServiceOrMachine) {
    targetName = deviceName ? `${deviceName} User` : 'Workstation User';
  }

  // 3. Check if user ALREADY exists by name (case-insensitive) or email
  const nameRegex = new RegExp(`^${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  let query = [{ name: { $regex: nameRegex } }];
  if (employeeEmail) {
    query.push({ email: employeeEmail.trim().toLowerCase() });
  }

  let user = await User.findOne({ $or: query });

  if (user) {
    // Already exists -> no need to create a duplicate!
    return user;
  }

  // 4. Auto-create new employee
  const basePrefix = targetName.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || 'user';
  let email = employeeEmail ? employeeEmail.trim().toLowerCase() : `${basePrefix}@company.local`;

  // Ensure unique email
  let counter = 1;
  while (await User.findOne({ email })) {
    email = `${basePrefix}${counter}@company.local`;
    counter++;
  }

  const userCount = await User.countDocuments();
  const newUserId = `u-${String(userCount + 1).padStart(3, '0')}`;

  user = new User({
    id: newUserId,
    name: targetName,
    email: email,
    role: 'employee',
    status: 'active',
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  await user.save();

  await AuditLog.create({
    id: `log-${Date.now()}`,
    action: 'Employee Auto-Created',
    category: 'device',
    actor: 'WRMS Device Service',
    target: `${user.name} (${user.email})`,
    timestamp: new Date().toISOString(),
    details: `Employee profile automatically generated for device ${deviceName || 'Workstation'}.`,
  });

  return user;
}

// GET all devices (supports ?search, ?status, ?departmentId)
router.get('/', async (req, res) => {
  try {
    const { search, status, departmentId } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (departmentId && departmentId !== 'all') filter.departmentId = departmentId;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { deviceId: { $regex: search, $options: 'i' } },
        { employeeName: { $regex: search, $options: 'i' } },
      ];
    }
    const devices = await Device.find(filter).sort({ name: 1 });
    
    // Auto-resolve missing location or public IP
    for (const d of devices) {
      if (!d.location || !d.location.city || !d.publicIp) {
        resolveDeviceLocation(d.ipAddress).then(async (locInfo) => {
          if (locInfo) {
            d.publicIp = locInfo.publicIp;
            d.location = locInfo.location;
            await d.save().catch(() => {});
          }
        }).catch(() => {});
      }
    }

    res.json(devices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// Master Allowed Ports Baseline Endpoints (Defined before /:id)
// ==========================================

router.get('/master-ports', async (req, res) => {
  try {
    let ports = await MasterPort.find().sort({ port: 1 }).lean();
    if (!ports || ports.length === 0) {
      const defaults = [
        { port: 80, protocol: 'TCP', serviceName: 'HTTP', description: 'Standard Web Traffic', isDefault: true, active: true },
        { port: 443, protocol: 'TCP', serviceName: 'HTTPS', description: 'Secure Web Traffic', isDefault: true, active: true },
        { port: 53, protocol: 'UDP', serviceName: 'DNS', description: 'Domain Name Resolution', isDefault: true, active: true },
        { port: 123, protocol: 'UDP', serviceName: 'NTP', description: 'Network Time Sync', isDefault: true, active: true },
        { port: 22, protocol: 'TCP', serviceName: 'SSH', description: 'Secure Shell Remote', isDefault: true, active: true },
        { port: 3000, protocol: 'TCP', serviceName: 'Dev Server', description: 'Frontend Development', isDefault: true, active: true },
        { port: 5000, protocol: 'TCP', serviceName: 'WRMS Backend', description: 'WRMS Central API', isDefault: true, active: true },
        { port: 5173, protocol: 'TCP', serviceName: 'Vite HMR', description: 'Frontend Dev Server', isDefault: true, active: true },
      ];
      for (const p of defaults) {
        await MasterPort.findOneAndUpdate({ port: p.port }, p, { upsert: true });
      }
      ports = await MasterPort.find().sort({ port: 1 }).lean();
    }
    res.json(ports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/master-ports', async (req, res) => {
  try {
    const { port, protocol, serviceName, description } = req.body;
    const portNum = Number(port);
    if (!portNum) return res.status(400).json({ message: 'port number is required' });
    const created = await MasterPort.findOneAndUpdate(
      { port: portNum },
      {
        port: portNum,
        protocol: (protocol || 'TCP').toUpperCase(),
        serviceName: serviceName || `Port ${portNum} Service`,
        description: description || 'Master allowed port baseline',
        active: true,
      },
      { upsert: true, new: true }
    );

    // Re-evaluate openPorts on all devices
    const devices = await Device.find();
    for (const d of devices) {
      if (Array.isArray(d.openPorts) && d.openPorts.length > 0) {
        const { ports, total, disallowed } = await evaluatePorts(d.openPorts, d.blockedPorts || []);
        d.openPorts = ports;
        d.openPortsCount = total;
        d.disallowedPortsCount = disallowed;
        await d.save();
      }
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/master-ports/:port', async (req, res) => {
  try {
    const portNum = Number(req.params.port);
    await MasterPort.findOneAndDelete({ port: portNum });

    // Re-evaluate openPorts on all devices
    const devices = await Device.find();
    for (const d of devices) {
      if (Array.isArray(d.openPorts) && d.openPorts.length > 0) {
        const { ports, total, disallowed } = await evaluatePorts(d.openPorts, d.blockedPorts || []);
        d.openPorts = ports;
        d.openPortsCount = total;
        d.disallowedPortsCount = disallowed;
        await d.save();
      }
    }

    res.json({ message: `Port ${portNum} removed from Master Allowed baseline` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET single device
router.get('/:id', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });
    if (!device.location || !device.location.city || !device.publicIp) {
      const locInfo = await resolveDeviceLocation(device.ipAddress);
      if (locInfo) {
        device.publicIp = locInfo.publicIp;
        device.location = locInfo.location;
        await device.save().catch(() => {});
      }
    }
    res.json(device);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// Device-Level Website & Domain Access Control
// ==========================================

// GET all website rules for a specific device (with inheritance and override status)
router.get('/:id/website-rules', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const globalRules = await WebsiteRule.find({ scope: 'global' });
    const deviceRules = await WebsiteRule.find({
      scope: 'device',
      scopeTarget: device.deviceId,
    });

    // Map global rules by normalized domain
    const globalDomainMap = new Map();
    for (const g of globalRules) {
      const clean = normalizeDomain(g.domain);
      if (clean) globalDomainMap.set(clean, g);
    }

    // Map device rules by normalized domain
    const deviceDomainMap = new Map();
    for (const d of deviceRules) {
      const clean = normalizeDomain(d.domain);
      if (clean) deviceDomainMap.set(clean, d);
    }

    // Combine all unique domains
    const allDomains = new Set([...globalDomainMap.keys(), ...deviceDomainMap.keys()]);
    const result = [];

    for (const dom of allDomains) {
      const gRule = globalDomainMap.get(dom);
      const dRule = deviceDomainMap.get(dom);

      const isOverride = !!dRule;
      const effectiveAction = isOverride ? dRule.action : (gRule ? gRule.action : 'allow');
      const category = (dRule && dRule.category) || (gRule && gRule.category) || 'General';
      const ruleId = (dRule && dRule.id) || (gRule && gRule.id) || `w-${dom}`;

      result.push({
        id: ruleId,
        domain: dom,
        category,
        action: effectiveAction,
        isOverride,
        origin: isOverride ? 'device' : 'global',
        globalAction: gRule ? gRule.action : null,
        createdAt: (dRule && dRule.createdAt) || (gRule && gRule.createdAt) || new Date().toISOString(),
      });
    }

    // Sort: overrides first, then alphabetical by domain
    result.sort((a, b) => {
      if (a.isOverride !== b.isOverride) return a.isOverride ? -1 : 1;
      return a.domain.localeCompare(b.domain);
    });

    res.json({
      deviceId: device.deviceId,
      deviceName: device.name,
      employeeName: device.employeeName,
      totalRules: result.length,
      overrideCount: result.filter(r => r.isOverride).length,
      rules: result,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST / PUT set or override a domain rule for a specific device
router.post('/:id/website-rules', async (req, res) => {
  try {
    const { domain, action, category, schedule } = req.body;
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain) {
      return res.status(400).json({ message: 'Valid domain is required' });
    }

    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const ruleAction = action === 'allow' ? 'allow' : 'block';

    // Upsert device-level rule
    let devRule = await WebsiteRule.findOne({
      scope: 'device',
      scopeTarget: device.deviceId,
      domain: cleanDomain,
    });

    if (devRule) {
      devRule.action = ruleAction;
      if (category) devRule.category = category;
      if (schedule) devRule.schedule = schedule;
      devRule.updatedAt = new Date().toISOString();
      await devRule.save();
    } else {
      devRule = new WebsiteRule({
        id: `w-dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        domain: cleanDomain,
        category: category || 'Custom Device Override',
        action: ruleAction,
        scope: 'device',
        scopeTarget: device.deviceId,
        schedule,
        createdAt: new Date().toISOString(),
      });
      await devRule.save();
    }

    // Update device lastSync timestamp trigger
    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Website Rule Updated',
      category: 'website',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Set ${cleanDomain} -> ${ruleAction.toUpperCase()} for device ${device.name}`,
    });

    res.status(200).json({
      message: `Domain ${cleanDomain} set to ${ruleAction} on ${device.name}`,
      rule: devRule,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE remove device-level override (reverts to global policy)
router.delete('/:id/website-rules/:ruleIdOrDomain', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const target = req.params.ruleIdOrDomain;
    const cleanTarget = normalizeDomain(target);

    // Find and delete the device override
    const deleted = await WebsiteRule.findOneAndDelete({
      scope: 'device',
      scopeTarget: device.deviceId,
      $or: [
        { id: target },
        { domain: cleanTarget || target.toLowerCase() },
      ],
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Device override not found for this domain.' });
    }

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Website Override Reset',
      category: 'website',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Reset ${deleted.domain} override on device ${device.name} back to global policy`,
    });

    res.json({
      message: `Override for ${deleted.domain} removed. Reverted to global policy.`,
      domain: deleted.domain,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// Device-Level Application Rules Endpoints
// ==========================================

// GET application rules for a specific device (merged Global baseline + Device overrides)
router.get('/:id/application-rules', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const [globalRules, deviceRules] = await Promise.all([
      ApplicationRule.find({ scope: 'global' }),
      ApplicationRule.find({
        scope: 'device',
        scopeTarget: { $in: [device.deviceId, device.id, device.name] },
      }),
    ]);

    const globalMap = new Map();
    for (const g of globalRules) {
      const exe = normalizeExecutable(g.executableName || g.appName);
      if (exe) globalMap.set(exe, g);
    }

    const deviceMap = new Map();
    for (const d of deviceRules) {
      const exe = normalizeExecutable(d.executableName || d.appName);
      if (exe) deviceMap.set(exe, d);
    }

    const allExes = new Set([...globalMap.keys(), ...deviceMap.keys()]);
    const result = [];

    for (const exe of allExes) {
      const gRule = globalMap.get(exe);
      const dRule = deviceMap.get(exe);

      const isOverride = !!dRule;
      const effectiveAction = isOverride ? dRule.action : (gRule ? gRule.action : 'allow');
      const appName = (dRule && dRule.appName) || (gRule && gRule.appName) || exe.replace(/\.exe$/i, '');
      const ruleId = (dRule && dRule.id) || (gRule && gRule.id) || `app-${exe}`;

      result.push({
        id: ruleId,
        appName,
        executableName: exe,
        action: effectiveAction,
        isOverride,
        origin: isOverride ? 'device' : 'global',
        globalAction: gRule ? gRule.action : null,
        createdAt: (dRule && dRule.createdAt) || (gRule && gRule.createdAt) || new Date().toISOString(),
      });
    }

    result.sort((a, b) => {
      if (a.isOverride !== b.isOverride) return a.isOverride ? -1 : 1;
      return a.executableName.localeCompare(b.executableName);
    });

    res.json({
      deviceId: device.deviceId,
      deviceName: device.name,
      employeeName: device.employeeName,
      totalRules: result.length,
      overrideCount: result.filter(r => r.isOverride).length,
      rules: result,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST / PUT set or override an application rule for a specific device
router.post('/:id/application-rules', async (req, res) => {
  try {
    const { appName, executableName, action } = req.body;
    const exe = normalizeExecutable(executableName || appName);
    if (!exe) {
      return res.status(400).json({ message: 'Valid executable name is required (e.g. calc.exe)' });
    }

    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const ruleAction = action === 'allow' ? 'allow' : 'block';
    const displayAppName = appName?.trim() || exe.replace(/\.exe$/i, '');

    let devRule = await ApplicationRule.findOne({
      scope: 'device',
      scopeTarget: device.deviceId,
      $or: [
        { executableName: exe },
        { appName: displayAppName }
      ]
    });

    if (devRule) {
      devRule.action = ruleAction;
      devRule.appName = displayAppName;
      devRule.executableName = exe;
      devRule.updatedAt = new Date().toISOString();
      await devRule.save();
    } else {
      devRule = new ApplicationRule({
        id: `app-dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        appName: displayAppName,
        executableName: exe,
        action: ruleAction,
        scope: 'device',
        scopeTarget: device.deviceId,
        createdAt: new Date().toISOString(),
      });
      await devRule.save();
    }

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Application Rule Updated',
      category: 'application',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Set ${exe} -> ${ruleAction.toUpperCase()} for device ${device.name}`,
    });

    res.status(200).json({
      message: `Application ${exe} set to ${ruleAction} on ${device.name}`,
      rule: devRule,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE remove device-level application override (reverts to global policy)
router.delete('/:id/application-rules/:ruleIdOrExe', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const target = req.params.ruleIdOrExe;
    const cleanExe = normalizeExecutable(target);

    const deleted = await ApplicationRule.findOneAndDelete({
      scope: 'device',
      scopeTarget: device.deviceId,
      $or: [
        { id: target },
        { executableName: cleanExe || target.toLowerCase() },
        { appName: target }
      ],
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Device override not found for this application.' });
    }

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Application Override Reset',
      category: 'application',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Reset ${deleted.executableName || deleted.appName} override on device ${device.name} back to global policy`,
    });

    res.json({
      message: `Override for ${deleted.executableName || deleted.appName} removed. Reverted to global policy.`,
      executableName: deleted.executableName,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// Device-Level USB Storage Rules Endpoints
// ==========================================

// GET USB rule for a specific device (device override vs active global)
router.get('/:id/usb-rule', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const [globalRules, deviceRule] = await Promise.all([
      UsbRule.find({ scope: 'global' }),
      UsbRule.findOne({
        scope: 'device',
        scopeTarget: { $in: [device.deviceId, device.id, device.name] },
      }),
    ]);

    // Resolve global effective action: allow (1) < read_only (2) < block (3)
    const actionSeverity = { allow: 1, read_only: 2, block: 3 };
    let globalEffective = 'allow';
    for (const r of globalRules) {
      if (r.exception && r.expiresAt && new Date(r.expiresAt) <= new Date()) continue;
      if ((actionSeverity[r.action] || 0) > (actionSeverity[globalEffective] || 0)) {
        globalEffective = r.action;
      }
    }

    const isOverride = !!deviceRule;
    const effectiveAction = isOverride ? deviceRule.action : globalEffective;

    res.json({
      deviceId: device.deviceId,
      deviceName: device.name,
      employeeName: device.employeeName,
      isOverride,
      deviceAction: isOverride ? deviceRule.action : null,
      globalAction: globalEffective,
      effectiveAction,
      deviceRule: deviceRule || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST / PUT set or override USB rule for a specific device
router.post('/:id/usb-rule', async (req, res) => {
  try {
    const { action } = req.body;
    const cleanAction = (action || '').toLowerCase().trim();

    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    if (cleanAction === 'inherit' || !cleanAction) {
      // Revert to global
      await UsbRule.deleteMany({
        scope: 'device',
        scopeTarget: { $in: [device.deviceId, device.id, device.name] },
      });

      device.updatedAt = new Date().toISOString();
      await device.save();

      await AuditLog.create({
        id: `log-${Date.now().toString().slice(-6)}`,
        action: 'Device USB Override Reset',
        category: 'usb',
        actor: 'Admin',
        target: `${device.name} (${device.employeeName || 'Workstation'})`,
        timestamp: new Date().toISOString(),
        details: `Reset USB override on device ${device.name} back to global policy`,
      });

      return res.json({
        message: `USB override removed on ${device.name}. Reverted to global policy.`,
        action: 'inherit',
        isOverride: false,
      });
    }

    if (!['block', 'read_only', 'allow'].includes(cleanAction)) {
      return res.status(400).json({ message: 'Action must be one of: allow, read_only, block, or inherit' });
    }

    let devRule = await UsbRule.findOne({
      scope: 'device',
      scopeTarget: device.deviceId,
    });

    if (devRule) {
      devRule.action = cleanAction;
      devRule.name = `${device.name} - USB ${cleanAction.toUpperCase()} Override`;
      devRule.updatedAt = new Date().toISOString();
      await devRule.save();
    } else {
      devRule = new UsbRule({
        id: `u-dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: `${device.name} - USB ${cleanAction.toUpperCase()} Override`,
        action: cleanAction,
        scope: 'device',
        scopeTarget: device.deviceId,
        createdAt: new Date().toISOString(),
      });
      await devRule.save();
    }

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device USB Rule Updated',
      category: 'usb',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Set USB -> ${cleanAction.toUpperCase()} for device ${device.name}`,
    });

    res.json({
      message: `USB Storage set to ${cleanAction.toUpperCase()} on ${device.name}`,
      action: cleanAction,
      isOverride: true,
      rule: devRule,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE remove device-level USB override (reverts to global policy)
router.delete('/:id/usb-rule', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    await UsbRule.deleteMany({
      scope: 'device',
      scopeTarget: { $in: [device.deviceId, device.id, device.name] },
    });

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device USB Override Reset',
      category: 'usb',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Reset USB override on device ${device.name} back to global policy`,
    });

    res.json({
      message: `USB override removed. Reverted to global policy.`,
      isOverride: false,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// Device-Level Browser Rules Endpoints (5 Browsers)
// ==========================================

// GET browser rules for a specific device (device override vs active global)
router.get('/:id/browser-rule', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const [globalRules, deviceRules] = await Promise.all([
      BrowserRule.find({ scope: 'global' }),
      BrowserRule.find({
        scope: 'device',
        scopeTarget: { $in: [device.deviceId, device.id, device.name] },
      }),
    ]);

    const browsers = ['chrome', 'brave', 'firefox', 'edge', 'opera'];
    const controlTypes = ['private_browsing', 'extensions'];
    const resultRules = [];

    for (const b of browsers) {
      for (const ct of controlTypes) {
        const glob = globalRules.find(r => r.browser === b && r.controlType === ct);
        const dev = deviceRules.find(r => r.browser === b && r.controlType === ct);
        const isOverride = !!dev;
        const globalEnabled = glob ? glob.enabled : (ct === 'private_browsing');
        const effectiveEnabled = isOverride ? dev.enabled : globalEnabled;

        resultRules.push({
          browser: b,
          controlType: ct,
          name: glob?.name || `${b.toUpperCase()} ${ct}`,
          description: glob?.description || `${ct === 'private_browsing' ? 'Private browsing' : 'Extensions'} for ${b}`,
          globalEnabled,
          effectiveEnabled,
          isOverride,
          overrideRuleId: dev ? dev.id : null,
        });
      }
    }

    res.json({
      deviceId: device.deviceId,
      deviceName: device.name,
      hasOverrides: deviceRules.length > 0,
      overrideCount: deviceRules.length,
      rules: resultRules,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST set device-level browser rule override
router.post('/:id/browser-rule', async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const { browser, controlType, enabled } = req.body;
    if (!browser || !controlType) {
      return res.status(400).json({ message: 'Browser and controlType are required.' });
    }

    let devRule = await BrowserRule.findOne({
      scope: 'device',
      scopeTarget: device.deviceId,
      browser,
      controlType,
    });

    if (devRule) {
      devRule.enabled = enabled;
      devRule.updatedAt = new Date().toISOString();
      await devRule.save();
    } else {
      devRule = new BrowserRule({
        id: `b-dev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        browser,
        controlType,
        name: `${device.name} - ${browser.toUpperCase()} ${controlType}`,
        description: `Device override for ${browser} ${controlType}`,
        enabled,
        scope: 'device',
        scopeTarget: device.deviceId,
      });
      await devRule.save();
    }

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Browser Override Set',
      category: 'policy',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Set ${browser.toUpperCase()} ${controlType} = ${enabled ? 'BLOCKED' : 'ALLOWED'} for ${device.name}`,
    });

    res.json({
      message: `Browser rule ${browser} ${controlType} set to ${enabled ? 'BLOCKED' : 'ALLOWED'} on ${device.name}`,
      rule: devRule,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE remove device-level browser rule override (reverts to global policy)
const handleResetDeviceBrowserRules = async (req, res) => {
  try {
    const device = await Device.findOne({
      $or: [{ id: req.params.id }, { deviceId: req.params.id }, { name: req.params.id }]
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const { browser, controlType } = req.query;
    const filter = {
      scope: 'device',
      scopeTarget: { $in: [device.deviceId, device.id, device.name] },
    };

    if (browser) filter.browser = browser;
    if (controlType) filter.controlType = controlType;

    const result = await BrowserRule.deleteMany(filter);

    device.updatedAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Device Browser Override Reset',
      category: 'policy',
      actor: 'Admin',
      target: `${device.name} (${device.employeeName || 'Workstation'})`,
      timestamp: new Date().toISOString(),
      details: `Reverted ${result.deletedCount} browser override(s) on ${device.name} to global policy`,
    });

    res.json({
      message: `Reverted ${result.deletedCount} browser override(s) on ${device.name} to global policy`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

router.delete('/:id/browser-rule', handleResetDeviceBrowserRules);
router.delete('/:id/browser-rule/:settingOrId', handleResetDeviceBrowserRules);

// ==========================================
// WRMS Windows Agent Management Endpoints
// ==========================================

// 1. REGISTER device from WRMS Windows Agent service startup
router.post('/register', async (req, res) => {
  try {
    const deviceId = req.body.deviceId || req.body.DeviceId;
    const computerName = req.body.computerName || req.body.ComputerName;
    const employeeName = req.body.employeeName || req.body.EmployeeName;
    const windowsVersion = req.body.windowsVersion || req.body.WindowsVersion;
    const agentVersion = req.body.agentVersion || req.body.AgentVersion;

    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }

    const hostName = computerName || deviceId;
    const empName = employeeName || 'Employee';

    // Find or automatically create employee ("if already there then no need, else create automatically")
    const user = await findOrCreateEmployeeForDevice({
      employeeName: empName,
      deviceName: hostName,
      departmentId: 'd-003', // Development or default
    });

    // Extract network, security, and hardware telemetry
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace('::ffff:', '');
    const isLoopback = clientIp === '127.0.0.1' || clientIp === '::1';
    const ipAddress = req.body.ipAddress || req.body.IpAddress || (!isLoopback ? clientIp : '');
    const publicIp = req.body.publicIp || req.body.PublicIp || '';
    const macAddress = req.body.macAddress || req.body.MacAddress || '';
    const location = req.body.location || req.body.Location || null;
    const firewallStatus = req.body.firewallStatus || req.body.FirewallStatus || 'enabled';
    const firewallEnabled = req.body.firewallEnabled !== undefined
      ? req.body.firewallEnabled
      : (req.body.FirewallEnabled !== undefined ? req.body.FirewallEnabled : true);

    const rawPorts = req.body.openPorts || req.body.OpenPorts || [];
    const { ports, total, disallowed } = await evaluatePorts(rawPorts);

    // Upsert Device document
    let device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { name: hostName }]
    });

    if (!device) {
      const devCount = await Device.countDocuments();
      device = new Device({
        id: `dev-${String(devCount + 1).padStart(3, '0')}`,
        deviceId: deviceId,
        name: hostName,
        employeeId: user.id,
        employeeName: user.name,
        departmentId: user.departmentId || 'd-003',
        osVersion: windowsVersion || 'Windows 11 Pro 23H2',
        agentVersion: agentVersion || '2.4.1',
        policyId: 'p-002',
        policyName: 'Development - Standard',
        lastSync: new Date().toISOString(),
        status: 'applied',
        online: true,
        ipAddress,
        publicIp,
        macAddress,
        location,
        firewallStatus,
        firewallEnabled,
        openPorts: ports,
        openPortsCount: total,
        disallowedPortsCount: disallowed,
      });
      await device.save();

      await AuditLog.create({
        id: `log-${Date.now().toString().slice(-6)}`,
        action: 'Device Registered',
        category: 'device',
        actor: user.name || 'User',
        target: `${hostName} (${user.name || 'Workstation'})`,
        timestamp: new Date().toISOString(),
        details: `Device ${hostName} auto-registered via WRMS Windows Service startup and linked to employee ${user.name}.`,
      });
    } else {
      device.deviceId = deviceId;
      device.name = hostName;
      device.employeeId = user.id;
      device.employeeName = user.name;
      if (windowsVersion) device.osVersion = windowsVersion;
      if (agentVersion) device.agentVersion = agentVersion;
      device.online = true;
      device.lastSync = new Date().toISOString();
      device.ipAddress = ipAddress;
      if (publicIp) device.publicIp = publicIp;
      if (macAddress) device.macAddress = macAddress;
      if (location) device.location = location;
      device.firewallStatus = firewallStatus;
      device.firewallEnabled = firewallEnabled;
      device.openPorts = ports;
      device.openPortsCount = total;
      device.disallowedPortsCount = disallowed;
      await device.save();
    }

    // Process software list if provided on registration
    const softwareList = req.body.softwareList || req.body.SoftwareList;
    if (Array.isArray(softwareList) && softwareList.length > 0) {
      for (const sw of softwareList) {
        const swName = sw.name || sw.DisplayName;
        if (!swName) continue;
        await DeviceSoftware.findOneAndUpdate(
          { deviceId, name: swName },
          {
            id: `sw-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            deviceId,
            name: swName,
            executable: sw.executable || sw.Executable || '',
            publisher: sw.publisher || sw.Publisher || 'Unknown',
            version: sw.version || sw.DisplayVersion || '1.0.0',
            status: 'installed',
            lastUsed: new Date().toISOString(),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).catch(() => {});
      }
    }

    res.status(200).json({
      message: 'Device registered successfully',
      device,
      employee: user,
    });
  } catch (error) {
    console.error('[Device Register Error]', error);
    res.status(500).json({ message: error.message });
  }
});

// 1b. UNINSTALL workstation: Set status to offline and uninstalled (NEVER delete record)
router.post('/:deviceId/uninstall', async (req, res) => {
  try {
    const { deviceId } = req.params;
    let device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }],
    });

    if (!device) {
      return res.status(404).json({ message: `Device '${deviceId}' not found.` });
    }

    device.online = false;
    device.status = 'uninstalled';
    device.unenrolledAt = new Date().toISOString();
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now().toString().slice(-6)}`,
      action: 'Workstation Uninstalled',
      category: 'device',
      actor: device.employeeName || 'Installer',
      target: `${device.name} (${device.deviceId})`,
      timestamp: new Date().toISOString(),
      details: `Workstation ${device.name} uninstalled. Status changed to Offline and uninstalled. Device record preserved in fleet database.`,
    });

    res.status(200).json({
      message: 'Workstation uninstalled and marked offline. Record preserved.',
      device,
    });
  } catch (error) {
    console.error('[Device Uninstall Error]', error);
    res.status(500).json({ message: error.message });
  }
});

// 1c. GET active open ports & Master Allowed Ports comparison
router.get('/:deviceId/ports', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }],
    });

    if (!device) return res.status(404).json({ message: 'Device not found' });

    let masterPorts = await MasterPort.find({ active: true }).sort({ port: 1 }).lean().catch(() => []);
    if (!masterPorts || masterPorts.length === 0) {
      masterPorts = [
        { port: 80, protocol: 'TCP', serviceName: 'HTTP', description: 'Standard Web' },
        { port: 443, protocol: 'TCP', serviceName: 'HTTPS', description: 'Secure Web' },
        { port: 53, protocol: 'UDP', serviceName: 'DNS', description: 'Domain Resolution' },
        { port: 123, protocol: 'UDP', serviceName: 'NTP', description: 'Time Sync' },
        { port: 22, protocol: 'TCP', serviceName: 'SSH', description: 'Secure Shell' },
      ];
    }

    // Merge any blockedPorts so they are always visible in the management UI
    const mergedPorts = [...(device.openPorts || [])];
    const blockedList = device.blockedPorts || [];
    for (const bp of blockedList) {
      const pNum = Number(bp.port);
      const proto = (bp.protocol || 'TCP').toUpperCase();
      const existing = mergedPorts.find(p => p.port === pNum && (p.protocol || 'TCP').toUpperCase() === proto);
      if (existing) {
        existing.isBlocked = true;
      } else {
        mergedPorts.push({
          port: pNum,
          protocol: proto,
          processName: bp.reason || 'Blocked by Policy',
          isAllowed: false,
          isBlocked: true,
        });
      }
    }

    res.json({
      deviceId: device.deviceId,
      deviceName: device.name,
      openPorts: mergedPorts,
      openPortsCount: mergedPorts.length,
      disallowedPortsCount: device.disallowedPortsCount || 0,
      blockedPorts: device.blockedPorts || [],
      masterPorts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1c-2. POST Block Port on Device
router.post('/:deviceId/block-port', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { port, protocol, reason } = req.body;
    const portNum = Number(port);
    if (!portNum) return res.status(400).json({ message: 'Valid port number is required' });

    const device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }],
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    if (!Array.isArray(device.blockedPorts)) device.blockedPorts = [];
    const exists = device.blockedPorts.some((p) => p.port === portNum);
    if (!exists) {
      device.blockedPorts.push({
        port: portNum,
        protocol: (protocol || 'TCP').toUpperCase(),
        blockedAt: new Date().toISOString(),
        reason: reason || 'Manual Admin Block',
      });
    }

    // Re-evaluate openPorts
    let rawList = device.openPorts || [];
    if (!rawList.some((p) => p.port === portNum)) {
      rawList.push({
        port: portNum,
        protocol: (protocol || 'TCP').toUpperCase(),
        processName: 'Blocked by Policy',
        isAllowed: false,
        isBlocked: true,
      });
    }
    const { ports, total, disallowed } = await evaluatePorts(rawList, device.blockedPorts);
    device.openPorts = ports;
    device.openPortsCount = total;
    device.disallowedPortsCount = disallowed;
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Port Blocked',
      category: 'security',
      actor: 'Admin',
      target: `${device.name} (Port ${portNum})`,
      timestamp: new Date().toISOString(),
      details: `Admin blocked listening port ${portNum} on ${device.name}`,
    });

    res.json({ message: `Port ${portNum} blocked successfully`, device });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1c-3. POST Unblock Port on Device
router.post('/:deviceId/unblock-port', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { port } = req.body;
    const portNum = Number(port);
    if (!portNum) return res.status(400).json({ message: 'Valid port number is required' });

    const device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }],
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    if (Array.isArray(device.blockedPorts)) {
      device.blockedPorts = device.blockedPorts.filter((p) => p.port !== portNum);
    }

    const { ports, total, disallowed } = await evaluatePorts(device.openPorts || [], device.blockedPorts || []);
    device.openPorts = ports;
    device.openPortsCount = total;
    device.disallowedPortsCount = disallowed;
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Port Unblocked',
      category: 'security',
      actor: 'Admin',
      target: `${device.name} (Port ${portNum})`,
      timestamp: new Date().toISOString(),
      details: `Admin unblocked port ${portNum} on ${device.name}`,
    });

    res.json({ message: `Port ${portNum} unblocked successfully`, device });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1c-4. POST Toggle Windows Defender Firewall (ON / OFF)
router.post('/:deviceId/toggle-firewall', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { enabled } = req.body;
    const isEnabling = enabled === true;
    const targetState = isEnabling ? 'on' : 'off';

    const device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }],
    });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    device.targetFirewallState = targetState;
    device.firewallEnabled = isEnabling;
    device.firewallStatus = isEnabling ? 'enabled' : 'disabled';
    await device.save();

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: isEnabling ? 'Firewall Remotely Enabled' : 'Firewall Remotely Disabled',
      category: 'security',
      actor: 'Admin',
      target: `${device.name} (${device.deviceId})`,
      timestamp: new Date().toISOString(),
      details: `Admin remotely set Windows Defender Firewall to ${targetState.toUpperCase()} on workstation ${device.name}`,
    });

    res.json({
      message: `Windows Defender Firewall set to ${targetState.toUpperCase()} on ${device.name}`,
      device,
      targetFirewallState: targetState,
      firewallEnabled: isEnabling,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1d. GET software inventory for a device
router.get('/:deviceId/software', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { filter } = req.query; // 'installed', 'frequently_used', 'uninstalled', 'all'

    // Resolve target device to support querying by custom id (dev-001), computer name, or machine GUID
    const targetDev = await Device.findOne({
      $or: [{ deviceId }, { id: deviceId }, { name: deviceId }],
    });
    const resolvedDeviceId = targetDev ? targetDev.deviceId : deviceId;
    const query = { deviceId: resolvedDeviceId };

    if (filter === 'installed') query.status = 'installed';
    else if (filter === 'uninstalled') query.status = 'uninstalled';

    let list = await DeviceSoftware.find(query).sort({ executionCount: -1, name: 1 }).lean();
    if (filter === 'frequently_used') {
      list = list.filter((item) => item.status === 'installed' && (item.executionCount > 0 || item.executionCount === undefined));
    }

    // Correlate with active blocked application rules
    const blockedRules = await ApplicationRule.find({ action: 'block' }).lean();
    const blockedExes = new Set(
      blockedRules.map((r) => (r.executableName || r.appName || '').toLowerCase().trim())
    );

    const enriched = list.map((item) => {
      const cleanExe = (item.executable || `${item.name.toLowerCase().replace(/\s+/g, '')}.exe`).toLowerCase().trim();
      const isBlocked = blockedExes.has(cleanExe) || blockedExes.has(item.name.toLowerCase().trim());
      return {
        ...item,
        isBlocked,
      };
    });

    res.json({
      deviceId: resolvedDeviceId,
      total: enriched.length,
      software: enriched,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 1e. POST sync software inventory from agent
router.post('/:deviceId/software', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { softwareList } = req.body;
    if (!Array.isArray(softwareList)) {
      return res.status(400).json({ message: 'softwareList array is required' });
    }

    const currentNames = new Set();
    for (const app of softwareList) {
      const name = app.name || app.DisplayName;
      if (!name) continue;
      currentNames.add(name);

      const exe = app.executable || app.Executable || '';
      const publisher = app.publisher || app.Publisher || 'Unknown';
      const version = app.version || app.DisplayVersion || '1.0.0';
      const count = app.executionCount || app.ExecutionCount || 0;

      await DeviceSoftware.findOneAndUpdate(
        { deviceId, name },
        {
          id: `sw-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          deviceId,
          name,
          executable: exe,
          publisher,
          version,
          status: 'installed',
          $inc: { executionCount: count > 0 ? count : 0 },
          lastUsed: new Date().toISOString(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch(() => {});
    }

    // Mark missing apps as uninstalled
    if (currentNames.size > 0) {
      await DeviceSoftware.updateMany(
        { deviceId, name: { $nin: Array.from(currentNames) }, status: 'installed' },
        { status: 'uninstalled', updatedAt: new Date().toISOString() }
      ).catch(() => {});
    }

    res.json({ message: 'Software inventory synchronized', count: softwareList.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. GET dynamic policy for a specific device
router.get('/:deviceId/policy', async (req, res) => {
  try {
    const { deviceId } = req.params;

    let device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }]
    });

    if (!device) {
      // Auto-register provisional device if not yet created
      const devCount = await Device.countDocuments();
      device = new Device({
        id: `dev-${String(devCount + 1).padStart(3, '0')}`,
        deviceId: deviceId,
        name: deviceId,
        employeeName: 'Standard User',
        departmentId: 'd-003',
        osVersion: 'Windows 11',
        agentVersion: '1.0.0',
        policyId: 'p-002',
        policyName: 'Development - Standard',
        lastSync: new Date().toISOString(),
        status: 'applied',
        online: true,
      });
      await device.save();
    }

    // Query rules matching: global, device, or employee
    const regexEmpName = device.employeeName ? new RegExp(`^${device.employeeName.trim()}$`, 'i') : null;
    const regexDevId = device.deviceId ? new RegExp(`^${device.deviceId.trim()}$`, 'i') : null;
    const regexHostName = device.name ? new RegExp(`^${device.name.trim()}$`, 'i') : null;

    const queryConditions = [{ scope: 'global' }];
    if (regexDevId) queryConditions.push({ scope: 'device', scopeTarget: { $regex: regexDevId } });
    if (regexHostName) queryConditions.push({ scope: 'device', scopeTarget: { $regex: regexHostName } });
    if (regexEmpName) queryConditions.push({ scope: 'employee', scopeTarget: { $regex: regexEmpName } });
    if (device.employeeId) queryConditions.push({ scope: 'employee', scopeTarget: device.employeeId });

    const [allWebsiteRules, allAppRules, allUsbRules, allBrowserRules] = await Promise.all([
      WebsiteRule.find({ $or: queryConditions }),
      ApplicationRule.find({ $or: queryConditions }),
      UsbRule.find({ $or: queryConditions }),
      BrowserRule.find({ $or: queryConditions }),
    ]);

    // Rule Precedence: Global (1) < Employee (2) < Device (3)
    const scopePriority = {
      global: 1,
      employee: 2,
      device: 3,
    };

    const actionSeverity = {
      allow: 1,
      read_only: 2,
      block: 3,
    };

    const sortedWebRules = [...allWebsiteRules].sort((a, b) => (scopePriority[a.scope] || 0) - (scopePriority[b.scope] || 0));
    const sortedAppRules = [...allAppRules].sort((a, b) => (scopePriority[a.scope] || 0) - (scopePriority[b.scope] || 0));
    const sortedUsbRules = [...allUsbRules].sort((a, b) => {
      const scopeDiff = (scopePriority[a.scope] || 0) - (scopePriority[b.scope] || 0);
      if (scopeDiff !== 0) return scopeDiff;
      // Within same scope: allow (1) < read_only (2) < block (3), so higher severity evaluates last and wins!
      return (actionSeverity[a.action] || 0) - (actionSeverity[b.action] || 0);
    });

    // 1. Process Website Rules
    const domainActionMap = new Map();
    for (const rule of sortedWebRules) {
      const dom = normalizeDomain(rule.domain);
      if (!dom) continue;
      domainActionMap.set(dom, rule.action);
    }

    const agentWebsiteRules = [];
    for (const [dom, action] of domainActionMap.entries()) {
      if (action === 'block') {
        agentWebsiteRules.push({
          domain: dom,
          block: true,
          includeCommonSubdomains: true,
        });
      }
    }

    // 2. Process Application Rules
    const appActionMap = new Map();
    for (const rule of sortedAppRules) {
      const exe = normalizeExecutable(rule.executableName || rule.appName);
      if (!exe) continue;
      appActionMap.set(exe, {
        appName: rule.appName,
        executableName: exe,
        action: rule.action,
      });
    }

    const agentApplicationRules = [];
    for (const item of appActionMap.values()) {
      if (item.action === 'block') {
        agentApplicationRules.push({
          appName: item.appName,
          executableName: item.executableName,
          block: true,
        });
      }
    }

    // 3. Process USB Storage Control Rules
    let effectiveUsbAction = 'allow';
    for (const rule of sortedUsbRules) {
      effectiveUsbAction = rule.action;
    }

    const agentUsbRule = {
      block: effectiveUsbAction === 'block',
      readOnly: effectiveUsbAction === 'read_only',
      action: effectiveUsbAction,
    };

    // 4. Process Browser Control Rules (5 Browsers: Chrome, Brave, Firefox, Edge, Opera)
    const agentBrowserRule = {
      // Chrome
      disableChromePrivate: true,
      blockChromeExtensions: false,
      // Brave
      disableBravePrivate: true,
      blockBraveExtensions: false,
      // Firefox
      disableFirefoxPrivate: true,
      blockFirefoxExtensions: false,
      // Edge
      disableEdgePrivate: true,
      blockEdgeExtensions: false,
      // Opera
      disableOperaPrivate: true,
      blockOperaExtensions: false,
    };

    const sortedBrowserRules = [...allBrowserRules].sort((a, b) => (scopePriority[a.scope] || 0) - (scopePriority[b.scope] || 0));
    for (const rule of sortedBrowserRules) {
      const b = rule.browser;
      const ct = rule.controlType;
      const enabled = rule.enabled !== false;

      if (ct === 'private_browsing') {
        if (b === 'chrome' || b === 'all') agentBrowserRule.disableChromePrivate = enabled;
        if (b === 'brave' || b === 'all') agentBrowserRule.disableBravePrivate = enabled;
        if (b === 'firefox' || b === 'all') agentBrowserRule.disableFirefoxPrivate = enabled;
        if (b === 'edge' || b === 'all') agentBrowserRule.disableEdgePrivate = enabled;
        if (b === 'opera' || b === 'all') agentBrowserRule.disableOperaPrivate = enabled;
      } else if (ct === 'extensions') {
        if (b === 'chrome' || b === 'all') agentBrowserRule.blockChromeExtensions = enabled;
        if (b === 'brave' || b === 'all') agentBrowserRule.blockBraveExtensions = enabled;
        if (b === 'firefox' || b === 'all') agentBrowserRule.blockFirefoxExtensions = enabled;
        if (b === 'edge' || b === 'all') agentBrowserRule.blockEdgeExtensions = enabled;
        if (b === 'opera' || b === 'all') agentBrowserRule.blockOperaExtensions = enabled;
      }
    }

    // Stable deterministic version hash
    const ruleKeys = agentWebsiteRules.map(r => r.domain).sort().join(',');
    const appKeys = agentApplicationRules.map(r => r.executableName).sort().join(',');
    const browserKeys = Object.entries(agentBrowserRule).map(([k, v]) => `${k}:${v}`).join(',');
    const blockedPorts = (device.blockedPorts || []).map(p => Number(p.port));
    const portKeys = blockedPorts.sort((a, b) => a - b).join(',');
    const fwState = device.targetFirewallState || (device.firewallEnabled !== false ? 'on' : 'off');
    const fingerprint = `${ruleKeys}::${appKeys}::${effectiveUsbAction}::${browserKeys}::${portKeys}::${fwState}`;

    let hash = 5381;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = ((hash << 5) + hash) + fingerprint.charCodeAt(i);
      hash |= 0;
    }
    const policyVersion = Math.abs(hash) || 1;

    res.json({
      policyId: `pol-${device.deviceId || 'agent'}`,
      policyVersion: policyVersion,
      description: `Dynamic policy for ${device.name} (${device.employeeName || 'Global'})`,
      createdAt: new Date().toISOString(),
      websiteRules: agentWebsiteRules,
      applicationRules: agentApplicationRules,
      usbRule: agentUsbRule,
      browserRule: agentBrowserRule,
      blockedPorts: blockedPorts,
      enforceFirewallEnabled: fwState === 'on',
    });
  } catch (error) {
    console.error('[Device Get Policy Error]', error);
    res.status(500).json({ message: error.message });
  }
});

// 3. POST policy execution status report from agent
router.post('/:deviceId/policy-status', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const success = req.body.success !== undefined ? req.body.success : req.body.Success;
    const status = req.body.status || req.body.Status;
    const policyId = req.body.policyId || req.body.PolicyId;
    const policyVersion = req.body.policyVersion || req.body.PolicyVersion;
    const rules = req.body.rules || req.body.Rules || [];
    const errors = req.body.errors || req.body.Errors || [];
    const appliedAt = req.body.appliedAt || req.body.AppliedAt || new Date().toISOString();

    const device = await Device.findOne({
      $or: [{ deviceId: deviceId }, { id: deviceId }, { name: deviceId }]
    });

    if (!device) {
      return res.status(404).json({ message: `Device '${deviceId}' not found.` });
    }

    const isApplied = success === true || status === 'Success' || status === 'NoChange';
    const isPartial = status === 'PartialSuccess';
    const newStatus = isApplied ? 'applied' : (isPartial ? 'partial' : 'failed');
    const prevStatus = device.status;
    const prevPolicyId = device.policyId;

    device.status = newStatus;
    device.lastSync = appliedAt;
    device.online = true;
    if (policyId) device.policyId = policyId;
    if (req.body.ipAddress || req.body.IpAddress) device.ipAddress = req.body.ipAddress || req.body.IpAddress;
    if (req.body.macAddress || req.body.MacAddress) device.macAddress = req.body.macAddress || req.body.MacAddress;
    if (req.body.firewallStatus || req.body.FirewallStatus) device.firewallStatus = req.body.firewallStatus || req.body.FirewallStatus;
    if (req.body.firewallEnabled !== undefined) device.firewallEnabled = req.body.firewallEnabled;
    if (req.body.FirewallEnabled !== undefined) device.firewallEnabled = req.body.FirewallEnabled;
    if (req.body.openPorts || req.body.OpenPorts) {
      const { ports, total, disallowed } = await evaluatePorts(req.body.openPorts || req.body.OpenPorts, device.blockedPorts || []);
      device.openPorts = ports;
      device.openPortsCount = total;
      device.disallowedPortsCount = disallowed;
    }
    await device.save();

    // Only record audit log if status or policy version changed or error occurred (prevents 60s duplicate spam)
    const statusChanged = prevStatus !== newStatus;
    const policyChanged = policyId && prevPolicyId !== policyId;
    if (statusChanged || policyChanged || errors.length > 0) {
      await AuditLog.create({
        id: `log-${Date.now().toString().slice(-6)}`,
        action: 'Device Policy Enforced',
        category: 'device',
        actor: `Agent · ${device.name}`,
        target: `${device.name} (${device.employeeName || 'Workstation'})`,
        timestamp: new Date().toISOString(),
        details: `Policy ${policyChanged ? 'updated' : 'enforced'}. Status: ${device.status}.${errors.length > 0 ? ' Errors: ' + errors.join('; ') : ''}`,
      });
    }

    res.json({ message: 'Policy status acknowledged', deviceId: device.deviceId });
  } catch (error) {
    console.error('[Device Policy Status Error]', error);
    res.status(500).json({ message: error.message });
  }
});

// CREATE device
router.post('/', async (req, res) => {
  try {
    const { id, deviceId, name, employeeId, employeeName, employeeEmail, osVersion, agentVersion, policyId, policyName, online } = req.body;
    
    // Automatically find or create employee ("if already there then no need, else create automatically")
    const user = await findOrCreateEmployeeForDevice({
      employeeId,
      employeeName,
      employeeEmail,
      deviceName: name,
    });

    const devId = id || `dev-${Date.now()}`;
    const newDevice = new Device({
      id: devId,
      deviceId: deviceId || `WIN-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      name,
      employeeId: user.id,
      employeeName: user.name,
      osVersion: osVersion || 'Windows 11 Pro 23H2',
      agentVersion: agentVersion || '2.4.1',
      policyId,
      policyName,
      lastSync: new Date().toISOString(),
      status: 'applied',
      online: online !== undefined ? online : true,
    });
    const saved = await newDevice.save();

    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Device Registered',
      category: 'device',
      actor: 'Admin',
      target: `${saved.name} (${saved.deviceId})`,
      timestamp: new Date().toISOString(),
      details: `Device registered and linked to employee ${user.name} (${user.email}).`,
    });

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// UPDATE device
router.put('/:id', async (req, res) => {
  try {
    const updated = await Device.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Device not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// SYNC device
router.post('/:id/sync', async (req, res) => {
  try {
    const updated = await Device.findOneAndUpdate(
      { id: req.params.id },
      { $set: { lastSync: new Date().toISOString(), status: 'applied' } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Device not found' });

    // Record audit log
    await AuditLog.create({
      id: `log-${Date.now()}`,
      action: 'Device Policy Applied',
      category: 'device',
      actor: `Agent ${updated.deviceId}`,
      target: updated.name,
      timestamp: new Date().toISOString(),
      details: `Policy ${updated.policyName || 'Standard'} synchronized successfully`,
    });

    res.json({ message: 'Device synced successfully', device: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE device (matches by id, deviceId, or machine name)
router.delete('/:id', async (req, res) => {
  try {
    const target = req.params.id;
    const deleted = await Device.findOneAndDelete({
      $or: [
        { id: target },
        { deviceId: target },
        { name: target },
        { name: new RegExp(`^${target}$`, 'i') },
      ],
    });
    if (!deleted) return res.status(404).json({ message: 'Device not found' });

    // Clean up any device-specific rules & audit
    await Promise.all([
      WebsiteRule.deleteMany({ scope: 'device', scopeTarget: { $in: [deleted.deviceId, deleted.id, deleted.name] } }).catch(() => {}),
      ApplicationRule.deleteMany({ scope: 'device', scopeTarget: { $in: [deleted.deviceId, deleted.id, deleted.name] } }).catch(() => {}),
      UsbRule.deleteMany({ scope: 'device', scopeTarget: { $in: [deleted.deviceId, deleted.id, deleted.name] } }).catch(() => {}),
      BrowserRule.deleteMany({ scope: 'device', scopeTarget: { $in: [deleted.deviceId, deleted.id, deleted.name] } }).catch(() => {}),
      AuditLog.create({
        id: `log-${Date.now().toString().slice(-6)}`,
        action: 'device_deleted',
        category: 'device',
        target: deleted.name,
        actor: 'WRMS Uninstaller',
        timestamp: new Date().toISOString(),
        details: `Workstation ${deleted.name} (${deleted.deviceId}) uninstalled and permanently removed from fleet database`,
      }).catch(() => {}),
    ]);

    res.json({ message: 'Device deleted successfully', device: deleted });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
