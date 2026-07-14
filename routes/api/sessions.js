const express = require('express');
const router = express.Router();
const { listActiveSessions, revokeSession, revokeAllSessionsExcept } = require('../../db');

router.get('/', (req, res) => {
  const sessions = listActiveSessions.all(req.user.id).map((s) => ({
    ...s,
    isCurrent: String(s.id) === String(req.cookies.session_id),
  }));
  res.json(sessions);
});

router.delete('/:id', (req, res) => {
  const result = revokeSession.run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

// Revoke every session except the one making this request ("log out other devices")
router.delete('/', (req, res) => {
  const currentSessionId = req.cookies.session_id;
  revokeAllSessionsExcept.run(req.user.id, currentSessionId || 0);
  res.json({ ok: true });
});

module.exports = router;
