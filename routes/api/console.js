const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../middleware/roles');
const { db } = require('../../db');

router.get('/', requirePermission('console_access'), (req, res) => {
  try {
    // Fetch console logs
    const consoleLogs = db.prepare(`
      SELECT * FROM console_logs ORDER BY created_at DESC LIMIT 100
    `).all();

    // Fetch API logs (errors)
    const apiLogs = db.prepare(`
      SELECT * FROM api_logs WHERE status_code >= 400 ORDER BY created_at DESC LIMIT 50
    `).all();

    // Combine and sort by created_at (most recent first)
    const combined = [
      ...consoleLogs.map(l => ({ ...l, type: 'console' })),
      ...apiLogs.map(l => ({ ...l, type: 'api' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ logs: combined });
  } catch (err) {
    console.error('[API /console] Error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

module.exports = router;