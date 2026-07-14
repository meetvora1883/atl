/**
 * middleware/rate-limit.js
 *
 * Two layers:
 *  1. Standard rate limiting (express-rate-limit) for all API traffic.
 *  2. A lightweight "suspicion score" tracker: server-side signals bump a
 *     per-IP score. Once it crosses a threshold, that IP gets temporarily
 *     blocked.
 */
const rateLimit = require('express-rate-limit');
const { logSecurityEvent } = require('../utils/security-logger');

// ---------- Layer 1: standard rate limiting ----------
function apiRateLimiter({ windowMs = 60 * 1000, max = 120 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logSecurityEvent('rate_limit_exceeded', req, { path: req.originalUrl });
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
    },
  });
}

function authRateLimiter({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logSecurityEvent('auth_rate_limit_exceeded', req, { path: req.originalUrl });
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
    },
  });
}

// ---------- Layer 2: suspicion scoring + temporary block ----------
const suspicionStore = new Map();
const DEFAULT_THRESHOLD = 10;
const DEFAULT_BLOCK_MS = 15 * 60 * 1000;
const DECAY_MS = 10 * 60 * 1000;

function getClientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function flagSuspicious(req, weight = 1, reason = 'unspecified') {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = suspicionStore.get(ip) || { score: 0, blockedUntil: 0, lastSeen: now };

  if (now - entry.lastSeen > DECAY_MS) {
    entry.score = 0;
  }
  entry.score += weight;
  entry.lastSeen = now;

  if (entry.score >= DEFAULT_THRESHOLD && now > entry.blockedUntil) {
    entry.blockedUntil = now + DEFAULT_BLOCK_MS;
    logSecurityEvent('client_temporarily_blocked', req, { reason, score: entry.score });
  }

  suspicionStore.set(ip, entry);
  logSecurityEvent('suspicion_flagged', req, { reason, weight, score: entry.score });
}

function blockIfFlagged(req, res, next) {
  const ip = getClientIp(req);
  const entry = suspicionStore.get(ip);
  if (entry && entry.blockedUntil > Date.now()) {
    const retryAfterSec = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'Temporarily blocked due to suspicious activity',
      retryAfterSeconds: retryAfterSec,
    });
  }
  next();
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of suspicionStore.entries()) {
    if (entry.blockedUntil < now && now - entry.lastSeen > DECAY_MS) {
      suspicionStore.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  apiRateLimiter,
  authRateLimiter,
  blockIfFlagged,
  flagSuspicious,
};