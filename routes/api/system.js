const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.get('/', requirePermission('manage_bot'), (req, res) => {
  try {
    // Database size
    const dbSize = db.prepare('PRAGMA page_count').get()?.page_count * 4096 || 0;
    const dbSizeMB = (dbSize / 1024 / 1024).toFixed(2);

    // Uptime (process.uptime() in seconds)
    const uptimeSeconds = process.uptime();
    const uptimeStr = `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;

    // Memory usage
    const mem = process.memoryUsage();
    const memUsageMB = (mem.rss / 1024 / 1024).toFixed(2);

    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: uptimeStr,
      uptimeSeconds,
      memoryUsage: memUsageMB + ' MB',
      dbSize: dbSizeMB + ' MB',
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
    });
  } catch (err) {
    console.error('System info error:', err);
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

module.exports = router;