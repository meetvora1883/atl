/**
 * routes/security.js
 *
 * Security-related routes:
 *   - Public notice page (uses your existing layout)
 *   - Admin event viewer (owner only)
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { logSecurityEvent } = require('../utils/security-logger');
const { getGlobalSettings } = require('../db');

const router = express.Router();

// 1. Public security notice page
router.get('/security-notice', (req, res) => {
  // Ensure globalSettings is available for the layout
  const globalSettings = getGlobalSettings() || {};
  res.locals.globalSettings = globalSettings;
  
  res.render('security-notice', {
    title: 'Security Notice',
    user: req.user || null,
    csrfToken: res.locals.csrfToken || '',
    active: '',
    globalSettings: globalSettings, // pass explicitly as local
  });
});

// 2. Admin event viewer (owner only)
router.get(
  '/api/security/events',
  requireAuth,
  requirePermission('owner_panel'),
  (req, res) => {
    // For now, return a simple placeholder.
    // Later we can read from a log file or database.
    res.json({
      events: [
        { event: 'security_headers_applied', timestamp: new Date().toISOString() },
        { event: 'rate_limit_configured', timestamp: new Date().toISOString() },
      ]
    });
  }
);







// ... after the notice page route

// 2. Client heuristic report (public, rate-limited)
const rateLimit = require('express-rate-limit');
const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const ALLOWED_REASONS = new Set([
  'window_size_delta',
  'debugger_timing',
  'console_detection',
  'frequent_resize',
  'keyboard_shortcut',
  'context_menu',
]);

router.post(
  '/api/security/report-devtools-heuristic',
  reportLimiter,
  (req, res) => {
    const reason = ALLOWED_REASONS.has(req.body?.reason) ? req.body.reason : 'unknown';
    // Log it (optional)
    console.log('[Security] DevTools heuristic reported:', reason, 'IP:', req.ip);
    res.status(204).end();
  }
);

module.exports = router;