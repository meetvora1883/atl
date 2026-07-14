const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.post('/optimize', requirePermission('manage_bot'), (req, res) => {
  try {
    db.pragma('optimize');
    res.json({ ok: true });
  } catch (err) {
    console.error('Optimize error:', err);
    res.status(500).json({ error: 'Optimize failed' });
  }
});

module.exports = router;