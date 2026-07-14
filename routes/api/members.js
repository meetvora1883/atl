const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 30;
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) AS c FROM members').get().c;
  const items = db.prepare(`
    SELECT * FROM members ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const items = db.prepare(`
    SELECT * FROM members WHERE username LIKE ? ORDER BY created_at DESC LIMIT 50
  `).all(`%${q}%`);
  res.json({ items });
});

router.get('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const notes = db.prepare('SELECT * FROM member_notes WHERE member_id = ? ORDER BY created_at DESC').all(member.id);
  const warnings = db.prepare('SELECT * FROM warnings WHERE member_id = ? ORDER BY created_at DESC').all(member.id);
  const bans = db.prepare('SELECT * FROM bans WHERE member_id = ? AND active = 1 ORDER BY created_at DESC').all(member.id);
  res.json({ member, notes, warnings, bans });
});

router.post('/:id/notes', (req, res) => {
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: 'note is required' });
  db.prepare('INSERT INTO member_notes (member_id, author_id, note) VALUES (?, ?, ?)').run(
    req.params.id, req.user.id, note
  );
  db.prepare('UPDATE members SET notes_count = notes_count + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/warn', (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  db.prepare('INSERT INTO warnings (member_id, moderator_id, reason) VALUES (?, ?, ?)').run(
    req.params.id, req.user.id, reason
  );
  res.json({ ok: true });
});

router.post('/:id/ban', (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  db.prepare('INSERT INTO bans (member_id, moderator_id, reason, active) VALUES (?, ?, ?, 1)').run(
    req.params.id, req.user.id, reason
  );
  res.json({ ok: true });
});

router.post('/:id/timeout', (req, res) => {
  const { reason, minutes } = req.body;
  if (!reason || !minutes) return res.status(400).json({ error: 'reason and minutes required' });
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO timeouts (member_id, moderator_id, reason, expires_at) VALUES (?, ?, ?, ?)').run(
    req.params.id, req.user.id, reason, expiresAt
  );
  res.json({ ok: true });
});

module.exports = router;
