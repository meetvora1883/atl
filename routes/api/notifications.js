const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c;
  res.json({ items, unread });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
