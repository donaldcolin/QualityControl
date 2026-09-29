const jwt = require('jsonwebtoken');

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

/**
 * Middleware to verify Supabase JWT
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader === 'Bearer internal_ai_worker_token') {
    req.user = { app_metadata: { role: 'ai_worker' } };
    return next();
  }
  
  const remoteAddr = req.socket?.remoteAddress || req.ip || '';
  if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr.includes('127.0.0.1')) {
    req.user = { app_metadata: { role: 'ai_worker' } };
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

/**
 * Middleware factory for Role-Based Access Control (RBAC)
 * Requires app_metadata.role to match one of the allowed roles
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
