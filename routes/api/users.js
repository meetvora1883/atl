const express = require('express');
const router = express.Router();
const {
  db,
  getUserById,
  getUserRoles,
  listRoles,
  listActiveSessions,
  getUserAuditLogs,
  banUser,
  unbanUser,
  assignRoleToUser,
  removeRoleFromUser,
  revokeSessionAsAdmin,
  auditLog,
  searchUsers,
  getHighestRolePosition,
  canManageUser,
  canAssignRole,
  canManageRole,
  countOwners,
} = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_users'));

router.get('/', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const users = searchUsers(q);
    res.json(users.map(u => ({
      id: u.id,
      discord_id: u.discord_id,
      username: u.username,
      avatar: u.avatar,
      banned: !!u.banned,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    })));
  } catch (err) {
    console.error('[API /users] ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const roles = getUserRoles.all(user.id).map(r => r.name);
    const allRoles = listRoles().map(r => r.name);
    const sessions = listActiveSessions.all(user.id).map(s => ({
      id: s.id,
      browser: s.browser,
      os: s.os,
      ip_address: s.ip_address,
    }));
    const logs = getUserAuditLogs(user.id).map(l => ({
      action: l.action,
      target_type: l.target_type,
      created_at: l.created_at,
    }));
    const highestRolePosition = getHighestRolePosition(user.id);

    res.json({
      id: user.id,
      discord_id: user.discord_id,
      username: user.username,
      avatar: user.avatar,
      email: user.email,
      banned: !!user.banned,
      banned_reason: user.banned_reason,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
      roles,
      allRoles,
      sessions,
      logs,
      highestRolePosition,
    });
  } catch (err) {
    console.error('[API /users/:id] ERROR:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/:id/ban', requirePermission('ban_users'), (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot ban yourself' });

    if (!canManageUser(req.user.id, target.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { reason: 'Attempted to ban higher/equal user' }, req.ip);
      return res.status(403).json({ error: 'You cannot ban a user with equal or higher authority.' });
    }

    const reason = req.body.reason || 'No reason provided';
    banUser.run(reason, target.id);
    auditLog(req.user.id, 'user_banned', 'user', target.id, { reason }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API /ban] ERROR:', err);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

router.post('/:id/unban', requirePermission('ban_users'), (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (!canManageUser(req.user.id, target.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { reason: 'Attempted to unban higher/equal user' }, req.ip);
      return res.status(403).json({ error: 'You cannot unban a user with equal or higher authority.' });
    }

    unbanUser.run(target.id);
    auditLog(req.user.id, 'user_unbanned', 'user', target.id, null, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API /unban] ERROR:', err);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

router.post('/:id/roles/:roleName', requirePermission('manage_user_roles'), (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const roleName = req.params.roleName.trim();
    const role = db.prepare('SELECT id, priority FROM roles WHERE LOWER(name) = LOWER(?)').get(roleName);
    if (!role) return res.status(400).json({ error: `Role "${roleName}" does not exist` });

    if (!canAssignRole(req.user.id, role.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { role: roleName, reason: 'Attempted to assign higher/equal role' }, req.ip);
      return res.status(403).json({ error: 'You cannot assign a role equal to or higher than your own.' });
    }
    if (!canManageUser(req.user.id, target.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { role: roleName, reason: 'Attempted to assign role to higher/equal user' }, req.ip);
      return res.status(403).json({ error: 'You cannot manage a user with equal or higher authority.' });
    }

    assignRoleToUser.run(target.id, role.id, req.user.id);
    auditLog(req.user.id, 'role_assigned', 'user', target.id, { role: roleName }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API /addRole] ERROR:', err);
    res.status(500).json({ error: 'Failed to add role' });
  }
});

router.delete('/:id/roles/:roleName', requirePermission('manage_user_roles'), (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const roleName = req.params.roleName.trim();
    if (roleName.toLowerCase() === 'owner') {
      const ownerCount = countOwners();
      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last owner.' });
      }
      if (!req.user.roles.includes('owner')) {
        return res.status(403).json({ error: 'Only owners can remove the owner role.' });
      }
    }
    const role = db.prepare('SELECT id, priority FROM roles WHERE LOWER(name) = LOWER(?)').get(roleName);
    if (!role) return res.status(400).json({ error: `Role "${roleName}" does not exist` });

    if (!canManageRole(req.user.id, role.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { role: roleName, reason: 'Attempted to remove higher/equal role' }, req.ip);
      return res.status(403).json({ error: 'You cannot remove a role equal to or higher than your own.' });
    }
    if (!canManageUser(req.user.id, target.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'user', target.id, { role: roleName, reason: 'Attempted to remove role from higher/equal user' }, req.ip);
      return res.status(403).json({ error: 'You cannot manage a user with equal or higher authority.' });
    }

    const result = removeRoleFromUser.run(target.id, role.id);
    if (result.changes === 0) {
      return res.status(400).json({ error: `User does not have role "${roleName}" assigned` });
    }

    auditLog(req.user.id, 'role_removed', 'user', target.id, { role: roleName }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API /removeRole] ERROR:', err);
    res.status(500).json({ error: 'Failed to remove role' });
  }
});

router.delete('/:id/sessions/:sessionId', requirePermission('manage_sessions'), (req, res) => {
  try {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const sessionId = req.params.sessionId;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, target.id);
    if (!session) return res.status(404).json({ error: 'Session not found for this user' });

    if (!canManageUser(req.user.id, target.id)) {
      auditLog(req.user.id, 'hierarchy_violation', 'session', sessionId, { targetUser: target.id, reason: 'Attempted to revoke session of higher/equal user' }, req.ip);
      return res.status(403).json({ error: 'You cannot revoke sessions for a user with equal or higher authority.' });
    }

    revokeSessionAsAdmin.run(sessionId);
    auditLog(req.user.id, 'session_revoked_by_admin', 'session', sessionId, { targetUser: target.id }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API /revokeSession] ERROR:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

module.exports = router;