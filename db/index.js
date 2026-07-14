const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hypercity.sqlite');
const RESTORE_FLAG = path.join(__dirname, 'RESTORE_PENDING');

if (fs.existsSync(RESTORE_FLAG)) {
  const sourcePath = fs.readFileSync(RESTORE_FLAG, 'utf8').trim();
  try {
    if (sourcePath && fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, DB_PATH);
      console.log(`✓ Restored database from backup: ${sourcePath}`);
    }
  } catch (err) {
    console.error('Failed to restore backup:', err.message);
  } finally {
    fs.unlinkSync(RESTORE_FLAG);
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}
init();

// ---------- Emergency owner recovery ----------
function countOwners() {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM user_roles
    WHERE role_id = (SELECT id FROM roles WHERE name = 'owner')
  `).get();
  return row ? row.c : 0;
}

function ensureOwnerExists() {
  const ownerRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('owner');
  if (!ownerRole) return;
  const count = countOwners();
  if (count === 0) {
    const emergencyId = process.env.OWNER_DISCORD_ID || process.env.OWNER_DISCORD_IDS?.split(',')[0]?.trim();
    if (!emergencyId) {
      console.warn('[Emergency] No OWNER_DISCORD_ID set. Cannot recover owner.');
      return;
    }
    const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(emergencyId);
    if (user) {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, NULL)')
        .run(user.id, ownerRole.id);
      console.log(`[Emergency] Owner role restored to Discord ID ${emergencyId}`);
    } else {
      console.warn(`[Emergency] User with Discord ID ${emergencyId} not found. Owner role not restored.`);
    }
  }
}

// Run after init
ensureOwnerExists();

// ---------- Users ----------
const upsertUser = db.prepare(`
  INSERT INTO users (discord_id, username, discriminator, avatar, banner, email, last_login_at)
  VALUES (@discord_id, @username, @discriminator, @avatar, @banner, @email, datetime('now'))
  ON CONFLICT(discord_id) DO UPDATE SET
    username = excluded.username,
    discriminator = excluded.discriminator,
    avatar = excluded.avatar,
    banner = excluded.banner,
    email = excluded.email,
    last_login_at = datetime('now'),
    updated_at = datetime('now')
`);

function findOrCreateUser(profile) {
  upsertUser.run(profile);
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.discord_id);
}

const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const listUsers = () => db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();

// ---------- Roles / permissions ----------
const assignDefaultRole = db.prepare(`
  INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
  SELECT ?, id, ? FROM roles WHERE name = 'member'
`);

const assignRoleByName = db.prepare(`
  INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
  SELECT ?, id, ? FROM roles WHERE name = ?
`);

const removeRoleByName = db.prepare(`
  DELETE FROM user_roles WHERE user_id = ? AND role_id = (SELECT id FROM roles WHERE name = ?)
`);

const getUserRoles = db.prepare(`
  SELECT r.* FROM roles r
  JOIN user_roles ur ON ur.role_id = r.id
  WHERE ur.user_id = ?
`);

const getUserPermissions = db.prepare(`
  SELECT DISTINCT p.name FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  JOIN user_roles ur ON ur.role_id = rp.role_id
  WHERE ur.user_id = ?
`);

const listRoles = () => db.prepare('SELECT * FROM roles ORDER BY priority DESC, name ASC').all();
const listPermissions = () => db.prepare('SELECT * FROM permissions ORDER BY name').all();

function ensureDefaultSettings(userId) {
  db.prepare(`INSERT OR IGNORE INTO settings (user_id) VALUES (?)`).run(userId);
}

// ---------- Owners (legacy) ----------
const isOwner = (userId) => !!db.prepare('SELECT 1 FROM owners WHERE user_id = ?').get(userId);
const listOwners = () => db.prepare(`
  SELECT o.*, u.username, u.avatar FROM owners o JOIN users u ON u.id = o.user_id ORDER BY o.added_at
`).all();
const addOwner = db.prepare('INSERT OR IGNORE INTO owners (user_id, added_by) VALUES (?, ?)');
const removeOwner = db.prepare('DELETE FROM owners WHERE user_id = ?');
const logOwnerAction = db.prepare(
  'INSERT INTO owner_logs (action, actor_id, target_id, details) VALUES (?, ?, ?, ?)'
);

// ---------- Sessions (refresh tokens) ----------
const createSession = db.prepare(`
  INSERT INTO sessions (user_id, refresh_token_hash, device_type, browser, os, user_agent, ip_address, country, remember, expires_at)
  VALUES (@user_id, @refresh_token_hash, @device_type, @browser, @os, @user_agent, @ip_address, @country, @remember, @expires_at)
`);

const getSessionById = db.prepare('SELECT * FROM sessions WHERE id = ?');

function getSessionByRawToken(hash) {
  const current = db.prepare('SELECT * FROM sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL').get(hash);
  if (current) return { session: current, viaPrevious: false };

  const viaPrev = db
    .prepare(
      `SELECT * FROM sessions
       WHERE prev_refresh_token_hash = ? AND revoked_at IS NULL
         AND prev_hash_expires_at IS NOT NULL AND prev_hash_expires_at > datetime('now')`
    )
    .get(hash);
  return viaPrev ? { session: viaPrev, viaPrevious: true } : { session: null, viaPrevious: false };
}

const listActiveSessions = db.prepare(`
  SELECT id, device_type, browser, os, user_agent, ip_address, country, created_at, last_used_at, expires_at
  FROM sessions
  WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
  ORDER BY last_used_at DESC
`);

const listAllActiveSessions = db.prepare(`
  SELECT s.id, s.user_id, u.username, s.device_type, s.browser, s.os, s.ip_address, s.created_at, s.last_used_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.revoked_at IS NULL AND s.expires_at > datetime('now')
  ORDER BY s.last_used_at DESC
`);

const rotateSession = db.prepare(`
  UPDATE sessions SET
    prev_refresh_token_hash = refresh_token_hash,
    prev_hash_expires_at = datetime('now', '+20 seconds'),
    refresh_token_hash = ?,
    last_used_at = datetime('now'),
    expires_at = ?
  WHERE id = ?
`);
const revokeSession = db.prepare(`
  UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?
`);
const revokeSessionAsAdmin = db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?`);
const revokeAllSessionsExcept = db.prepare(`
  UPDATE sessions SET revoked_at = datetime('now')
  WHERE user_id = ? AND id != ? AND revoked_at IS NULL
`);

// ---------- Failed logins ----------
const recordFailedLogin = db.prepare(
  'INSERT INTO failed_logins (discord_id, reason, ip_address) VALUES (?, ?, ?)'
);

// ---------- Audit / console / api logs ----------
const writeAuditLog = db.prepare(
  'INSERT INTO audit_logs (actor_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
);
function auditLog(actorId, action, targetType, targetId, details, ip) {
  writeAuditLog.run(actorId || null, action, targetType || null, targetId ? String(targetId) : null, details ? JSON.stringify(details) : null, ip || null);
}

const writeConsoleLog = db.prepare('INSERT INTO console_logs (level, message, meta) VALUES (?, ?, ?)');
function consoleLog(level, message, meta) {
  const info = writeConsoleLog.run(level, message, meta ? JSON.stringify(meta) : null);
  return { id: info.lastInsertRowid, level, message, meta, created_at: new Date().toISOString() };
}

const writeApiLog = db.prepare(
  'INSERT INTO api_logs (method, path, status_code, duration_ms, user_id, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
);

// ---------- Translations ----------
function loadTranslations() {
  const rows = db.prepare('SELECT * FROM translations').all();
  const map = { en: {}, hi: {}, gu: {} };
  for (const row of rows) {
    map.en[row.key] = row.en;
    map.hi[row.key] = row.hi || row.en;
    map.gu[row.key] = row.gu || row.en;
  }
  return map;
}

// ---------- Members / moderation ----------
const listMembers = () => db.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
const getMember = (id) => db.prepare('SELECT * FROM members WHERE id = ?').get(id);
const searchMembers = (q) =>
  db.prepare('SELECT * FROM members WHERE username LIKE ? ORDER BY created_at DESC LIMIT 50').all(`%${q}%`);

// ---------- Server / maintenance ----------
const getServerSettings = () => db.prepare('SELECT * FROM server_settings WHERE id = 1').get();
const setMaintenanceMode = db.prepare(
  `UPDATE server_settings SET maintenance_mode = ?, maintenance_message = COALESCE(?, maintenance_message), updated_at = datetime('now') WHERE id = 1`
);

const getBotSettings = () => db.prepare('SELECT * FROM bot_settings WHERE id = 1').get();

// ---------- Role management (CRUD) ----------
const getAllRoles = db.prepare(`
  SELECT * FROM roles ORDER BY priority DESC, name ASC
`);
const getRoleById = db.prepare('SELECT * FROM roles WHERE id = ?');

const createRole = db.prepare(`
  INSERT INTO roles (name, description, color, icon, priority, enabled, protected)
  VALUES (?, ?, ?, ?, ?, ?, 0)
`);

const updateRole = db.prepare(`
  UPDATE roles SET
    name = COALESCE(@name, name),
    description = COALESCE(@description, description),
    color = COALESCE(@color, color),
    icon = COALESCE(@icon, icon),
    priority = COALESCE(@priority, priority),
    enabled = COALESCE(@enabled, enabled)
  WHERE id = @id
`);

const deleteRole = db.prepare('DELETE FROM roles WHERE id = ? AND name NOT IN (\'owner\', \'member\')');

// ---------- Permissions ----------
const getAllPermissions = db.prepare('SELECT * FROM permissions ORDER BY name');

// ---------- Role Permissions ----------
const getRolePermissions = db.prepare(`
  SELECT p.* FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  WHERE rp.role_id = ?
`);

const clearRolePermissions = db.prepare('DELETE FROM role_permissions WHERE role_id = ?');
const addRolePermission = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

function setRolePermissions(roleId, permissionIds) {
  clearRolePermissions.run(roleId);
  for (const pid of permissionIds) addRolePermission.run(roleId, pid);
}

// ---------- User Roles (assignment) ----------
const assignRoleToUser = db.prepare(`
  INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)
`);
const removeRoleFromUser = db.prepare(`
  DELETE FROM user_roles WHERE user_id = ? AND role_id = ?
`);
const getUsersWithRole = db.prepare(`
  SELECT u.* FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  WHERE ur.role_id = ?
`);

// ---------- Role Logs ----------
const logRoleAction = db.prepare(`
  INSERT INTO role_logs (user_id, action, target_id, metadata) VALUES (?, ?, ?, ?)
`);

// ---------- Role helpers ----------
function countUsersWithRole(roleId) {
  return db.prepare('SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?').get(roleId).c;
}

function isProtectedRole(roleId) {
  const row = db.prepare('SELECT protected FROM roles WHERE id = ?').get(roleId);
  return row ? row.protected === 1 : false;
}

// ---------- User admin ----------
const searchUsers = (q) =>
  db.prepare('SELECT * FROM users WHERE username LIKE ? OR discord_id LIKE ? ORDER BY created_at DESC LIMIT 30').all(`%${q}%`, `%${q}%`);
const banUser = db.prepare(`UPDATE users SET banned = 1, banned_reason = ?, banned_at = datetime('now') WHERE id = ?`);
const unbanUser = db.prepare(`UPDATE users SET banned = 0, banned_reason = NULL, banned_at = NULL WHERE id = ?`);
const getUserSessionsAdmin = (userId) =>
  db.prepare(`SELECT * FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 20`).all(userId);
const getUserAuditLogs = (userId) =>
  db.prepare(`SELECT * FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 30`).all(userId);

// ---------- Widgets / theme preferences ----------
const ensureUserPreferences = db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)');
function getUserPreferences(userId) {
  ensureUserPreferences.run(userId);
  const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  return {
    widgets: JSON.parse(row.widgets_json || '[]'),
    theme: JSON.parse(row.theme_json || '{}'),
  };
}
const saveWidgets = db.prepare(`UPDATE user_preferences SET widgets_json = ?, updated_at = datetime('now') WHERE user_id = ?`);
const saveTheme = db.prepare(`UPDATE user_preferences SET theme_json = ?, updated_at = datetime('now') WHERE user_id = ?`);

// ---------- Scheduled tasks ----------
const listScheduledTasks = () => db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all();
const createScheduledTask = db.prepare(
  'INSERT INTO scheduled_tasks (name, type, payload_json, cron_expr, created_by) VALUES (?, ?, ?, ?, ?)'
);
const deleteScheduledTask = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?');
const toggleScheduledTask = db.prepare('UPDATE scheduled_tasks SET enabled = ? WHERE id = ?');
const markTaskRun = db.prepare(`UPDATE scheduled_tasks SET last_run_at = datetime('now') WHERE id = ?`);

// ---------- Backups ----------
const recordBackup = db.prepare('INSERT INTO backups (filename, size_bytes, created_by) VALUES (?, ?, ?)');
const listBackups = () => db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
const deleteBackupRecord = db.prepare('DELETE FROM backups WHERE id = ?');
const getBackup = (id) => db.prepare('SELECT * FROM backups WHERE id = ?').get(id);

// ---------- Global settings (JSON blob) ----------
function getGlobalSettings() {
  const row = db.prepare('SELECT settings_json FROM server_settings WHERE id = 1').get();
  if (!row) return {};
  try {
    return JSON.parse(row.settings_json || '{}');
  } catch {
    return {};
  }
}

function updateGlobalSettings(newSettings) {
  const current = getGlobalSettings();
  const merged = { ...current, ...newSettings };
  db.prepare('UPDATE server_settings SET settings_json = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(JSON.stringify(merged));
  return merged;
}

// ---------- Role Hierarchy Helpers (with owner bypass) ----------

function getHighestRole(userId) {
  const stmt = db.prepare(`
    SELECT r.* FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
    ORDER BY r.priority DESC
    LIMIT 1
  `);
  return stmt.get(userId);
}

function getHighestRolePosition(userId) {
  const role = getHighestRole(userId);
  return role ? role.priority : 0;
}

// Check if actor can manage a role (edit, delete, change permissions)
function canManageRole(actorUserId, targetRoleId) {
  // --- Owner bypass ---
  const actorRoles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(actorUserId).map(r => r.name);
  if (actorRoles.includes('owner')) return true;

  const actorPos = getHighestRolePosition(actorUserId);
  const targetRole = db.prepare('SELECT priority, name FROM roles WHERE id = ?').get(targetRoleId);
  if (!targetRole) return false;
  // Special case: owner role can only be managed by another owner (already handled above)
  if (targetRole.name === 'owner') {
    return actorRoles.includes('owner');
  }
  return actorPos > targetRole.priority;
}

function canManageUser(actorUserId, targetUserId) {
  // --- Owner bypass ---
  const actorRoles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(actorUserId).map(r => r.name);
  if (actorRoles.includes('owner')) return true;

  const actorPos = getHighestRolePosition(actorUserId);
  const targetPos = getHighestRolePosition(targetUserId);
  return actorPos > targetPos;
}

function canAssignRole(actorUserId, roleId) {
  // --- Owner bypass ---
  const actorRoles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(actorUserId).map(r => r.name);
  if (actorRoles.includes('owner')) return true;

  const actorPos = getHighestRolePosition(actorUserId);
  const role = db.prepare('SELECT priority FROM roles WHERE id = ?').get(roleId);
  if (!role) return false;
  return actorPos > role.priority;
}

// ---------- Session cleanup ----------
function cleanupSessions() {
  const result = db.prepare(`
    DELETE FROM sessions
    WHERE revoked_at IS NOT NULL
       OR expires_at <= datetime('now')
  `).run();
  if (result.changes > 0) {
    console.log(`[Cleanup] Removed ${result.changes} expired/revoked sessions.`);
  }
  return result.changes;
}

module.exports = {
  db,
  DB_PATH,
  findOrCreateUser,
  getUserById,
  listUsers,
  assignDefaultRole,
  assignRoleByName,
  removeRoleByName,
  getUserRoles,
  getUserPermissions,
  listRoles,
  listPermissions,
  ensureDefaultSettings,
  isOwner,
  listOwners,
  addOwner,
  removeOwner,
  logOwnerAction,
  createSession,
  getSessionById,
  getSessionByRawToken,
  listActiveSessions,
  listAllActiveSessions,
  rotateSession,
  revokeSession,
  revokeSessionAsAdmin,
  revokeAllSessionsExcept,
  recordFailedLogin,
  auditLog,
  consoleLog,
  writeApiLog,
  loadTranslations,
  listMembers,
  getMember,
  searchMembers,
  getServerSettings,
  setMaintenanceMode,
  getBotSettings,
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getAllPermissions,
  getRolePermissions,
  setRolePermissions,
  assignRoleToUser,
  removeRoleFromUser,
  getUsersWithRole,
  logRoleAction,
  countUsersWithRole,
  searchUsers,
  banUser,
  unbanUser,
  getUserSessionsAdmin,
  getUserAuditLogs,
  getUserPreferences,
  saveWidgets,
  saveTheme,
  listScheduledTasks,
  createScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
  markTaskRun,
  recordBackup,
  listBackups,
  deleteBackupRecord,
  getBackup,
  getGlobalSettings,
  updateGlobalSettings,
  getHighestRole,
  getHighestRolePosition,
  canManageRole,
  canManageUser,
  canAssignRole,
  countOwners,
  isProtectedRole,
  ensureOwnerExists,
    cleanupSessions,
};