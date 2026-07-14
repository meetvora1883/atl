const express = require('express');
const router = express.Router();
const { listScheduledTasks, createScheduledTask, deleteScheduledTask, toggleScheduledTask, auditLog } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_bot_settings'));

router.get('/', (req, res) => {
  res.json(listScheduledTasks());
});

const CRON_PRESETS = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
};

router.post('/', (req, res) => {
  const { name, type, payload, schedule, customCron } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const cronExpr = schedule === 'custom' ? customCron : CRON_PRESETS[schedule];
  if (!cronExpr) return res.status(400).json({ error: 'Invalid schedule' });

  const info = createScheduledTask.run(name, type, JSON.stringify(payload || {}), cronExpr, req.user.id);
  auditLog(req.user.id, 'task_scheduled', 'scheduled_task', info.lastInsertRowid, { name, type, cronExpr }, req.ip);

  const scheduler = req.app.get('scheduler');
  if (scheduler) scheduler.registerTask({ id: info.lastInsertRowid, name, type, payload_json: JSON.stringify(payload || {}), cron_expr: cronExpr, enabled: 1 });

  res.status(201).json({ id: info.lastInsertRowid, cronExpr });
});

router.patch('/:id/toggle', (req, res) => {
  toggleScheduledTask.run(req.body.enabled ? 1 : 0, req.params.id);
  const scheduler = req.app.get('scheduler');
  if (scheduler) scheduler.setEnabled(req.params.id, !!req.body.enabled);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  deleteScheduledTask.run(req.params.id);
  const scheduler = req.app.get('scheduler');
  if (scheduler) scheduler.unregisterTask(req.params.id);
  auditLog(req.user.id, 'task_deleted', 'scheduled_task', req.params.id, null, req.ip);
  res.json({ ok: true });
});

module.exports = router;
