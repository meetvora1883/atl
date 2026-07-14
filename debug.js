const db = require('./db');

const discordId = '1342054101399375875'; // replace with your actual ID

// Fetch the user
const user = db.db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
if (!user) { console.log('User not found'); process.exit(); }

console.log('User:', user.username);

// Check roles
const roles = db.getUserRoles.all(user.id);
console.log('Roles:', roles.map(r => r.name));

// Check permissions
const perms = db.getUserPermissions.all(user.id);
console.log('Permissions:', perms.map(p => p.name));

// Check role_permissions for owner role
const ownerPerms = db.db.prepare(`
  SELECT p.name FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  JOIN roles r ON r.id = rp.role_id
  WHERE r.name = 'owner'
`).all();
console.log('Owner role permissions:', ownerPerms.map(p => p.name));