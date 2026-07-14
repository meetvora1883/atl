const express = require('express');
const router = express.Router();
const {
  searchUsers, getUserById, getUserRoles, getUserPermissions,
  getUserSessionsAdmin, getUserAuditLogs, banUser, unbanUser,
  removeRoleByName, assignRoleByName, listRoles, revokeSessionAsAdmin, auditLog,
} = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_users'));

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const users = q ? searchUsers(q) : searchUsers('');
  res.json(users.map((u) => ({
    id: u.id, discord_id: u.discord_id, username: u.username, avatar: u.avatar,
    banned: !!u.banned, created_at: u.created_at, last_login_at: u.last_login_at,
  })));
});

router.get('/:id', (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...user,
    roles: getUserRoles.all(user.id).map((r) => r.name),
    permissions: getUserPermissions.all(user.id).map((p) => p.name),
    sessions: getUserSessionsAdmin(user.id),
    logs: getUserAuditLogs(user.id),
    allRoles: listRoles().map((r) => r.name),
  });
});

router.post('/:id/ban', (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't ban yourself" });
  banUser.run(req.body.reason || 'No reason provided', target.id);
  auditLog(req.user.id, 'user_banned', 'user', target.id, { reason: req.body.reason }, req.ip);
  res.json({ ok: true });
});

router.post('/:id/unban', (req, res) => {
  unbanUser.run(req.params.id);
  auditLog(req.user.id, 'user_unbanned', 'user', req.params.id, null, req.ip);
  res.json({ ok: true });
});

router.delete('/:id/roles/:roleName', (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (req.params.roleName === 'owner') return res.status(400).json({ error: 'Remove owner access from the Owner Panel instead' });
  removeRoleByName.run(target.id, req.params.roleName);
  auditLog(req.user.id, 'role_removed', 'user', target.id, { role: req.params.roleName }, req.ip);
  res.json({ ok: true });
});

router.post('/:id/roles/:roleName', (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  assignRoleByName.run(target.id, req.params.roleName);
  auditLog(req.user.id, 'role_added', 'user', target.id, { role: req.params.roleName }, req.ip);
  res.json({ ok: true });
});

router.delete('/:id/sessions/:sessionId', (req, res) => {
  revokeSessionAsAdmin.run(req.params.sessionId);
  auditLog(req.user.id, 'session_revoked_by_admin', 'session', req.params.sessionId, { targetUser: req.params.id }, req.ip);
  res.json({ ok: true });
});

module.exports = router;
