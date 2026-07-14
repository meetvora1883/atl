/**
 * utils/security-logger.js
 *
 * Simple security event logger – logs to console and optionally to a file.
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'security.log');

// Ensure log directory exists
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function logSecurityEvent(event, req, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ip: req?.ip || 'unknown',
    path: req?.originalUrl || 'unknown',
    method: req?.method || 'unknown',
    user: req?.user?.id || 'anonymous',
    ...extra,
  };

  // Console
  console.log(`[SECURITY] ${event}`, JSON.stringify(entry));

  // File (append)
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (_) {
    // silent fail
  }
}

module.exports = { logSecurityEvent };