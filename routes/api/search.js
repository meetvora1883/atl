const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  if (!req.query.q || !req.query.q.trim()) return res.json({ results: [] });

  const users = db.prepare('SELECT id, username FROM users WHERE username LIKE ? LIMIT 5').all(q);
  const events = db.prepare('SELECT id, name FROM events WHERE name LIKE ? LIMIT 5').all(q);
  const roles = db.prepare('SELECT id, name FROM roles WHERE name LIKE ? LIMIT 5').all(q);
  const announcements = db.prepare('SELECT id, title FROM announcements WHERE title LIKE ? LIMIT 5').all(q);

  const results = [
    ...users.map((u) => ({ label: u.username, sub: 'User', icon: 'bi-person', href: `/users?highlight=${u.id}` })),
    ...events.map((e) => ({ label: e.name, sub: 'Event', icon: 'bi-calendar-event', href: '/events' })),
    ...roles.map((r) => ({ label: r.name, sub: 'Role', icon: 'bi-shield', href: '/roles' })),
    ...announcements.map((a) => ({ label: a.title, sub: 'Announcement', icon: 'bi-megaphone', href: '/dashboard' })),
  ];

  res.json({ results });
});

module.exports = router;
