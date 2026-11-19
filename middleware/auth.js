import { verifyToken } from '../utils/authUtils.js';

/**
 * Middleware: Verify Bearer Token and attach user to req.user
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required. Please sign in to access this resource.',
    });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      message: 'Session expired or invalid token. Please sign in again.',
    });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware: Require one of specified roles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Access denied. You do not have permission to perform this action.',
      });
    }
    next();
  };
}

/**
 * Middleware: Allow only Super Admin or Admin
 */
export const requireAdmin = requireRole('super_admin', 'admin');

/**
 * Middleware: Allow only Super Admin
 */
export const requireSuperAdmin = requireRole('super_admin');
