const express = require('express');
const router = express.Router();
const {
  getUserById,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getRoleById,
  logRoleAction,
  auditLog,
  listRoles,
  db
} = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_users'));

// GET user's roles
router.get('/:userId/roles', (req, res) => {
  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const roles = getUserRoles.all(user.id);
  res.json(roles);
});

// POST assign role to user
router.post('/:userId/roles', (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId required' });
  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const role = getRoleById.get(roleId);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (!role.enabled) return res.status(400).json({ error: 'Role is disabled' });

  assignRoleToUser.run(user.id, roleId, req.user.id);
  logRoleAction.run(req.user.id, 'role_assigned', user.id, JSON.stringify({ roleId, roleName: role.name }));
  auditLog(req.user.id, 'role_assigned', 'user', user.id, { roleId, roleName: role.name }, req.ip);
  res.json({ ok: true });
});

// DELETE remove role from user
router.delete('/:userId/roles/:roleName', (req, res) => {
  console.log(`[user-roles] DELETE request for user ${req.params.userId}, role "${req.params.roleName}"`);
  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const roleName = req.params.roleName.trim();
  if (roleName.toLowerCase() === 'owner') {
    return res.status(400).json({ error: 'Remove owner role via Owner Panel' });
  }

  // Case‑insensitive lookup
  const role = db.prepare('SELECT id FROM roles WHERE LOWER(name) = LOWER(?)').get(roleName);
  console.log(`[user-roles] Found role:`, role);
  if (!role) {
    console.log(`[user-roles] Role "${roleName}" not found`);
    // List all roles for debugging
    const allRoles = listRoles();
    console.log('[user-roles] Available roles:', allRoles.map(r => r.name));
    return res.status(400).json({ error: `Role "${roleName}" does not exist` });
  }

  const result = removeRoleFromUser.run(user.id, role.id);
  console.log(`[user-roles] Deleted ${result.changes} row(s)`);
  if (result.changes === 0) {
    return res.status(400).json({ error: `User does not have role "${roleName}" assigned` });
  }

  logRoleAction.run(req.user.id, 'role_removed', user.id, JSON.stringify({ roleId: role.id, roleName }));
  auditLog(req.user.id, 'role_removed', 'user', user.id, { roleId: role.id, roleName }, req.ip);
  res.json({ ok: true });
});

module.exports = router;