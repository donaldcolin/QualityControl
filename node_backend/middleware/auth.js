const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const INTERNAL_WORKER_SECRET = process.env.INTERNAL_WORKER_SECRET;
const isProd = process.env.NODE_ENV === 'production';

/**
 * Constant-time comparison between two string secrets to prevent timing attacks.
 */
function timingSafeCompare(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Zero-Trust Authentication Middleware.
 * Validates either:
 *   1. Internal worker service secret (for python worker, microservices, internal orchestration)
 *   2. Supabase Bearer JWT token (for authenticated user sessions)
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7).trim();

  // 1. Check against Internal Worker Secret strictly from environment
  const isWorkerToken = Boolean(
    INTERNAL_WORKER_SECRET && timingSafeCompare(token, INTERNAL_WORKER_SECRET)
  );

  if (isWorkerToken) {
    req.user = {
      id: 'internal_worker',
      email: 'worker@internal.local',
      app_metadata: { role: 'ai_worker' }
    };
    return next();
  }

  // 2. Validate Supabase JWT for user sessions
  try {
    if (SUPABASE_JWT_SECRET) {
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
      req.user = decoded;
      return next();
    } else {
      if (isProd) {
        return res.status(401).json({ error: 'Production authentication failed: SUPABASE_JWT_SECRET must be configured' });
      }
      // Development-only fallback: decode claims when SUPABASE_JWT_SECRET is not yet provisioned
      const decoded = jwt.decode(token);
      if (decoded && typeof decoded === 'object') {
        req.user = decoded;
        return next();
      }
      return res.status(401).json({ error: 'Invalid token structure' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

/**
 * Middleware factory for Role-Based Access Control (RBAC).
 * Enforces that req.user has an allowed role.
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'user';
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: `Forbidden: requires one of [${allowedRoles.join(', ')}]` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
