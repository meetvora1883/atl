const express = require('express');
const passport = require('passport');
const { UAParser } = require('ua-parser-js');
const router = express.Router();

const { signAccessToken, generateRefreshToken, hashToken, verifyAccessToken } = require('../utils/tokens');
const {
  createSession,
  getSessionByRawToken,
  rotateSession,
  revokeSession,
  getUserById,
  recordFailedLogin,
  auditLog,
  consoleLog,
} = require('../db');

const COOKIE_BASE = {
  httpOnly: true,
  secure: false, // Do not force HTTPS — see README for why.
  sameSite: 'lax',
};

function deviceInfoFrom(req) {
  const parser = new UAParser(req.headers['user-agent'] || '');
  const result = parser.getResult();
  return {
    device_type: result.device.type || 'desktop',
    browser: [result.browser.name, result.browser.version].filter(Boolean).join(' ') || 'Unknown browser',
    os: [result.os.name, result.os.version].filter(Boolean).join(' ') || 'Unknown OS',
    user_agent: req.headers['user-agent'] || null,
    ip_address: req.ip,
  };
}

function setAuthCookies(res, user, req, remember) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();
  const info = createSession.run({
    user_id: user.id,
    refresh_token_hash: hash,
    ...deviceInfoFrom(req),
    country: null,
    remember: remember ? 1 : 0,
    expires_at: expiresAt,
  });

  const refreshMaxAge = remember ? 90 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', raw, { ...COOKIE_BASE, maxAge: refreshMaxAge });
  res.cookie('session_id', String(info.lastInsertRowid), { ...COOKIE_BASE, maxAge: refreshMaxAge });
}

// GET /auth/discord — kick off Discord OAuth. ?remember=1 to persist longer.
router.get('/discord', (req, res, next) => {
  res.cookie('remember_pref', req.query.remember === '1' ? '1' : '0', { ...COOKIE_BASE, maxAge: 10 * 60 * 1000 });
  passport.authenticate('discord', { session: false })(req, res, next);
});

// GET /auth/discord/callback
router.get(
  '/discord/callback',
  (req, res, next) => {
    // Log the query to see what Discord sent
    console.log('[Discord callback] Query:', req.query);

    // If the `code` parameter is missing, redirect with error
    if (!req.query.code) {
      const error = req.query.error || 'missing_code';
      console.error('[Discord OAuth] Missing code. Query:', req.query);
      recordFailedLogin.run(null, `oauth_${error}`, req.ip);
      return res.redirect('/?login=failed&reason=' + encodeURIComponent(error));
    }

    passport.authenticate('discord', { session: false }, (err, user) => {
      if (err || !user) {
        const reason = err ? (err.message || String(err)) : 'oauth_denied';
        console.error('[Discord OAuth failure]', reason);
        // Log the full error if available
        if (err) console.error(err);
        recordFailedLogin.run(null, reason, req.ip);
        consoleLog('auth', 'Discord OAuth login failed', { ip: req.ip, reason });
        return res.redirect('/?login=failed');
      }
      req.user = user;
      next();
    })(req, res, next);
  },
  (req, res) => {
    const remember = req.cookies.remember_pref === '1';
    setAuthCookies(res, req.user, req, remember);
    res.clearCookie('remember_pref', COOKIE_BASE);
    auditLog(req.user.id, 'login', 'user', req.user.id, { via: 'discord' }, req.ip);
    consoleLog('auth', `${req.user.username} logged in`, { userId: req.user.id, ip: req.ip });
    res.redirect('/dashboard');
  }
);

// POST /auth/refresh — rotate refresh token, issue new access token.
// Tolerates a short grace window on the previous token to avoid false
// "invalid token" errors when multiple requests race after expiry
// (e.g. a batch of API calls firing right as a device rotates/resizes).
router.post('/refresh', (req, res) => {
  const rawToken = req.cookies.refresh_token;
  const sessionId = req.cookies.session_id;
  if (!rawToken || !sessionId) return res.status(401).json({ error: 'Missing refresh token', code: 'NO_TOKEN' });

  const hash = hashToken(rawToken);
  const { session } = getSessionByRawToken(hash);
  if (!session || String(session.id) !== String(sessionId)) {
    return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_TOKEN' });
  }
  if (new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token expired', code: 'EXPIRED' });
  }

  const user = getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found', code: 'NO_USER' });

  const { raw, hash: newHash, expiresAt } = generateRefreshToken();
  rotateSession.run(newHash, expiresAt, session.id);

  const accessToken = signAccessToken(user);
  const maxAge = session.remember ? 90 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', raw, { ...COOKIE_BASE, maxAge });

  res.json({ ok: true });
});

// POST /auth/logout — revoke current session and clear cookies
router.post('/logout', (req, res) => {
  const sessionId = req.cookies.session_id;
  const token = req.cookies.access_token;
  const { payload } = token ? verifyAccessToken(token) : { payload: null };

  if (sessionId && payload) {
    revokeSession.run(sessionId, payload.sub);
    auditLog(payload.sub, 'logout', 'session', sessionId, null, req.ip);
  }

  res.clearCookie('access_token', COOKIE_BASE);
  res.clearCookie('refresh_token', COOKIE_BASE);
  res.clearCookie('session_id', COOKIE_BASE);
  res.redirect('/');
});

module.exports = router;