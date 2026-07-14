const express = require('express');
const router = express.Router();
const {
  getAllRoles, getRoleById, createRole, updateRole, deleteRole,
  getAllPermissions, getRolePermissions, setRolePermissions,
  logRoleAction, auditLog,
  canManageRole, getHighestRolePosition,
  isProtectedRole, countOwners,
} = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_roles'));

// Helper: get role by name (case-insensitive)
function getRoleByName(name) {
  return getAllRoles.all().find(r => r.name.toLowerCase() === name.toLowerCase()) || null;
}

// GET all roles
router.get('/', (req, res) => {
  const roles = getAllRoles.all();
  const permissions = getAllPermissions.all();
  const result = roles.map(role => {
    const perms = getRolePermissions.all(role.id).map(p => p.id);
    return { ...role, permissions: perms };
  });
  res.json({ roles: result, permissions });
});

// GET single role
router.get('/:id', (req, res) => {
  const role = getRoleById.get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const perms = getRolePermissions.all(role.id).map(p => p.id);
  res.json({ ...role, permissions: perms });
});

// POST create role
router.post('/', (req, res) => {
  const { name, description, color, icon, priority, enabled } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

  const trimmedName = name.trim().toLowerCase();
  const existing = getRoleByName(trimmedName);
  if (existing) return res.status(400).json({ error: 'A role with this name already exists.' });

  const newPriority = parseInt(priority) || 0;
  const actorHighestPos = req.user.highestRolePosition || 0;
  const isOwner = req.user.roles.includes('owner');
  if (!isOwner && newPriority > actorHighestPos) {
    return res.status(403).json({ error: 'You cannot create a role with higher priority than your own.' });
  }

  const info = createRole.run(
    trimmedName,
    description || null,
    color || '#8b8fa3',
    icon || 'bi-shield',
    newPriority,
    enabled !== undefined ? (enabled ? 1 : 0) : 1
  );
  logRoleAction.run(req.user.id, 'role_created', info.lastInsertRowid, JSON.stringify({ name: trimmedName }));
  auditLog(req.user.id, 'role_created', 'role', info.lastInsertRowid, { name: trimmedName }, req.ip);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT update role
router.put('/:id', (req, res) => {
  const role = getRoleById.get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  // Hierarchy check
  if (!canManageRole(req.user.id, req.params.id)) {
    auditLog(req.user.id, 'hierarchy_violation', 'role', req.params.id, { reason: 'Attempted to edit higher role' }, req.ip);
    return res.status(403).json({ error: 'You cannot manage this role (equal or higher authority).' });
  }

  // Protected role check – only owners can edit protected roles
  if (isProtectedRole(req.params.id) && !req.user.roles.includes('owner')) {
    return res.status(403).json({ error: 'Protected roles can only be edited by owners.' });
  }

  // If renaming, check for duplicate (case-insensitive)
  const newName = req.body.name ? req.body.name.trim().toLowerCase() : undefined;
  if (newName && newName !== role.name) {
    const existing = getRoleByName(newName);
    if (existing && existing.id !== role.id) {
      return res.status(400).json({ error: 'A role with this name already exists.' });
    }
    if (['owner', 'member'].includes(role.name)) {
      return res.status(400).json({ error: 'Cannot rename system roles' });
    }
  }

  // Priority validation
  const newPriority = req.body.priority !== undefined ? parseInt(req.body.priority) : null;
  const actorHighestPos = req.user.highestRolePosition || 0;
  const isOwner = req.user.roles.includes('owner');
  if (newPriority !== null && !isOwner && newPriority > actorHighestPos) {
    return res.status(403).json({ error: 'You cannot set a priority higher than your own.' });
  }

  const { description, color, icon, enabled } = req.body;
  updateRole.run({
    id: req.params.id,
    name: newName,
    description: description !== undefined ? description : undefined,
    color: color || undefined,
    icon: icon || undefined,
    priority: newPriority !== null ? newPriority : undefined,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : undefined,
  });
  logRoleAction.run(req.user.id, 'role_updated', req.params.id, JSON.stringify(req.body));
  auditLog(req.user.id, 'role_updated', 'role', req.params.id, req.body, req.ip);
  res.json({ ok: true });
});

// DELETE role
router.delete('/:id', (req, res) => {
  const role = getRoleById.get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  if (!canManageRole(req.user.id, req.params.id)) {
    auditLog(req.user.id, 'hierarchy_violation', 'role', req.params.id, { reason: 'Attempted to delete higher role' }, req.ip);
    return res.status(403).json({ error: 'You cannot delete this role (equal or higher authority).' });
  }

  if (isProtectedRole(req.params.id)) {
    return res.status(403).json({ error: 'Protected roles cannot be deleted.' });
  }

  if (role.name === 'owner') {
    const ownerCount = countOwners();
    if (ownerCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last owner role.' });
    }
  }

  deleteRole.run(req.params.id);
  logRoleAction.run(req.user.id, 'role_deleted', req.params.id, JSON.stringify({ name: role.name }));
  auditLog(req.user.id, 'role_deleted', 'role', req.params.id, { name: role.name }, req.ip);
  res.json({ ok: true });
});

// PUT /:id/permissions – set permissions with filtering
router.put('/:id/permissions', (req, res) => {
  const role = getRoleById.get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  if (!canManageRole(req.user.id, req.params.id)) {
    auditLog(req.user.id, 'hierarchy_violation', 'role', req.params.id, { reason: 'Attempted to change permissions of higher role' }, req.ip);
    return res.status(403).json({ error: 'You cannot change permissions for this role.' });
  }

  if (isProtectedRole(req.params.id) && !req.user.roles.includes('owner')) {
    return res.status(403).json({ error: 'Cannot change permissions of protected roles.' });
  }

  const { permissionIds } = req.body;
  if (!Array.isArray(permissionIds)) return res.status(400).json({ error: 'permissionIds must be an array' });

  // Permission visibility filtering
  const actorPermissions = req.user.permissions || [];
  const allPerms = getAllPermissions.all().reduce((map, p) => { map[p.id] = p.name; return map; }, {});
  const currentPerms = getRolePermissions.all(role.id).map(p => p.id);

  const hiddenPerms = currentPerms.filter(pid => !actorPermissions.includes(allPerms[pid]));
  const allowedPerms = permissionIds.filter(pid => actorPermissions.includes(allPerms[pid]));

  const finalPerms = [...new Set([...hiddenPerms, ...allowedPerms])];

  const invalid = permissionIds.filter(pid => !actorPermissions.includes(allPerms[pid]));
  if (invalid.length > 0) {
    console.warn(`User ${req.user.id} tried to grant permissions they don't have:`, invalid.map(id => allPerms[id]));
    auditLog(req.user.id, 'permission_attempt', 'role', role.id, { attempted: invalid.map(id => allPerms[id]), result: 'filtered' }, req.ip);
  }

  setRolePermissions(role.id, finalPerms);
  logRoleAction.run(req.user.id, 'role_permissions_updated', req.params.id, JSON.stringify({ permissionIds: finalPerms }));
  auditLog(req.user.id, 'role_permissions_updated', 'role', req.params.id, { permissionIds: finalPerms }, req.ip);
  res.json({ ok: true, hidden: hiddenPerms.length, final: finalPerms });
});

module.exports = router;