const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/me', (req, res) => {
  const { id, discord_id, username, discriminator, avatar, email, roles, permissions } = req.user;
  res.json({ id, discord_id, username, discriminator, avatar, email, roles, permissions });
});

// Only cosmetic/local fields are editable — Discord identity fields are
// always resynced from Discord on next login, never trusted from the client.
router.patch('/me', (req, res) => {
  const allowed = ['username'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: req.user.id,
  });

  res.json({ ok: true });
});

module.exports = router;
