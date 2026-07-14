// scripts/add-owners.js
// Run this once to assign the 'owner' role to all users listed in OWNER_DISCORD_IDS.
// Usage: node scripts/add-owners.js

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'hypercity.sqlite');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const OWNER_IDS = (process.env.OWNER_DISCORD_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (OWNER_IDS.length === 0) {
  console.log('No OWNER_DISCORD_IDS defined in .env. Nothing to do.');
  process.exit(0);
}

console.log(`Adding owner role to users with Discord IDs: ${OWNER_IDS.join(', ')}`);

const getOwnerRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');
const ownerRole = getOwnerRoleId.get('owner');
if (!ownerRole) {
  console.error('ERROR: "owner" role not found in the database. Run schema.sql first.');
  process.exit(1);
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by)
  SELECT id, ?, NULL
  FROM users
  WHERE discord_id = ?
`);

let assigned = 0;
for (const discordId of OWNER_IDS) {
  const result = insertStmt.run(ownerRole.id, discordId);
  if (result.changes > 0) {
    console.log(`✅ Assigned owner role to Discord ID: ${discordId}`);
    assigned++;
  } else {
    console.log(`⚠️ No user found for Discord ID: ${discordId} (they may not have logged in yet)`);
  }
}

console.log(`Done. ${assigned} users assigned owner role.`);
db.close();