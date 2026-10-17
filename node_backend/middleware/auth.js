const crypto = require('crypto');
const supabase = require('../config/supabase');

const INTERNAL_WORKER_SECRET = process.env.INTERNAL_WORKER_SECRET;
const VIEWER_SECRET = process.env.VIEWER_SECRET; // shipped in the frontend bundle: read-only by design
const USER_CACHE_TTL_MS = 60 * 1000;
const _userCache = new Map(); // token -> { user, expires }

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
 * Verifies a Supabase session token with Supabase Auth (works for both legacy HS256
 * and asymmetric signing keys). Results are cached briefly so UI polling stays cheap.
 */
async function verifySupabaseToken(token) {
  const now = Date.now();
  const hit = _userCache.get(token);
  if (hit && hit.expires > now) return hit.user;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  if (_userCache.size > 1000) _userCache.clear();
  _userCache.set(token, { user: data.user, expires: now + USER_CACHE_TTL_MS });
  return data.user;
}

/**
 * Zero-Trust Authentication Middleware.
 * Validates either:
 *   1. Internal worker service secret (admin: python worker, loopback calls, the admin's browser)
 *   2. Viewer secret (the public frontend bundle / LeadSquared embed): GET requests only
 *   3. Supabase session token (logged-in users)
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7).trim();

  if (INTERNAL_WORKER_SECRET && timingSafeCompare(token, INTERNAL_WORKER_SECRET)) {
    req.user = {
      id: 'internal_worker',
      email: 'worker@internal.local',
      app_metadata: { role: 'ai_worker' }
    };
    return next();
  }

  if (VIEWER_SECRET && timingSafeCompare(token, VIEWER_SECRET)) {
    if (req.method !== 'GET') {
      return res.status(403).json({ error: 'Read-only access: this action needs the admin key' });
    }
    req.user = { id: 'viewer', app_metadata: { role: 'viewer' } };
    return next();
  }

  try {
    const user = await verifySupabaseToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token verification failed' });
  }
}

/**
 * Middleware factory for Role-Based Access Control (RBAC).
 * Role comes from app_metadata.role, which only the service role can set.
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.app_metadata?.role || 'user';
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: `Forbidden: requires one of [${allowedRoles.join(', ')}]` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
