const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { db, DB_PATH, recordBackup, listBackups, deleteBackupRecord, getBackup, auditLog } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'db', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

router.use(requirePermission('owner_access'));

router.get('/', (req, res) => {
  res.json(listBackups());
});

router.post('/', async (req, res) => {
  const filename = `hypercity-backup-${Date.now()}.sqlite`;
  const destPath = path.join(BACKUP_DIR, filename);
  try {
    // better-sqlite3's built-in backup() is safe to run against a live,
    // in-use database — it doesn't require locking out other connections.
    await db.backup(destPath);
    const size = fs.statSync(destPath).size;
    const info = recordBackup.run(filename, size, req.user.id);
    auditLog(req.user.id, 'backup_created', 'backup', info.lastInsertRowid, { filename, size }, req.ip);
    res.status(201).json({ id: info.lastInsertRowid, filename, size_bytes: size });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

router.get('/:id/download', (req, res) => {
  const backup = getBackup(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup not found' });
  const filePath = path.join(BACKUP_DIR, backup.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file missing on disk' });
  res.download(filePath, backup.filename);
});

// Restoring a live SQLite file safely requires the process to restart with
// the new file already in place (better-sqlite3 holds the current file open
// for the app's whole lifetime). We flag the requested backup for restore;
// db/index.js swaps it in the next time the server boots.
router.post('/:id/restore', (req, res) => {
  const backup = getBackup(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup not found' });
  const filePath = path.join(BACKUP_DIR, backup.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file missing on disk' });

  fs.writeFileSync(path.join(__dirname, '..', '..', 'db', 'RESTORE_PENDING'), filePath);
  auditLog(req.user.id, 'backup_restore_requested', 'backup', backup.id, { filename: backup.filename }, req.ip);
  res.json({ ok: true, message: 'Restore staged. Restart the server (npm start) to apply it.' });
});

router.delete('/:id', (req, res) => {
  const backup = getBackup(req.params.id);
  if (backup) {
    const filePath = path.join(BACKUP_DIR, backup.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  deleteBackupRecord.run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
