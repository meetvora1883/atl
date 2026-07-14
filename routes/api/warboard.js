const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

// ============================================================
// MULTER SETUP – Hero images (original + thumbnail)
// ============================================================
const heroUploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'warboard', 'heroes');
const thumbUploadDir = path.join(heroUploadDir, 'thumbs');
if (!fs.existsSync(heroUploadDir)) fs.mkdirSync(heroUploadDir, { recursive: true });
if (!fs.existsSync(thumbUploadDir)) fs.mkdirSync(thumbUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, heroUploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9).toString(36);
    const ext = path.extname(file.originalname);
    const cleanName = `hero_${timestamp}_${random}${ext}`;
    cb(null, cleanName);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ============================================================
// GUILD MEMBERS CACHE
// ============================================================
let guildMembersCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !botToken) {
    console.warn('[Warboard] Guild ID or Bot Token missing.');
    return null;
  }
  try {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`;
    const res = await fetch(url, { headers: { 'Authorization': `Bot ${botToken}` } });
    if (!res.ok) {
      console.error(`[Warboard] Discord API error: ${res.status} ${res.statusText}`);
      return null;
    }
    const members = await res.json();
    return members.map(m => {
      const user = m.user;
      let avatar;
      if (user.avatar) {
        avatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`;
      } else {
        const discrim = parseInt(user.discriminator || '0');
        let index;
        if (discrim === 0) {
          index = parseInt(user.id) % 6;
        } else {
          index = discrim % 5;
        }
        avatar = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
      }
      return {
        discordId: user.id,
        name: user.global_name || user.username,
        username: user.username,
        avatar: avatar,
        inGuild: true
      };
    });
  } catch (err) {
    console.error('[Warboard] Failed to fetch guild members:', err.message);
    return null;
  }
}

async function getPlayers() {
  const now = Date.now();
  if (guildMembersCache && guildMembersCache.length > 0 && (now - cacheTime) < CACHE_TTL) {
    return guildMembersCache;
  }
  const members = await fetchGuildMembers();
  if (Array.isArray(members) && members.length > 0) {
    guildMembersCache = members;
    cacheTime = now;
    console.log(`[Warboard] Guild cache updated: ${members.length} members`);
    return members;
  }
  console.warn('[Warboard] Discord unavailable. Using cached/database users.');
  if (guildMembersCache && guildMembersCache.length > 0) {
    return guildMembersCache;
  }
  const dbUsers = db.prepare('SELECT discord_id, username, avatar FROM users ORDER BY username').all();
  return dbUsers.map(u => ({
    discordId: u.discord_id,
    name: u.username,
    username: u.username,
    avatar: u.avatar || `https://cdn.discordapp.com/embed/avatars/${Math.floor(Math.random() * 6)}.png`,
    inGuild: true
  }));
}

function getAvatarFromCache(discordId) {
  if (!guildMembersCache) return null;
  const member = guildMembersCache.find(m => m.discordId === discordId);
  return member ? member.avatar : null;
}

function upsertUser(discordId, username) {
  const existing = db.prepare('SELECT id, avatar FROM users WHERE discord_id = ?').get(discordId);
  const avatar = getAvatarFromCache(discordId) || `https://cdn.discordapp.com/embed/avatars/0.png`;

  if (existing) {
    db.prepare(`
      UPDATE users
      SET username = ?,
          avatar = ?,
          updated_at = datetime('now')
      WHERE discord_id = ?
    `).run(username, avatar, discordId);
    return existing.id;
  } else {
    const info = db.prepare(`
      INSERT INTO users (discord_id, username, avatar, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(discordId, username, avatar);
    return info.lastInsertRowid;
  }
}

function getUserIdByDiscordId(discordId) {
  const row = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordId);
  return row ? row.id : null;
}

async function syncGuildMembers() {
  await getPlayers();
  if (!guildMembersCache || guildMembersCache.length === 0) {
    console.log('[Warboard] Guild cache still empty after sync attempt. Skipping cleanup.');
    return 0;
  }
  const members = guildMembersCache;
  const discordIdsInGuild = new Set(members.map(m => m.discordId));
  const garrisoned = db.prepare(`
    SELECT g.id, g.building_id, g.position, u.discord_id, u.username
    FROM warboard_garrison g
    LEFT JOIN users u ON u.id = g.user_id
    WHERE g.user_id IS NOT NULL
  `).all();
  let removed = 0;
  for (const entry of garrisoned) {
    if (!discordIdsInGuild.has(entry.discord_id)) {
      const verify = members.find(m => m.discordId === entry.discord_id);
      if (!verify) {
        db.prepare('DELETE FROM warboard_garrison WHERE id = ?').run(entry.id);
        const details = `Player "${entry.username}" left the guild and was removed from building ${entry.building_id}`;
        db.prepare(`
          INSERT INTO warboard_audit (building_id, action, target_id, details, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(entry.building_id, 'auto_removed', entry.discord_id, details);
        removed++;
        console.log(`[Warboard] Auto-removed ${entry.username} (${entry.discord_id}) from ${entry.building_id}`);
      }
    }
  }
  return removed;
}

// ============================================================
// CREATE TABLES (if not exist)
// ============================================================
db.prepare(`
  CREATE TABLE IF NOT EXISTS warboard_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id TEXT,
    action TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    actor_avatar TEXT,
    target_id TEXT,
    target_name TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    is_undo INTEGER DEFAULT 0,
    undoable INTEGER DEFAULT 1,
    undo_parent_id INTEGER,
    extra_data TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS warboard_log_undo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER NOT NULL,
    undo_log_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS warboard_dm_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// Legacy audit table (backward compatibility)
db.prepare(`
  CREATE TABLE IF NOT EXISTS warboard_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id TEXT,
    action TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT
  )
`).run();

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getActorInfo(req) {
  return {
    id: req.user ? req.user.id : null,
    name: req.user ? req.user.username : 'System',
    avatar: req.user ? req.user.avatar : null
  };
}

function getBuildingName(buildingId) {
  const row = db.prepare('SELECT name FROM warboard_buildings WHERE id = ?').get(buildingId);
  return row ? row.name : buildingId;
}

function insertLog({ buildingId, action, actorId, actorName, actorAvatar, targetId, targetName, details, isUndo = 0, undoable = 1, undoParentId = null, extraData = null }) {
  const stmt = db.prepare(`
    INSERT INTO warboard_logs
      (building_id, action, actor_id, actor_name, actor_avatar, target_id, target_name, details, is_undo, undoable, undo_parent_id, extra_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    buildingId || null,
    action,
    actorId || null,
    actorName || null,
    actorAvatar || null,
    targetId || null,
    targetName || null,
    details || null,
    isUndo ? 1 : 0,
    undoable ? 1 : 0,
    undoParentId || null,
    extraData ? JSON.stringify(extraData) : null
  );
  return { id: info.lastInsertRowid };
}

function emitLog(logEntry) {
  try {
    const io = require('../../server').io;
    if (io) {
      io.emit('warboard:log_new', { log: logEntry });
    }
  } catch (e) { /* ignore */ }
}

function emitBuildingUpdate(buildingId) {
  try {
    const io = require('../../server').io;
    if (io) {
      io.emit('warboard:building_updated', { buildingId });
    }
  } catch (e) { /* ignore */ }
}

function formatMight(value) {
  if (!value) return '';
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return value;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ============================================================
// MAIN WARBOARD ENDPOINT
// ============================================================
router.get('/', requirePermission('view_warboard'), async (req, res) => {
  try {
    const players = await getPlayers();
    await syncGuildMembers();

    // Fetch might stats
    const statsMap = {};
    const statsRows = db.prepare('SELECT user_id, might FROM player_stats').all();
    statsRows.forEach(row => {
      statsMap[row.user_id] = row.might;
    });

    const userMap = {};
    const users = db.prepare('SELECT id, discord_id FROM users').all();
    users.forEach(u => {
      userMap[u.discord_id] = u.id;
    });

    const enrichedPlayers = players.map(p => {
      const userId = userMap[p.discordId];
      const might = userId ? (statsMap[userId] || null) : null;
      return { ...p, might };
    });

    const buildings = db.prepare(`SELECT b.id, b.name, b.capacity, b.max_shields FROM warboard_buildings b`).all();

    const allGarrisons = db.prepare(`
      SELECT
        g.building_id,
        g.position,
        g.user_id,
        g.external_player_id,
        u.discord_id,
        u.username AS user_username,
        u.avatar AS user_avatar,
        e.player_name AS ext_name,
        e.discord_id AS ext_discord_id,
        e.might AS ext_might,
        ps.might AS user_might
      FROM warboard_garrison g
      LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN warboard_external_players e ON e.id = g.external_player_id
      LEFT JOIN player_stats ps ON ps.user_id = g.user_id
      ORDER BY g.building_id, g.position
    `).all();

    const garrisonMap = {};
    allGarrisons.forEach(row => {
      if (!garrisonMap[row.building_id]) garrisonMap[row.building_id] = {};
      const player = {};
      if (row.user_id) {
        player.type = 'discord';
        player.user_id = row.user_id;
        player.discordId = row.discord_id;
        player.username = row.user_username || 'Unknown';
        player.avatar = row.user_avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
        player.might = row.user_might || null;
      } else if (row.external_player_id) {
        player.type = 'external';
        player.external_player_id = row.external_player_id;
        player.username = row.ext_name || 'Unknown';
        player.discordId = row.ext_discord_id || null;
        player.avatar = null;
        player.might = row.ext_might || null;
      }
      garrisonMap[row.building_id][row.position] = player;
    });

    const response = {
      buildings: buildings.map(b => {
        const garrisons = garrisonMap[b.id] || {};
        const slots = [];
        for (let i = 0; i < b.capacity; i++) {
          const player = garrisons[i] || null;
          slots.push({
            slot: i,
            occupied: player !== null,
            player: player
          });
        }
        return {
          id: b.id,
          name: b.name,
          capacity: b.capacity,
          maxShields: b.max_shields || b.capacity,
          filledSlots: Object.keys(garrisons).length,
          garrisonSlots: slots
        };
      }),
      players: enrichedPlayers
    };

    res.json(response);
  } catch (err) {
    console.error('[Warboard] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch warboard data' });
  }
});

// ============================================================
// GARRISON ENDPOINTS
// ============================================================
router.get('/garrison/:buildingId', requirePermission('view_warboard'), (req, res) => {
  try {
    const { buildingId } = req.params;
    const building = db.prepare('SELECT capacity FROM warboard_buildings WHERE id = ?').get(buildingId);
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const rows = db.prepare(`
      SELECT
        g.position,
        g.user_id,
        g.external_player_id,
        u.discord_id,
        u.username AS user_username,
        u.avatar AS user_avatar,
        e.player_name AS ext_name,
        e.discord_id AS ext_discord_id,
        e.might AS ext_might,
        ps.might AS user_might
      FROM warboard_garrison g
      LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN warboard_external_players e ON e.id = g.external_player_id
      LEFT JOIN player_stats ps ON ps.user_id = g.user_id
      WHERE g.building_id = ?
      ORDER BY g.position ASC
    `).all(buildingId);

    const garrisons = {};
    rows.forEach(r => {
      const player = {};
      if (r.user_id) {
        player.type = 'discord';
        player.user_id = r.user_id;
        player.discordId = r.discord_id;
        player.username = r.user_username || 'Unknown';
        player.avatar = r.user_avatar || `https://cdn.discordapp.com/embed/avatars/0.png`;
        player.might = r.user_might || null;
      } else if (r.external_player_id) {
        player.type = 'external';
        player.external_player_id = r.external_player_id;
        player.username = r.ext_name || 'Unknown';
        player.discordId = r.ext_discord_id || null;
        player.avatar = null;
        player.might = r.ext_might || null;
      }
      garrisons[r.position] = player;
    });

    const slots = [];
    for (let i = 0; i < building.capacity; i++) {
      const player = garrisons[i] || null;
      slots.push({
        slot: i,
        occupied: player !== null,
        player: player
      });
    }
    res.json({ buildingId, capacity: building.capacity, garrisonSlots: slots });
  } catch (err) {
    console.error('[Warboard] GET /garrison/:buildingId error:', err);
    res.status(500).json({ error: 'Failed to fetch garrison' });
  }
});

router.post('/garrison', requirePermission('manage_warboard'), (req, res) => {
  console.log('[Warboard] POST /garrison - request body:', req.body);
  try {
    const { buildingId, slot, userId, username, might, playerType, externalPlayerId } = req.body;
    if (!buildingId || slot === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let internalUserId = null;
    let externalId = null;

    if (playerType === 'discord' && userId) {
      internalUserId = upsertUser(userId, username || 'Unknown');
      console.log(`[Warboard] Discord user ${userId} (${username}) mapped to internal id ${internalUserId}`);
    } else if (playerType === 'external' && externalPlayerId) {
      externalId = externalPlayerId;
    } else {
      return res.status(400).json({ error: 'Invalid player type or missing ID' });
    }

    // Check if slot is free
    const existing = db.prepare('SELECT id FROM warboard_garrison WHERE building_id = ? AND position = ?')
      .get(buildingId, slot);
    if (existing) {
      return res.status(409).json({ error: 'Garrison slot already occupied' });
    }

    const building = db.prepare('SELECT capacity FROM warboard_buildings WHERE id = ?').get(buildingId);
    if (!building) return res.status(404).json({ error: 'Building not found' });
    if (slot >= building.capacity) return res.status(400).json({ error: 'Slot out of range' });

    // Save might for Discord user
    if (playerType === 'discord' && internalUserId && might !== undefined && might !== null && might !== '') {
      db.prepare(`
        INSERT INTO player_stats (user_id, might)
        VALUES (?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET might = excluded.might, updated_at = datetime('now')
      `).run(internalUserId, might);
    }

    // Save might for external player
    if (playerType === 'external' && externalId && might !== undefined && might !== null && might !== '') {
      db.prepare('UPDATE warboard_external_players SET might = ? WHERE id = ?').run(might, externalId);
    }

    // Insert garrison
    const stmt = db.prepare('INSERT INTO warboard_garrison (building_id, user_id, external_player_id, position) VALUES (?, ?, ?, ?)');
    stmt.run(buildingId, internalUserId, externalId, slot);

    // Determine player name
    let playerName = 'Unknown';
    if (playerType === 'discord') playerName = username;
    else if (playerType === 'external' && externalPlayerId) {
      const ext = db.prepare('SELECT player_name FROM warboard_external_players WHERE id = ?').get(externalPlayerId);
      if (ext) playerName = ext.player_name;
    }

    // Log the assignment
    const buildingName = getBuildingName(buildingId);
    const actor = getActorInfo(req);
    const details = `Assigned ${playerName} to ${buildingName} slot ${slot+1}`;
    const extraData = { buildingId, slot, playerType, playerId: playerType === 'discord' ? userId : externalId, buildingName };
    const logEntry = insertLog({
      buildingId,
      action: 'assign',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: playerType === 'discord' ? userId : externalId,
      targetName: playerName,
      details,
      undoable: 1,
      extraData
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);
    emitBuildingUpdate(buildingId);

    // Legacy audit
    db.prepare(`
      INSERT INTO warboard_audit (building_id, action, target_id, details, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(buildingId, 'add', playerType === 'discord' ? userId : externalId, `Added ${playerName} to Garrison slot ${slot+1}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] POST /garrison error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/garrison/:buildingId/:slot', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { buildingId, slot } = req.params;
    const garrison = db.prepare(`
      SELECT g.id, g.user_id, g.external_player_id,
             u.discord_id, u.username, e.player_name AS ext_name,
             e.id as ext_id
      FROM warboard_garrison g
      LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN warboard_external_players e ON e.id = g.external_player_id
      WHERE g.building_id = ? AND g.position = ?
    `).get(buildingId, slot);
    if (!garrison) return res.status(404).json({ error: 'No player at that garrison slot' });

    const playerName = garrison.username || garrison.ext_name || 'Unknown';
    const playerType = garrison.user_id ? 'discord' : 'external';
    const playerId = garrison.user_id || garrison.ext_id;

    db.prepare('DELETE FROM warboard_garrison WHERE id = ?').run(garrison.id);

    const buildingName = getBuildingName(buildingId);
    const actor = getActorInfo(req);
    const details = `Removed ${playerName} from ${buildingName} slot ${parseInt(slot)+1}`;
    const extraData = { buildingId, slot: parseInt(slot), playerType, playerId, buildingName };
    const logEntry = insertLog({
      buildingId,
      action: 'remove',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: playerId,
      targetName: playerName,
      details,
      undoable: 1,
      extraData
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);
    emitBuildingUpdate(buildingId);

    // Legacy audit
    db.prepare(`
      INSERT INTO warboard_audit (building_id, action, target_id, details, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(buildingId, 'remove', playerName, `Removed ${playerName} from Garrison slot ${parseInt(slot)+1}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] DELETE /garrison/:buildingId/:slot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/garrison/swap', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { buildingId, slot1, slot2 } = req.body;
    const getEntry = db.prepare('SELECT user_id, external_player_id FROM warboard_garrison WHERE building_id = ? AND position = ?');
    const entry1 = getEntry.get(buildingId, slot1);
    const entry2 = getEntry.get(buildingId, slot2);
    if (!entry1 || !entry2) return res.status(404).json({ error: 'One of the garrison slots is empty' });

    const getPlayerName = (entry) => {
      if (entry.user_id) {
        const u = db.prepare('SELECT username FROM users WHERE id = ?').get(entry.user_id);
        return u ? u.username : 'Unknown';
      } else if (entry.external_player_id) {
        const e = db.prepare('SELECT player_name FROM warboard_external_players WHERE id = ?').get(entry.external_player_id);
        return e ? e.player_name : 'External';
      }
      return 'Unknown';
    };
    const player1 = getPlayerName(entry1);
    const player2 = getPlayerName(entry2);

    db.prepare('UPDATE warboard_garrison SET user_id = ?, external_player_id = ? WHERE building_id = ? AND position = ?')
      .run(entry2.user_id, entry2.external_player_id, buildingId, slot1);
    db.prepare('UPDATE warboard_garrison SET user_id = ?, external_player_id = ? WHERE building_id = ? AND position = ?')
      .run(entry1.user_id, entry1.external_player_id, buildingId, slot2);

    const buildingName = getBuildingName(buildingId);
    const actor = getActorInfo(req);
    const details = `Swapped ${player1} and ${player2} in ${buildingName}`;
    const extraData = { buildingId, fromSlot: slot1, toSlot: slot2, player1, player2 };
    const logEntry = insertLog({
      buildingId,
      action: 'move',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: null,
      targetName: `${player1} ↔ ${player2}`,
      details,
      undoable: 1,
      extraData
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);
    emitBuildingUpdate(buildingId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] PUT /garrison/swap error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// EXTERNAL PLAYERS CRUD
// ============================================================
router.get('/external', requirePermission('manage_warboard'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT e.*,
        g.building_id,
        b.name AS building_name,
        g.position
      FROM warboard_external_players e
      LEFT JOIN warboard_garrison g ON g.external_player_id = e.id
      LEFT JOIN warboard_buildings b ON b.id = g.building_id
      ORDER BY e.player_name
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('[Warboard] GET /external error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/external', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { player_name, discord_id, might } = req.body;
    if (!player_name) return res.status(400).json({ error: 'Player name is required' });
    const stmt = db.prepare('INSERT INTO warboard_external_players (player_name, discord_id, might) VALUES (?, ?, ?)');
    const info = stmt.run(player_name, discord_id || null, might || null);

    const actor = getActorInfo(req);
    const details = `Added external player ${player_name}`;
    const logEntry = insertLog({
      buildingId: null,
      action: 'external_add',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: info.lastInsertRowid,
      targetName: player_name,
      details,
      undoable: 1,
      extraData: { player_name, discord_id, might }
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);

    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error('[Warboard] POST /external error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/external/:id', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { player_name, discord_id, might } = req.body;
    const stmt = db.prepare('UPDATE warboard_external_players SET player_name = COALESCE(?, player_name), discord_id = COALESCE(?, discord_id), might = COALESCE(?, might) WHERE id = ?');
    stmt.run(player_name || null, discord_id || null, might || null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] PUT /external/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/external/:id', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { id } = req.params;
    const player = db.prepare('SELECT * FROM warboard_external_players WHERE id = ?').get(id);
    if (!player) return res.status(404).json({ error: 'External player not found' });

    const assignment = db.prepare(`
      SELECT g.building_id, g.position, b.name AS building_name
      FROM warboard_garrison g
      JOIN warboard_buildings b ON b.id = g.building_id
      WHERE g.external_player_id = ?
    `).get(id);

    if (assignment) {
      return res.status(409).json({
        error: 'Player is currently assigned to the Warboard.',
        assigned: true,
        buildingName: assignment.building_name,
        slot: assignment.position
      });
    }

    db.prepare('DELETE FROM warboard_external_players WHERE id = ?').run(id);

    const actor = getActorInfo(req);
    const details = `Deleted external player ${player.player_name}`;
    const logEntry = insertLog({
      buildingId: null,
      action: 'external_delete',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: id,
      targetName: player.player_name,
      details,
      undoable: 0,
      extraData: { player_name: player.player_name }
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] DELETE /external/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// HERO IMAGES
// ============================================================
router.get('/heroes', requirePermission('view_warboard'), (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id' });
    }
    if (!['discord', 'external'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const column = type === 'discord' ? 'user_id' : 'external_player_id';
    const rows = db.prepare(`
      SELECT id, image_path, display_order, created_at
      FROM player_hero_images
      WHERE player_type = ? AND ${column} = ?
      ORDER BY created_at DESC
    `).all(type, id);
    res.json(rows);
  } catch (err) {
    console.error('[Warboard] GET /heroes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/heroes', requirePermission('manage_warboard'), upload.array('images', 10), async (req, res) => {
  try {
    const { playerType, userId, externalPlayerId } = req.body;

    if (!playerType || !['discord', 'external'].includes(playerType)) {
      return res.status(400).json({ error: 'Invalid playerType' });
    }

    let resolvedUserId = null;
    let resolvedExternalId = null;
    let playerName = 'Unknown';

    if (playerType === 'discord') {
      if (!userId) return res.status(400).json({ error: 'userId required for discord' });
      resolvedUserId = getUserIdByDiscordId(userId);
      if (!resolvedUserId) {
        return res.status(400).json({ error: 'Discord user not found. Please assign them to a garrison first.' });
      }
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(resolvedUserId);
      if (user) playerName = user.username;
    } else if (playerType === 'external') {
      if (!externalPlayerId) return res.status(400).json({ error: 'externalPlayerId required for external' });
      const ext = db.prepare('SELECT id, player_name FROM warboard_external_players WHERE id = ?').get(externalPlayerId);
      if (!ext) return res.status(400).json({ error: 'External player not found' });
      resolvedExternalId = externalPlayerId;
      playerName = ext.player_name;
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    const basePath = '/uploads/warboard/heroes/';
    const stmt = db.prepare(`
      INSERT INTO player_hero_images
        (player_type, user_id, external_player_id, image_path, display_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    const inserted = [];
    for (let index = 0; index < req.files.length; index++) {
      const file = req.files[index];
      const imagePath = basePath + file.filename;
      const info = stmt.run(
        playerType,
        resolvedUserId || null,
        resolvedExternalId || null,
        imagePath,
        index
      );
      inserted.push({ id: info.lastInsertRowid, image_path: imagePath });
    }

    const actor = getActorInfo(req);
    const details = `Uploaded ${inserted.length} hero image(s) for ${playerName}`;
    const logEntry = insertLog({
      buildingId: null,
      action: 'hero_upload',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: playerType === 'discord' ? userId : externalPlayerId,
      targetName: playerName,
      details,
      undoable: 0,
      extraData: { count: inserted.length, playerType, playerId: playerType === 'discord' ? userId : externalPlayerId }
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);

    res.json({ ok: true, inserted });
  } catch (err) {
    console.error('[Warboard] POST /heroes error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

router.delete('/heroes/:id', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare('SELECT image_path, player_type, user_id, external_player_id FROM player_hero_images WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const fullPath = path.join(__dirname, '..', '..', 'public', row.image_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = fullPath.replace('/heroes/', '/heroes/thumbs/');
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    let playerName = 'Unknown';
    if (row.player_type === 'discord' && row.user_id) {
      const u = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id);
      if (u) playerName = u.username;
    } else if (row.player_type === 'external' && row.external_player_id) {
      const e = db.prepare('SELECT player_name FROM warboard_external_players WHERE id = ?').get(row.external_player_id);
      if (e) playerName = e.player_name;
    }

    db.prepare('DELETE FROM player_hero_images WHERE id = ?').run(id);

    const actor = getActorInfo(req);
    const details = `Deleted hero image for ${playerName}`;
    const logEntry = insertLog({
      buildingId: null,
      action: 'hero_delete',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: row.user_id || row.external_player_id || null,
      targetName: playerName,
      details,
      undoable: 0,
      extraData: { imageId: id }
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] DELETE /heroes/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// VIEW ALL – Player Heroes Page
// ============================================================
router.get('/player/:playerType/:playerId/heroes', requirePermission('view_warboard'), (req, res) => {
  try {
    const { playerType, playerId } = req.params;
    if (!['discord', 'external'].includes(playerType)) {
      return res.status(400).send('Invalid player type');
    }

    let player = null;
    if (playerType === 'discord') {
      const user = db.prepare('SELECT id, discord_id, username FROM users WHERE id = ?').get(playerId);
      if (user) {
        player = {
          id: user.id,
          discordId: user.discord_id,
          name: user.username,
          type: 'discord'
        };
      }
    } else {
      const ext = db.prepare('SELECT id, player_name, discord_id FROM warboard_external_players WHERE id = ?').get(playerId);
      if (ext) {
        player = {
          id: ext.id,
          discordId: ext.discord_id,
          name: ext.player_name,
          type: 'external'
        };
      }
    }

    if (!player) {
      return res.status(404).send('Player not found');
    }

    const images = db.prepare(`
      SELECT id, image_path, created_at
      FROM player_hero_images
      WHERE player_type = ? AND ${playerType === 'discord' ? 'user_id' : 'external_player_id'} = ?
      ORDER BY created_at DESC
    `).all(playerType, playerId);

    res.render('warboard/player_heroes', {
      player,
      images,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  } catch (err) {
    console.error('[Warboard] GET /player/:playerType/:playerId/heroes error:', err);
    res.status(500).send('Internal server error');
  }
});

// ============================================================
// EXPORT
// ============================================================
router.get('/export', requirePermission('view_warboard'), (req, res) => {
  try {
    const buildingOrder = [
      'boathouse', 'docks', 'eastern_bridge', 'central_bridge', 'western_bridge',
      'main_gate', 'scriptorium', 'laboratory', 'tower_of_elements', 'tower_of_foresight', 'citadel'
    ];

    const buildings = db.prepare('SELECT id, name, capacity, max_shields FROM warboard_buildings').all();
    const buildingMap = {};
    buildings.forEach(b => buildingMap[b.id] = b);

    const garrisons = db.prepare(`
      SELECT
        g.building_id,
        g.position,
        g.user_id,
        g.external_player_id,
        u.discord_id AS user_discord,
        u.username AS user_name,
        e.player_name AS ext_name,
        e.discord_id AS ext_discord,
        ps.might AS user_might,
        e.might AS ext_might
      FROM warboard_garrison g
      LEFT JOIN users u ON u.id = g.user_id
      LEFT JOIN warboard_external_players e ON e.id = g.external_player_id
      LEFT JOIN player_stats ps ON ps.user_id = g.user_id
      ORDER BY g.building_id, g.position
    `).all();

    const garrisonMap = {};
    garrisons.forEach(g => {
      if (!garrisonMap[g.building_id]) garrisonMap[g.building_id] = [];
      let player = {};
      if (g.user_id) {
        player.type = 'discord';
        player.displayName = g.user_name || 'Unknown';
        player.mention = `<@${g.user_discord}>`;
        player.might = g.user_might || null;
        player.discordId = g.user_discord;
      } else if (g.external_player_id) {
        player.type = 'external';
        player.displayName = g.ext_name || 'Unknown';
        player.mention = g.ext_discord ? `<@${g.ext_discord}>` : g.ext_name;
        player.might = g.ext_might || null;
        player.discordId = g.ext_discord || null;
      }
      garrisonMap[g.building_id].push(player);
    });

    const exportData = {
      buildings: [],
      totalFilled: 0,
      totalCapacity: 0
    };

    buildingOrder.forEach(id => {
      const building = buildingMap[id];
      if (!building) return;
      const players = garrisonMap[id] || [];
      const capacity = building.capacity || 0;
      const formattedPlayers = players.map(p => ({
        displayName: p.displayName,
        mention: p.mention,
        might: p.might ? formatMight(p.might) : null,
        type: p.type
      }));
      exportData.buildings.push({
        id: building.id,
        name: building.name,
        capacity: capacity,
        filled: players.length,
        players: formattedPlayers
      });
      exportData.totalFilled += players.length;
      exportData.totalCapacity += capacity;
    });

    res.json(exportData);
  } catch (err) {
    console.error('[Warboard Export] Error:', err);
    res.status(500).json({ error: 'Failed to fetch export data' });
  }
});

// ============================================================
// SYNC
// ============================================================
router.post('/sync', requirePermission('manage_warboard'), async (req, res) => {
  try {
    const members = await fetchGuildMembers();
    if (Array.isArray(members) && members.length > 0) {
      guildMembersCache = members;
      cacheTime = Date.now();
      const removed = await syncGuildMembers();
      res.json({ ok: true, count: members.length, removed });
    } else {
      res.status(500).json({ error: 'Failed to sync members' });
    }
  } catch (err) {
    console.error('[Warboard] POST /sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// LEGACY AUDIT
// ============================================================
router.get('/audit', requirePermission('manage_warboard'), (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM warboard_audit ORDER BY created_at DESC LIMIT 50').all();
    res.json(logs);
  } catch (err) {
    console.error('[Warboard] GET /audit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// LOGS ENDPOINTS
// ============================================================
router.get('/logs', requirePermission('view_warboard'), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const officer = (req.query.officer || '').trim();
    const building = (req.query.building || '').trim();
    const action = (req.query.action || '').trim();
    const date = (req.query.date || '').trim();

    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push(`(actor_name LIKE ? OR target_name LIKE ? OR details LIKE ?)`);
      const p = `%${search}%`;
      params.push(p, p, p);
    }
    if (officer) {
      whereClauses.push(`actor_name = ?`);
      params.push(officer);
    }
    if (building) {
      whereClauses.push(`(building_id = ? OR details LIKE ?)`);
      params.push(building, `%${building}%`);
    }
    if (action) {
      whereClauses.push(`action = ?`);
      params.push(action);
    }
    if (date) {
      whereClauses.push(`date(created_at) = ?`);
      params.push(date);
    }

    const whereSql = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM warboard_logs ${whereSql}`);
    const total = countStmt.get(...params).total;

    const logsStmt = db.prepare(`
      SELECT *
      FROM warboard_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `);
    const logs = logsStmt.all(...params, limit, offset);

    const pages = Math.ceil(total / limit);
    const hasMore = page < pages;

    res.json({ logs, total, page, pages, limit, hasMore });
  } catch (err) {
    console.error('[Warboard] GET /logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/logs/export', requirePermission('view_warboard'), (req, res) => {
  try {
    const format = (req.query.format || 'txt').toLowerCase();
    const search = (req.query.search || '').trim();
    const officer = (req.query.officer || '').trim();
    const building = (req.query.building || '').trim();
    const action = (req.query.action || '').trim();
    const date = (req.query.date || '').trim();

    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push(`(actor_name LIKE ? OR target_name LIKE ? OR details LIKE ?)`);
      const p = `%${search}%`;
      params.push(p, p, p);
    }
    if (officer) {
      whereClauses.push(`actor_name = ?`);
      params.push(officer);
    }
    if (building) {
      whereClauses.push(`(building_id = ? OR details LIKE ?)`);
      params.push(building, `%${building}%`);
    }
    if (action) {
      whereClauses.push(`action = ?`);
      params.push(action);
    }
    if (date) {
      whereClauses.push(`date(created_at) = ?`);
      params.push(date);
    }

    const whereSql = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const logsStmt = db.prepare(`
      SELECT *
      FROM warboard_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
    `);
    const logs = logsStmt.all(...params);

    let output = '';
    let contentType = 'text/plain';
    let filename = `warboard_logs.${format}`;

    if (format === 'json') {
      contentType = 'application/json';
      output = JSON.stringify(logs, null, 2);
    } else if (format === 'csv') {
      contentType = 'text/csv';
      const headers = ['id', 'building_id', 'action', 'actor_name', 'target_name', 'details', 'created_at', 'is_undo'];
      const rows = logs.map(l => headers.map(h => (l[h] || '').replace(/,/g, ';')).join(','));
      output = headers.join(',') + '\n' + rows.join('\n');
    } else {
      const lines = logs.map(l => {
        const date = new Date(l.created_at).toLocaleString();
        return `[${date}] ${l.actor_name || 'System'} — ${l.details || l.action}`;
      });
      output = lines.join('\n');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(output);
  } catch (err) {
    console.error('[Warboard] GET /logs/export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.post('/logs/undo/:logId', requirePermission('manage_warboard'), (req, res) => {
  try {
    const logId = req.params.logId;
    const log = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logId);
    if (!log) return res.status(404).json({ error: 'Log entry not found' });
    if (log.is_undo) return res.status(400).json({ error: 'Cannot undo an undo action' });
    if (!log.undoable) return res.status(400).json({ error: 'This action is not undoable' });

    const existingUndo = db.prepare('SELECT * FROM warboard_log_undo WHERE log_id = ?').get(logId);
    if (existingUndo) return res.status(400).json({ error: 'This action has already been undone' });

    let extra = null;
    if (log.extra_data) {
      try { extra = JSON.parse(log.extra_data); } catch (e) {}
    }

    let revertMessage = '';
    let success = false;
    const buildingId = log.building_id;

    switch (log.action) {
      case 'assign': {
        if (extra && extra.buildingId !== undefined && extra.slot !== undefined) {
          const del = db.prepare('DELETE FROM warboard_garrison WHERE building_id = ? AND position = ?')
            .run(extra.buildingId, extra.slot);
          if (del.changes > 0) {
            success = true;
            revertMessage = `Removed ${log.target_name || 'player'} from ${extra.buildingName || 'building'} slot ${extra.slot+1}`;
          }
        }
        break;
      }
      case 'remove': {
        if (extra && extra.buildingId !== undefined && extra.slot !== undefined && extra.playerType && extra.playerId) {
          const insert = db.prepare('INSERT INTO warboard_garrison (building_id, user_id, external_player_id, position) VALUES (?, ?, ?, ?)');
          let userId = null, extId = null;
          if (extra.playerType === 'discord') userId = extra.playerId;
          else extId = extra.playerId;
          insert.run(extra.buildingId, userId, extId, extra.slot);
          success = true;
          revertMessage = `Re-added ${log.target_name || 'player'} to ${extra.buildingName || 'building'} slot ${extra.slot+1}`;
        }
        break;
      }
      case 'move': {
        if (extra && extra.fromBuilding && extra.fromSlot !== undefined && extra.toBuilding && extra.toSlot !== undefined) {
          const getEntry = db.prepare('SELECT user_id, external_player_id FROM warboard_garrison WHERE building_id = ? AND position = ?');
          const entry = getEntry.get(extra.toBuilding, extra.toSlot);
          if (entry) {
            db.prepare('DELETE FROM warboard_garrison WHERE building_id = ? AND position = ?')
              .run(extra.toBuilding, extra.toSlot);
            const insert = db.prepare('INSERT INTO warboard_garrison (building_id, user_id, external_player_id, position) VALUES (?, ?, ?, ?)');
            insert.run(extra.fromBuilding, entry.user_id, entry.external_player_id, extra.fromSlot);
            success = true;
            revertMessage = `Moved ${log.target_name || 'player'} back from ${extra.toBuildingName || 'to'} to ${extra.fromBuildingName || 'from'}`;
          }
        }
        break;
      }
      case 'might_update': {
        if (extra && extra.playerId && extra.oldMight !== undefined) {
          db.prepare('UPDATE player_stats SET might = ? WHERE user_id = ?').run(extra.oldMight, extra.playerId);
          success = true;
          revertMessage = `Reverted might for ${log.target_name || 'player'} to ${extra.oldMight}`;
        }
        break;
      }
      case 'building_clear': {
        if (extra && extra.clearedPlayers && Array.isArray(extra.clearedPlayers)) {
          const insert = db.prepare('INSERT INTO warboard_garrison (building_id, user_id, external_player_id, position) VALUES (?, ?, ?, ?)');
          for (const p of extra.clearedPlayers) {
            insert.run(extra.buildingId, p.user_id || null, p.external_player_id || null, p.position);
          }
          success = true;
          revertMessage = `Restored ${extra.clearedPlayers.length} players to ${extra.buildingName || 'building'}`;
        }
        break;
      }
      default:
        success = true;
        revertMessage = `Undid ${log.action}`;
    }

    if (!success) {
      revertMessage = `Undo attempted for ${log.action} but no reversal logic implemented. Marked as undone.`;
    }

    // Insert undo log
    const actor = getActorInfo(req);
    const undoLog = insertLog({
      buildingId: log.building_id,
      action: 'undo',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      targetId: log.id,
      targetName: `Log #${log.id}`,
      details: revertMessage || `Undid ${log.action}`,
      isUndo: 1,
      undoable: 0,
      undoParentId: log.id,
      extraData: { originalAction: log.action }
    });

    db.prepare('INSERT INTO warboard_log_undo (log_id, undo_log_id) VALUES (?, ?)')
      .run(log.id, undoLog.id);

    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(undoLog.id);
    emitLog(newLog);
    if (log.building_id) emitBuildingUpdate(log.building_id);

    res.json({ ok: true, message: revertMessage || 'Undo successful', undoLog: newLog });
  } catch (err) {
    console.error('[Warboard] POST /logs/undo error:', err);
    res.status(500).json({ error: 'Undo failed: ' + err.message });
  }
});

// ============================================================
// DISCORD DM – TEMPLATES
// ============================================================
router.get('/dm-templates', requirePermission('manage_warboard'), (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT id, name, content, is_default, created_at, updated_at
      FROM warboard_dm_templates
      WHERE user_id = ?
      ORDER BY is_default DESC, name ASC
    `).all(req.user.id);
    res.json(templates);
  } catch (err) {
    console.error('[Warboard] GET /dm-templates error:', err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

router.post('/dm-templates', requirePermission('manage_warboard'), (req, res) => {
  try {
    const { id, name, content, is_default } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    const now = new Date().toISOString();

    if (id) {
      const stmt = db.prepare(`
        UPDATE warboard_dm_templates
        SET name = ?, content = ?, is_default = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `);
      stmt.run(name, content, is_default ? 1 : 0, now, id, req.user.id);
      if (is_default) {
        db.prepare(`UPDATE warboard_dm_templates SET is_default = 0 WHERE user_id = ? AND id != ?`)
          .run(req.user.id, id);
      }
      res.json({ ok: true, id });
    } else {
      const stmt = db.prepare(`
        INSERT INTO warboard_dm_templates (user_id, name, content, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(req.user.id, name, content, is_default ? 1 : 0, now, now);
      if (is_default) {
        db.prepare(`UPDATE warboard_dm_templates SET is_default = 0 WHERE user_id = ? AND id != ?`)
          .run(req.user.id, info.lastInsertRowid);
      }
      res.json({ ok: true, id: info.lastInsertRowid });
    }
  } catch (err) {
    console.error('[Warboard] POST /dm-templates error:', err);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

router.delete('/dm-templates/:id', requirePermission('manage_warboard'), (req, res) => {
  try {
    const stmt = db.prepare(`DELETE FROM warboard_dm_templates WHERE id = ? AND user_id = ?`);
    stmt.run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Warboard] DELETE /dm-templates/:id error:', err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ============================================================
// DISCORD DM – PLAYER LIST (for dropdown)
// ============================================================
router.get('/dm-players-list', requirePermission('manage_warboard'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT u.discord_id AS discordId, u.username AS name, u.avatar,
             b.name AS building_name, b.id AS building_id, ps.might AS might
      FROM warboard_garrison g
      JOIN users u ON u.id = g.user_id
      LEFT JOIN player_stats ps ON ps.user_id = u.id
      JOIN warboard_buildings b ON b.id = g.building_id
      WHERE u.discord_id IS NOT NULL
      UNION
      SELECT e.discord_id AS discordId, e.player_name AS name, NULL AS avatar,
             b.name AS building_name, b.id AS building_id, e.might AS might
      FROM warboard_garrison g
      JOIN warboard_external_players e ON e.id = g.external_player_id
      JOIN warboard_buildings b ON b.id = g.building_id
      WHERE e.discord_id IS NOT NULL
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('[Warboard] GET /dm-players-list error:', err);
    res.status(500).json({ error: 'Failed to get player list' });
  }
});

// ============================================================
// DISCORD DM – PREVIEW DATA
// ============================================================
router.get('/dm-preview/:discordId', requirePermission('manage_warboard'), (req, res) => {
  try {
    const discordId = req.params.discordId;
    if (!discordId) return res.status(400).json({ error: 'discordId required' });

    // Find the player in garrison (Discord user)
    const player = db.prepare(`
      SELECT
        g.building_id,
        g.position,
        u.username AS player_name,
        u.username AS discord_username,
        u.discord_id AS player_discord_id,
        u.id AS user_id,
        ps.might AS player_might,
        b.name AS building_name,
        b.capacity AS building_capacity,
        (SELECT COUNT(*) FROM warboard_garrison WHERE building_id = b.id) AS building_filled
      FROM warboard_garrison g
      JOIN users u ON u.id = g.user_id
      LEFT JOIN player_stats ps ON ps.user_id = u.id
      JOIN warboard_buildings b ON b.id = g.building_id
      WHERE u.discord_id = ?
      LIMIT 1
    `).get(discordId);

    // If not found in garrison, try external players
    let extPlayer = null;
    if (!player) {
      extPlayer = db.prepare(`
        SELECT
          g.building_id,
          g.position,
          e.player_name AS player_name,
          e.player_name AS discord_username,
          e.discord_id AS player_discord_id,
          e.might AS player_might,
          b.name AS building_name,
          b.capacity AS building_capacity,
          (SELECT COUNT(*) FROM warboard_garrison WHERE building_id = b.id) AS building_filled
        FROM warboard_garrison g
        JOIN warboard_external_players e ON e.id = g.external_player_id
        JOIN warboard_buildings b ON b.id = g.building_id
        WHERE e.discord_id = ?
        LIMIT 1
      `).get(discordId);
    }

    const data = player || extPlayer;
    if (!data) {
      // Return default data with empty values
      return res.json({
        player_name: 'Unknown',
        player_username: 'unknown',
        player_discord: `<@${discordId}>`,
        building_name: 'Not assigned',
        building_capacity: 0,
        building_filled: 0,
        building_slots_left: 0,
        player_might: 'N/A',
        guild_name: process.env.DISCORD_GUILD_NAME || 'HyperCity',
        server_name: process.env.SERVER_NAME || 'HyperCity Dashboard',
        officer_name: req.user.username || 'Officer',
        current_date: new Date().toLocaleDateString(),
        current_time: new Date().toLocaleTimeString()
      });
    }

    const buildingSlotsLeft = data.building_capacity - data.building_filled;

    res.json({
      player_name: data.player_name,
      player_username: data.discord_username || data.player_name,
      player_discord: `<@${data.player_discord_id}>`,
      building_name: data.building_name || 'Unknown',
      building_capacity: data.building_capacity || 0,
      building_filled: data.building_filled || 0,
      building_slots_left: buildingSlotsLeft >= 0 ? buildingSlotsLeft : 0,
      player_might: data.player_might ? formatMight(data.player_might) : 'N/A',
      guild_name: process.env.DISCORD_GUILD_NAME || 'HyperCity',
      server_name: process.env.SERVER_NAME || 'HyperCity Dashboard',
      officer_name: req.user.username || 'Officer',
      current_date: new Date().toLocaleDateString(),
      current_time: new Date().toLocaleTimeString()
    });
  } catch (err) {
    console.error('[Warboard] GET /dm-preview error:', err);
    res.status(500).json({ error: 'Failed to get preview data' });
  }
});

// ============================================================
// DISCORD DM – HISTORY
// ============================================================
router.get('/dm-history', requirePermission('manage_warboard'), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let where = 'action = ? AND actor_id = ?';
    let params = ['bulk_dm', req.user.id];
    if (search) {
      where += ' AND (details LIKE ? OR extra_data LIKE ?)';
      const p = `%${search}%`;
      params.push(p, p);
    }

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM warboard_logs WHERE ${where}`);
    const total = countStmt.get(...params).total;

    const logsStmt = db.prepare(`
      SELECT id, building_id, action, actor_id, actor_name, details, extra_data, created_at
      FROM warboard_logs
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const logs = logsStmt.all(...params, limit, offset);

    const items = logs.map(log => {
      let extra = {};
      try { extra = JSON.parse(log.extra_data); } catch (e) {}
      return {
        id: log.id,
        template_name: extra.template_name || 'Bulk DM',
        mode: extra.mode || 'unknown',
        recipients: extra.total || 0,
        success: extra.sent || 0,
        failed: extra.failed || 0,
        created_at: log.created_at
      };
    });

    const pages = Math.ceil(total / limit);
    res.json({ items, page, pages, total });
  } catch (err) {
    console.error('[Warboard] GET /dm-history error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ============================================================
// DISCORD DM – SEND (supports player, building, all)
// ============================================================
router.post('/dm-send', requirePermission('manage_warboard'), async (req, res) => {
  try {
    const { mode, recipientIds, buildingId, allBuildings, templateContent } = req.body;
    if (!templateContent) return res.status(400).json({ error: 'Template content is required' });

    let discordIds = [];

    // If recipientIds is provided and non-empty, use that as the primary source.
    if (recipientIds && recipientIds.length > 0) {
      discordIds = recipientIds;
    } else {
      // Fallback to mode-based selection (building or all)
      if (mode === 'building' && buildingId) {
        const rows = db.prepare(`
          SELECT u.discord_id AS discordId
          FROM warboard_garrison g
          JOIN users u ON u.id = g.user_id
          WHERE g.building_id = ? AND u.discord_id IS NOT NULL
          UNION
          SELECT e.discord_id AS discordId
          FROM warboard_garrison g
          JOIN warboard_external_players e ON e.id = g.external_player_id
          WHERE g.building_id = ? AND e.discord_id IS NOT NULL
        `).all(buildingId, buildingId);
        discordIds = rows.map(r => r.discordId).filter(id => id);
      } else if (mode === 'all' || allBuildings) {
        const userRows = db.prepare(`
          SELECT u.discord_id AS discordId
          FROM warboard_garrison g
          JOIN users u ON u.id = g.user_id
          WHERE u.discord_id IS NOT NULL
        `).all();
        const extRows = db.prepare(`
          SELECT e.discord_id AS discordId
          FROM warboard_garrison g
          JOIN warboard_external_players e ON e.id = g.external_player_id
          WHERE e.discord_id IS NOT NULL
        `).all();
        discordIds = [...userRows, ...extRows].map(r => r.discordId).filter(id => id);
      } else if (mode === 'player' && recipientIds && recipientIds.length === 1) {
        // Should not happen because we already handled recipientIds, but kept for safety.
        discordIds = recipientIds;
      }
    }

    if (discordIds.length === 0) {
      return res.status(400).json({ error: 'No players with Discord IDs found for the selected target' });
    }

    // Get building name for logging (optional)
    let buildingName = 'Unknown';
    if (buildingId) {
      const b = db.prepare('SELECT name FROM warboard_buildings WHERE id = ?').get(buildingId);
      if (b) buildingName = b.name;
    } else if (mode === 'all' || allBuildings) {
      buildingName = 'All Buildings';
    } else if (mode === 'player' && discordIds.length === 1) {
      // Try to get building of that player for logging
      const b = db.prepare(`
        SELECT b.name FROM warboard_garrison g
        JOIN warboard_buildings b ON b.id = g.building_id
        JOIN users u ON u.id = g.user_id
        WHERE u.discord_id = ?
      `).get(discordIds[0]);
      if (b) buildingName = b.name;
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'Discord bot token not configured' });
    }

    // Send with batching
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < discordIds.length; i += batchSize) {
      const batch = discordIds.slice(i, i + batchSize);
      await Promise.all(batch.map(async (discordId) => {
        try {
          // Create DM channel
          const channelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipient_id: discordId })
          });
          if (!channelRes.ok) {
            const err = await channelRes.text();
            throw new Error(`DM channel failed: ${channelRes.status} ${err}`);
          }
          const channel = await channelRes.json();
          // Send message exactly as provided (no backend replacement)
          const dmRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: templateContent })
          });
          if (!dmRes.ok) {
            const err = await dmRes.text();
            throw new Error(`DM send failed: ${dmRes.status} ${err}`);
          }
          results.push({ player: discordId, success: true });
        } catch (err) {
          results.push({ player: discordId, success: false, error: err.message });
        }
      }));
      if (i + batchSize < discordIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Log the bulk DM
    const actor = getActorInfo(req);
    const details = `Sent ${sent} DMs (${failed} failed) to ${buildingName}`;
    const logEntry = insertLog({
      buildingId: buildingId || null,
      action: 'bulk_dm',
      actorId: actor.id,
      actorName: actor.name,
      actorAvatar: actor.avatar,
      details: details,
      undoable: 0,
      extraData: { total: discordIds.length, sent, failed, buildingName, mode, template_name: 'DM' }
    });
    const newLog = db.prepare('SELECT * FROM warboard_logs WHERE id = ?').get(logEntry.id);
    emitLog(newLog);

    res.json({ ok: true, sent, failed, total: discordIds.length, results });
  } catch (err) {
    console.error('[Warboard] POST /dm-send error:', err);
    res.status(500).json({ error: 'Failed to send DMs: ' + err.message });
  }
});

// ============================================================
// EXPORT
// ============================================================
module.exports = router;
module.exports.syncGuildMembers = syncGuildMembers;
module.exports.getPlayers = getPlayers;