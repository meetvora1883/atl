const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { requireRole } = require('../../middleware/roles');

router.use(requireRole('owner'));

// ---- Guild logs (read-only from the dashboard's perspective; the bot writes these) ----
router.get('/logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM guild_logs ORDER BY created_at DESC LIMIT 100').all());
});

// ---- Announcements ----
router.get('/announcements', (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all());
});

router.post('/announcements', (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  const info = db
    .prepare('INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)')
    .run(title, body, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Events ----
router.get('/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY event_date DESC').all());
});

router.post('/events', (req, res) => {
  const { name, description, event_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO events (name, description, event_date, created_by) VALUES (?, ?, ?, ?)')
    .run(name, description || null, event_date || null, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/events/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Analytics ----
router.get('/analytics', (req, res) => {
  res.json({
    totalUsers: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    activeSessions: db
      .prepare(`SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > datetime('now')`)
      .get().c,
    signupsLast7Days: db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE created_at > datetime('now', '-7 days')`)
      .get().c,
  });
});

module.exports = router;
