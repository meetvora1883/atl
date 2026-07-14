const express = require('express');
const router = express.Router();
const { db } = require('../../db');

router.get('/overview', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const activeSessions = db.prepare(`
    SELECT COUNT(*) AS c FROM sessions WHERE revoked_at IS NULL AND expires_at > datetime('now')
  `).get().c;
  const signupsLast7Days = db.prepare(`
    SELECT COUNT(*) AS c FROM users WHERE created_at > datetime('now', '-7 days')
  `).get().c;
  const totalNotifications = db.prepare('SELECT COUNT(*) AS c FROM notifications').get().c;

  res.json({
    totalUsers,
    activeSessions,
    signupsLast7Days,
    totalNotifications,
    averageSessionsPerUser: totalUsers ? (activeSessions / totalUsers).toFixed(2) : 0,
  });
});

router.get('/users/daily', (req, res) => {
  const data = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM users
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
  res.json(data);
});

router.get('/sessions/daily', (req, res) => {
  const data = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM sessions
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
  res.json(data);
});

router.get('/logins/daily', (req, res) => {
  const data = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS successful
    FROM sessions
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
  const failed = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM failed_logins
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
  res.json({ successful: data, failed });
});

router.get('/devices', (req, res) => {
  const data = db.prepare(`
    SELECT device_type, COUNT(*) AS count
    FROM sessions
    WHERE revoked_at IS NULL
    GROUP BY device_type
    ORDER BY count DESC
  `).all();
  res.json(data);
});

router.get('/browsers', (req, res) => {
  const data = db.prepare(`
    SELECT SUBSTR(browser, 1, INSTR(browser, ' ') - 1) AS name, COUNT(*) AS count
    FROM sessions
    WHERE revoked_at IS NULL AND browser IS NOT NULL
    GROUP BY SUBSTR(browser, 1, INSTR(browser, ' ') - 1)
    ORDER BY count DESC
    LIMIT 10
  `).all();
  res.json(data);
});

module.exports = router;
