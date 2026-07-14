const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/roles');
const { getPlayers, syncGuildMembers } = require('./api/warboard');

router.use(requireAuth);

function getBuilding(buildingId) {
  return db.prepare(`SELECT id, name, capacity, max_shields FROM warboard_buildings WHERE id = ?`).get(buildingId);
}

function serializePlayer(row) {
  if (!row) return null;
  return {
    userId: row.user_id ?? row.id,
    username: row.username,
    avatar: row.avatar,
    storedMight: row.might ?? null,
    discordId: row.discord_id ?? null
  };
}

function ensureUser(discordId, username, avatar) {
  const existing = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordId);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO users (discord_id, username, avatar, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(discordId, username || 'Unknown', avatar || null);
  return info.lastInsertRowid;
}

function getPlanForBuilding(buildingId) {
  const building = getBuilding(buildingId);
  if (!building) return null;
  const slots = db.prepare(`
    SELECT ap.position, ap.our_might, ap.opponent_might, ap.updated_at,
           u.id AS user_id, u.username, u.avatar, u.discord_id,
           ps.might AS stored_might
    FROM attack_plans ap
    JOIN users u ON u.id = ap.user_id
    LEFT JOIN player_stats ps ON ps.user_id = u.id
    WHERE ap.building_id = ?
    ORDER BY ap.position ASC
  `).all(buildingId);
  const backups = db.prepare(`
    SELECT apb.id AS backup_id, apb.display_order, u.id AS user_id, u.username, u.avatar, u.discord_id,
           ps.might AS stored_might
    FROM attack_plan_backups apb
    JOIN users u ON u.id = apb.user_id
    LEFT JOIN player_stats ps ON ps.user_id = u.id
    WHERE apb.building_id = ?
    ORDER BY apb.display_order ASC
  `).all(buildingId);
  return {
    building: { id: building.id, name: building.name, capacity: building.capacity, maxShields: building.max_shields ?? building.capacity },
    slots: slots.map(s => ({ position: s.position, ourMight: s.our_might, opponentMight: s.opponent_might, updatedAt: s.updated_at, player: serializePlayer(s) })),
    backups: backups.map(b => ({ backupId: b.backup_id, displayOrder: b.display_order, player: serializePlayer(b) }))
  };
}

router.get('/', requirePermission('view_attack_plans'), (req, res) => {
  const buildings = db.prepare(`
    SELECT wb.id, wb.name, wb.capacity, wb.max_shields, COUNT(ap.id) AS filled_slots
    FROM warboard_buildings wb
    LEFT JOIN attack_plans ap ON ap.building_id = wb.id
    GROUP BY wb.id ORDER BY wb.name ASC
  `).all();
  res.json({ buildings: buildings.map(b => ({ id: b.id, name: b.name, capacity: b.capacity, maxShields: b.max_shields ?? b.capacity, filledSlots: b.filled_slots })) });
});

router.get('/players', requirePermission('view_attack_plans'), async (req, res) => {
  try {
    await syncGuildMembers();
    let guildMembers = await getPlayers();
    if (!Array.isArray(guildMembers) || guildMembers.length === 0) {
      await syncGuildMembers();
      guildMembers = await getPlayers();
    }
    if (!Array.isArray(guildMembers)) return res.json({ players: [] });
    guildMembers.forEach(p => ensureUser(p.discordId, p.username || p.name, p.avatar));
    const playersWithDetails = guildMembers.map(p => {
      const userRow = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(p.discordId);
      const userId = userRow ? userRow.id : null;
      const mightRow = userId ? db.prepare('SELECT might FROM player_stats WHERE user_id = ?').get(userId) : null;
      const storedMight = mightRow ? mightRow.might : null;
      const attackAssignments = userId ? db.prepare(`
        SELECT wb.name FROM attack_plans ap JOIN warboard_buildings wb ON wb.id = ap.building_id WHERE ap.user_id = ?
      `).all(userId).map(row => row.name) : [];
      const backupAssignments = userId ? db.prepare(`
        SELECT wb.name FROM attack_plan_backups apb JOIN warboard_buildings wb ON wb.id = apb.building_id WHERE apb.user_id = ?
      `).all(userId).map(row => row.name) : [];
      return { userId: p.discordId, discordId: p.discordId, username: p.name || p.username, avatar: p.avatar, storedMight, attackAssignments, backupAssignments };
    });
    const q = (req.query.q || '').trim().toLowerCase();
    let filtered = q ? playersWithDetails.filter(p => (p.username && p.username.toLowerCase().includes(q)) || (p.discordId && p.discordId.includes(q)) || (p.storedMight && p.storedMight.toLowerCase().includes(q))) : playersWithDetails;
    filtered.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    res.json({ players: filtered });
  } catch (err) {
    console.error('[Attack Plans] Error fetching players:', err);
    res.status(500).json({ error: 'Failed to load players: ' + err.message });
  }
});

router.get('/:buildingId', requirePermission('view_attack_plans'), (req, res) => {
  const plan = getPlanForBuilding(req.params.buildingId);
  if (!plan) return res.status(404).json({ error: 'Building not found.' });
  res.json(plan);
});

router.post('/', requirePermission('manage_attack_plans'), (req, res) => {
  const { buildingId, position, userId, ourMight, opponentMight } = req.body || {};
  if (!buildingId || position === undefined || position === null || !userId)
    return res.status(400).json({ error: 'buildingId, position and userId are required.' });
  const building = getBuilding(buildingId);
  if (!building) return res.status(404).json({ error: 'Building not found.' });
  if (position < 0 || position >= building.capacity)
    return res.status(400).json({ error: 'Position is out of range for this building.' });
  const existingSlot = db.prepare(`SELECT id FROM attack_plans WHERE building_id = ? AND position = ?`).get(buildingId, position);
  if (existingSlot) return res.status(409).json({ error: 'Slot already occupied.' });
  let internalUserId = null;
  try {
    const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(userId);
    internalUserId = user ? user.id : db.prepare(`INSERT INTO users (discord_id, username, created_at) VALUES (?, ?, datetime('now'))`).run(userId, 'Unknown_' + userId.slice(-4)).lastInsertRowid;
  } catch (err) {
    console.error('[Attack Plans] Error ensuring user:', err);
    return res.status(500).json({ error: 'Failed to ensure user exists.' });
  }
  try {
    db.prepare(`INSERT INTO attack_plans (building_id, position, user_id, our_might, opponent_might, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(building_id, position) DO UPDATE SET user_id = excluded.user_id, our_might = excluded.our_might, opponent_might = excluded.opponent_might, updated_at = datetime('now')`)
      .run(buildingId, position, internalUserId, ourMight ?? null, opponentMight ?? null);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Conflict: player or slot already occupied.' });
    console.error('[Attack Plans] POST error:', err);
    return res.status(500).json({ error: 'Could not save attack slot.' });
  }
  res.json(getPlanForBuilding(buildingId));
});

router.put('/', requirePermission('manage_attack_plans'), (req, res) => {
  const { buildingId, position, ourMight, opponentMight } = req.body || {};
  if (!buildingId || position === undefined || position === null)
    return res.status(400).json({ error: 'buildingId and position are required.' });
  const result = db.prepare(`UPDATE attack_plans SET our_might = ?, opponent_might = ?, updated_at = datetime('now') WHERE building_id = ? AND position = ?`)
    .run(ourMight ?? null, opponentMight ?? null, buildingId, position);
  if (result.changes === 0) return res.status(404).json({ error: 'Slot not found. Assign a player first.' });
  res.json(getPlanForBuilding(buildingId));
});

router.delete('/:buildingId/:position', requirePermission('manage_attack_plans'), (req, res) => {
  const { buildingId, position } = req.params;
  db.prepare(`DELETE FROM attack_plans WHERE building_id = ? AND position = ?`).run(buildingId, position);
  res.json(getPlanForBuilding(buildingId));
});

router.post('/backups', requirePermission('manage_attack_plans'), (req, res) => {
  const { buildingId, userId, displayOrder } = req.body || {};
  if (!buildingId || !userId) return res.status(400).json({ error: 'buildingId and userId are required.' });
  const building = getBuilding(buildingId);
  if (!building) return res.status(404).json({ error: 'Building not found.' });
  let internalUserId = null;
  try {
    const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(userId);
    internalUserId = user ? user.id : db.prepare(`INSERT INTO users (discord_id, username, created_at) VALUES (?, ?, datetime('now'))`).run(userId, 'Unknown_' + userId.slice(-4)).lastInsertRowid;
  } catch (err) {
    console.error('[Attack Plans] Error ensuring user for backup:', err);
    return res.status(500).json({ error: 'Failed to ensure user exists.' });
  }
  const existing = db.prepare(`SELECT id FROM attack_plan_backups WHERE building_id = ? AND user_id = ?`).get(buildingId, internalUserId);
  if (existing) return res.status(409).json({ error: 'Player already in backups for this building.' });
  let order = displayOrder;
  if (order === undefined || order === null) {
    const max = db.prepare(`SELECT COALESCE(MAX(display_order), -1) AS m FROM attack_plan_backups WHERE building_id = ?`).get(buildingId);
    order = max.m + 1;
  }
  try {
    db.prepare(`INSERT INTO attack_plan_backups (building_id, user_id, display_order, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(building_id, user_id) DO UPDATE SET display_order = excluded.display_order, updated_at = datetime('now')`)
      .run(buildingId, internalUserId, order);
  } catch (err) {
    console.error('[Attack Plans] Backup POST error:', err);
    return res.status(500).json({ error: 'Could not save backup player.' });
  }
  res.json(getPlanForBuilding(buildingId));
});

router.delete('/backups/:id', requirePermission('manage_attack_plans'), (req, res) => {
  const row = db.prepare(`SELECT building_id FROM attack_plan_backups WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Backup entry not found.' });
  db.prepare(`DELETE FROM attack_plan_backups WHERE id = ?`).run(req.params.id);
  res.json(getPlanForBuilding(row.building_id));
});

router.post('/clear', requirePermission('manage_attack_plans'), (req, res) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM attack_plans').run();
      db.prepare('DELETE FROM attack_plan_backups').run();
    })();
    res.json({ success: true });
  } catch (err) {
    console.error('[Attack Plans] Clear all error:', err);
    res.status(500).json({ error: 'Failed to clear attack planning data.' });
  }
});

module.exports = router;