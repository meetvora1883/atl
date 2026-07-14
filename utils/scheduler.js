const cron = require('node-cron');
const { db, listScheduledTasks, markTaskRun, consoleLog } = require('../db');

/**
 * Runs a scheduled task's action. `restart_bot` is intentionally a stub —
 * this dashboard doesn't manage a live bot process, so it just logs the
 * intent. Wire it up to your bot's process manager (pm2, systemd, etc.)
 * when you have one.
 */
function runTask(task) {
  const payload = JSON.parse(task.payload_json || '{}');

  switch (task.type) {
    case 'announcement':
      db.prepare('INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)').run(
        payload.title || task.name,
        payload.body || '',
        task.created_by
      );
      consoleLog('info', `Scheduled announcement posted: ${payload.title || task.name}`);
      break;
    case 'event':
      db.prepare('INSERT INTO events (name, description, event_date, created_by) VALUES (?, ?, ?, ?)').run(
        payload.name || task.name,
        payload.description || '',
        payload.event_date || null,
        task.created_by
      );
      consoleLog('info', `Scheduled event created: ${payload.name || task.name}`);
      break;
    case 'backup':
      db.backup(require('path').join(__dirname, '..', 'db', 'backups', `auto-${Date.now()}.sqlite`))
        .then(() => consoleLog('database', 'Scheduled automatic backup completed'))
        .catch((err) => consoleLog('error', 'Scheduled backup failed', { error: err.message }));
      break;
    case 'restart_bot':
      consoleLog('warning', 'Scheduled "restart bot" task fired — no live bot process is connected to act on this yet.');
      break;
    default:
      consoleLog('warning', `Unknown scheduled task type: ${task.type}`);
  }

  markTaskRun.run(task.id);
}

function createScheduler(io) {
  const jobs = new Map();

  function registerTask(task) {
    if (!task.enabled) return;
    if (jobs.has(task.id)) jobs.get(task.id).stop();
    try {
      const job = cron.schedule(task.cron_expr, () => {
        runTask(task);
        if (io) io.emit('scheduler_tick', { taskId: task.id, name: task.name, ranAt: new Date().toISOString() });
      });
      jobs.set(task.id, job);
    } catch (err) {
      consoleLog('error', `Invalid cron expression for task ${task.id}: ${task.cron_expr}`);
    }
  }

  function unregisterTask(id) {
    const job = jobs.get(Number(id));
    if (job) { job.stop(); jobs.delete(Number(id)); }
  }

  function setEnabled(id, enabled) {
    unregisterTask(id);
    if (enabled) {
      const task = listScheduledTasks().find((t) => t.id === Number(id));
      if (task) registerTask(task);
    }
  }

  function bootAll() {
    listScheduledTasks().forEach((task) => task.enabled && registerTask(task));
  }

  bootAll();
  return { registerTask, unregisterTask, setEnabled, jobs };
}

module.exports = { createScheduler };
