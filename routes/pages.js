const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/roles');
const { db, listUsers, listActiveSessions, listAllActiveSessions } = require('../db');

const DOMAIN = process.env.DOMAIN || 'http://localhost:6297';

// Safe query wrappers with logging
function safeQuery(stmt, ...params) {
  try {
    return stmt.all(...params);
  } catch (err) {
    console.error('[DB] Query failed:', stmt.source, 'Params:', params, 'Error:', err.message);
    throw err;
  }
}
function safeGet(stmt, ...params) {
  try {
    return stmt.get(...params);
  } catch (err) {
    console.error('[DB] Query failed:', stmt.source, 'Params:', params, 'Error:', err.message);
    throw err;
  }
}

// ---- Public splash ----
router.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('splash', { domain: DOMAIN, loginFailed: req.query.login === 'failed', sessionExpired: req.query.sessionExpired === '1' });
});

// ---- Dashboard (requires view_dashboard permission) ----
router.get('/dashboard', requireAuth, requirePermission('view_dashboard'), (req, res) => {
  try {
    const stats = {
      totalUsers: safeGet(db.prepare('SELECT COUNT(*) AS c FROM users')).c,
      activeSessions: safeGet(db.prepare(`
        SELECT COUNT(*) AS c FROM sessions
        WHERE revoked_at IS NULL AND expires_at > datetime('now')
      `)).c,
      announcements: safeGet(db.prepare('SELECT COUNT(*) AS c FROM announcements')).c,
      events: safeGet(db.prepare('SELECT COUNT(*) AS c FROM events')).c,
    };
    const announcements = safeQuery(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5'));
    const notifications = safeQuery(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'), req.user.id);
    res.render('dashboard', { domain: DOMAIN, stats, announcements, notifications, active: 'dashboard' });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard', user: req.user });
  }
});

// ---- Members (requires manage_users) ----
router.get('/members', requireAuth, requirePermission('manage_users'), (req, res) => {
  try {
    const members = safeQuery(db.prepare('SELECT * FROM members ORDER BY created_at DESC LIMIT 50'));
    res.render('members', { domain: DOMAIN, members, active: 'members' });
  } catch (err) {
    console.error('Members error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load members', user: req.user });
  }
});

// ---- Analytics (requires view_analytics) ----
router.get('/analytics', requireAuth, requirePermission('view_analytics'), (req, res) => {
  res.render('analytics', { domain: DOMAIN, active: 'analytics' });
});

// ---- Bot Manager (requires manage_bot) ----
router.get('/bot', requireAuth, requirePermission('manage_bot'), (req, res) => {
  try {
    const botSettings = safeGet(db.prepare('SELECT * FROM bot_settings WHERE id = 1'));
    res.render('bot', { domain: DOMAIN, botSettings, active: 'bot' });
  } catch (err) {
    console.error('Bot error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load bot settings', user: req.user });
  }
});

// ---- Moderation (requires moderate_members) ----
router.get('/moderation', requireAuth, requirePermission('moderate_members'), (req, res) => {
  try {
    const bans = safeQuery(db.prepare(`
      SELECT b.*, m.username FROM bans b
      JOIN members m ON m.id = b.member_id
      WHERE b.active = 1
      ORDER BY b.created_at DESC LIMIT 50
    `));
    const timeouts = safeQuery(db.prepare(`
      SELECT t.*, m.username FROM timeouts t
      JOIN members m ON m.id = t.member_id
      WHERE t.expires_at > datetime('now')
      ORDER BY t.created_at DESC LIMIT 50
    `));
    res.render('moderation', { domain: DOMAIN, bans, timeouts, active: 'moderation' });
  } catch (err) {
    console.error('Moderation error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load moderation data', user: req.user });
  }
});

// ---- Events (requires manage_events) ----
router.get('/events', requireAuth, requirePermission('manage_events'), (req, res) => {
  try {
    const events = safeQuery(db.prepare('SELECT * FROM events ORDER BY event_date DESC'));
    res.render('events', { domain: DOMAIN, events, active: 'events' });
  } catch (err) {
    console.error('Events error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load events', user: req.user });
  }
});

// ---- Profile (always visible to logged-in users) ----
router.get('/profile', requireAuth, (req, res) => {
  res.render('profile', { domain: DOMAIN, active: 'profile' });
});

// ---- Settings (always visible) ----
router.get('/settings', requireAuth, (req, res) => {
  try {
    const settings = safeGet(db.prepare('SELECT * FROM settings WHERE user_id = ?'), req.user.id);
    res.render('settings', { domain: DOMAIN, settings, active: 'settings' });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load settings', user: req.user });
  }
});

// ---- Sessions (always visible) ----
router.get('/sessions', requireAuth, (req, res) => {
  try {
    const sessions = listActiveSessions.all(req.user.id);
    res.render('sessions', { domain: DOMAIN, sessions, currentSessionId: req.cookies.session_id, active: 'sessions' });
  } catch (err) {
    console.error('Sessions error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load sessions', user: req.user });
  }
});

// ---- Owner Panel (requires owner_panel permission) ----
router.get('/owner', requireAuth, requirePermission('owner_panel'), (req, res) => {
  try {
    const allUsers = listUsers();
    const allSessions = listAllActiveSessions.all();
    const logs = safeQuery(db.prepare('SELECT * FROM owner_logs ORDER BY created_at DESC LIMIT 50'));
    const announcements = safeQuery(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC'));
    const events = safeQuery(db.prepare('SELECT * FROM events ORDER BY event_date DESC'));
    res.render('owner', { domain: DOMAIN, allUsers, allSessions, logs, announcements, events, active: 'owner' });
  } catch (err) {
    console.error('Owner error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load owner panel', user: req.user });
  }
});

// ---- Roles (requires manage_roles) ----
router.get('/roles', requireAuth, requirePermission('manage_roles'), (req, res) => {
  res.render('roles/index', { domain: DOMAIN, active: 'roles', user: req.user, csrfToken: res.locals.csrfToken });
});

// ---- User Management List (requires manage_users) ----
router.get('/users', requireAuth, requirePermission('manage_users'), (req, res) => {
  res.render('users', { domain: DOMAIN, active: 'users', user: req.user, csrfToken: res.locals.csrfToken });
});

// ---- User Detail (requires manage_users) ----
router.get('/user-detail', requireAuth, requirePermission('manage_users'), (req, res) => {
  res.render('user-detail', { domain: DOMAIN, active: 'users', user: req.user, csrfToken: res.locals.csrfToken });
});

// ---- Console (requires console_access) ----
router.get('/console', requireAuth, requirePermission('console_access'), (req, res) => {
  res.render('console', { domain: DOMAIN, active: 'console', user: req.user, csrfToken: res.locals.csrfToken });
});

// ---- Language Manager (requires manage_translations) ----
router.get('/languages', requireAuth, requirePermission('manage_translations'), (req, res) => {
  res.render('languages/index', { domain: DOMAIN, active: 'languages', user: req.user, csrfToken: res.locals.csrfToken });
});



// Warboard (requires view_warboard)
router.get('/warboard', requireAuth, requirePermission('view_warboard'), (req, res) => {
  res.render('warboard', { domain: DOMAIN, active: 'warboard', user: req.user, csrfToken: res.locals.csrfToken });
});

// Flag Calls
router.get('/flag-calls', requireAuth, requirePermission('view_flag_calls'), (req, res) => {
  res.render('flag_calls', {
    domain: process.env.DOMAIN || 'http://localhost:6297',
    user: req.user,
    csrfToken: res.locals.csrfToken,
    active: 'flag_calls'
  });
});



// Warboard Logs – requires view_warboard permission
// Warboard Logs – requires view_warboard permission
router.get('/warboard/logs', requireAuth, requirePermission('view_warboard'), (req, res) => {
  res.render('warboard/warboard_logs', {
    domain: process.env.DOMAIN || 'http://localhost:6297',
    user: req.user,
    csrfToken: res.locals.csrfToken,
    active: 'warboard'
  });
});

module.exports = router;