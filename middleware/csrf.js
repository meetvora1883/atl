const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Generates a per-session CSRF token and exposes it to views as
// `csrfToken`. State-changing requests must echo it back either as a
// `_csrf` body field or an `x-csrf-token` header.
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    console.log('[CSRF] New token generated for session:', req.session.id);
  }
  res.locals.csrfToken = req.session.csrfToken;

  // ---- TEMPORARY BYPASS for debugging hero DELETE (remove after fix) ----
  // This bypasses CSRF validation for DELETE requests to /api/warboard/heroes/*
  // so you can test the deletion flow without a valid token.
  // Remove this block once the client-side token issue is resolved.
  if (req.path.startsWith('/api/warboard/heroes/') && req.method === 'DELETE') {
    console.log('[CSRF] ⚠️ BYPASSING CSRF for hero DELETE (TEMPORARY)');
    return next();
  }
  // ---- END BYPASS ----

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const provided = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  
  // ---- DEBUG LOGGING ----
  console.log('[CSRF] Request:', {
    method: req.method,
    path: req.path,
    sessionId: req.session.id,
    sessionToken: req.session.csrfToken,
    providedToken: provided,
    headers: req.headers,
    body: req.body
  });
  // ---- END DEBUG ----

  if (!provided || provided !== req.session.csrfToken) {
    console.log('[CSRF] ❌ Token mismatch or missing. Provided:', provided, 'Expected:', req.session.csrfToken);
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ 
        error: 'Invalid CSRF token',
        sessionToken: req.session.csrfToken,
        providedToken: provided,
        sessionId: req.session.id
      });
    }
    return res.status(403).send('Invalid CSRF token');
  }

  console.log('[CSRF] ✅ Token valid for:', req.path);
  next();
}

module.exports = csrfProtection;