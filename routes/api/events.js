const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY event_date DESC').all();
  res.json(events);
});

router.post('/', (req, res) => {
  const { name, description, event_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare(
    'INSERT INTO events (name, description, event_date, created_by) VALUES (?, ?, ?, ?)'
  ).run(name, description || null, event_date || null, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

router.patch('/:id', (req, res) => {
  const { name, description, event_date } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (event_date !== undefined) updates.event_date = event_date;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE events SET ${setClause} WHERE id = ?`).run(...values, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
