const express = require('express');
const router = express.Router();
const { db } = require('../../db');
const { requirePermission } = require('../../middleware/roles');
const { auditLog } = require('../../db');

// ----- Migration: ensure tables and columns exist -----
function ensureTablesAndColumns() {
  // Main votes table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS warboard_flag_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT,
      flag_count INTEGER NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_by TEXT,
      edited_at TEXT
    )
  `).run();

  // Settings table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS warboard_flag_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      locked INTEGER NOT NULL DEFAULT 0,
      channel_id TEXT,
      channel_name TEXT,
      message_id TEXT,
      guild_id TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      settings_json TEXT DEFAULT '{}'
    )
  `).run();

  // Add missing columns (safe)
  const settingsCols = db.prepare("PRAGMA table_info('warboard_flag_settings')").all().map(c => c.name);
  const requiredSettings = ['id','locked','channel_id','channel_name','message_id','guild_id','updated_by','updated_at','settings_json'];
  for (const col of requiredSettings) {
    if (!settingsCols.includes(col)) {
      const type = (col === 'id' || col === 'locked') ? 'INTEGER' : 'TEXT';
      const def = (col === 'locked') ? ' DEFAULT 0' : (col === 'settings_json') ? " DEFAULT '{}'" : '';
      db.prepare(`ALTER TABLE warboard_flag_settings ADD COLUMN ${col} ${type}${def}`).run();
      console.log(`[flag_calls] Added column ${col} to settings`);
    }
  }

  const votesCols = db.prepare("PRAGMA table_info('warboard_flag_calls')").all().map(c => c.name);
  const requiredVotes = ['id','discord_id','username','avatar','flag_count','submitted_at','edited_by','edited_at'];
  for (const col of requiredVotes) {
    if (!votesCols.includes(col)) {
      const type = (col === 'id' || col === 'flag_count') ? 'INTEGER' : 'TEXT';
      const def = (col === 'submitted_at') ? ' DEFAULT (datetime("now"))' : '';
      db.prepare(`ALTER TABLE warboard_flag_calls ADD COLUMN ${col} ${type}${def}`).run();
      console.log(`[flag_calls] Added column ${col} to votes`);
    }
  }

  // Insert default settings if missing
  const settings = db.prepare('SELECT id FROM warboard_flag_settings LIMIT 1').get();
  if (!settings) {
    db.prepare('INSERT INTO warboard_flag_settings (locked, settings_json) VALUES (0, \'{}\')').run();
  }
}
ensureTablesAndColumns();

// ----- Helpers -----
function getSettings() {
  return db.prepare('SELECT * FROM warboard_flag_settings LIMIT 1').get();
}

function updateSettings(fields, actor) {
  const keys = Object.keys(fields);
  if (!keys.length) return getSettings();
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  values.push(actor || 'system');
  db.prepare(`UPDATE warboard_flag_settings SET ${setClause}, updated_by = ?, updated_at = datetime('now') WHERE id = (SELECT id FROM warboard_flag_settings LIMIT 1)`)
    .run(...values);
  return getSettings();
}

function getVotes() {
  return db.prepare('SELECT * FROM warboard_flag_calls ORDER BY submitted_at DESC').all();
}

function getCounts() {
  const votes = getVotes();
  const counts = { 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of votes) counts[v.flag_count] = (counts[v.flag_count] || 0) + 1;
  return { counts, total: votes.length, votes };
}

function getSettingsJSON() {
  const settings = getSettings();
  try {
    return JSON.parse(settings.settings_json || '{}');
  } catch { return {}; }
}

function updateSettingsJSON(json, actor) {
  const current = getSettingsJSON();
  const merged = { ...current, ...json };
  updateSettings({ settings_json: JSON.stringify(merged) }, actor);
  return merged;
}

// ----- Discord API helper (REST) -----
async function callDiscordAPI(endpoint, method = 'GET', body = null) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('Discord bot token not configured.');
  const url = `https://discord.com/api/v10${endpoint}`;
  const options = { method, headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    let errData;
    try { errData = await res.json(); } catch { errData = { message: 'Unknown error' }; }
    // Discord error code 10008 = Unknown Message
    const error = errData.message || `HTTP ${res.status}`;
    const code = errData.code || res.status;
    throw { message: error, code, status: res.status };
  }
  return res.json();
}

// ----- Get valid message ID (checks existence) -----
async function getValidMessageId() {
  const settings = getSettings();
  if (!settings.message_id || !settings.channel_id) return null;
  try {
    await callDiscordAPI(`/channels/${settings.channel_id}/messages/${settings.message_id}`);
    return settings.message_id;
  } catch (err) {
    // If message not found (404 or code 10008), clear it
    if (err.status === 404 || err.code === 10008) {
      updateSettings({ message_id: null }, 'system');
      return null;
    }
    // For other errors, assume it might still exist (e.g., network issues)
    return settings.message_id;
  }
}

// ----- Build Discord embed & components -----
function buildFlagEmbed(counts, total, locked, title, description, footer, embedColor) {
  const color = embedColor ? parseInt(embedColor.replace('#', ''), 16) : (locked ? 0xe74c3c : 0x2ecc71);
  const embed = {
    title: title || '🏳 Flag Call',
    description: description || (locked ? '🔴 **Voting is locked**' : '🟢 **Voting is open**'),
    color: color,
    fields: [
      { name: '🏳 2 Flags', value: `${counts[2] || 0}`, inline: true },
      { name: '🏳🏳🏳 3 Flags', value: `${counts[3] || 0}`, inline: true },
      { name: '🏳🏳🏳🏳 4 Flags', value: `${counts[4] || 0}`, inline: true },
      { name: '🏳🏳🏳🏳🏳 5 Flags', value: `${counts[5] || 0}`, inline: true },
      { name: 'Total Votes', value: `${total}`, inline: false }
    ],
    footer: { text: footer || 'Click a button below to vote' },
    timestamp: new Date().toISOString()
  };

  const voteList = getVotes();
  const grouped = { 2: [], 3: [], 4: [], 5: [] };
  for (const v of voteList) grouped[v.flag_count].push(v.discord_id);
  for (const count of [2,3,4,5]) {
    if (grouped[count].length) {
      const mentions = grouped[count].map(id => `<@${id}>`).join(', ');
      embed.fields.push({ name: `🏳 ${count} Flags (voters)`, value: mentions || 'None', inline: false });
    }
  }
  return embed;
}

function buildFlagComponents(locked, settingsJSON) {
  const labels = settingsJSON.buttonLabels || { 2: '2 Flags', 3: '3 Flags', 4: '4 Flags', 5: '5 Flags' };
  const emojis = settingsJSON.buttonEmojis || { 2: '🏳', 3: '🏳', 4: '🏳', 5: '🏳' };
  const colors = settingsJSON.buttonColors || { 2: 1, 3: 3, 4: 2, 5: 4 }; // 1=primary,2=secondary,3=success,4=danger
  const buttons = [
    { label: labels[2] || '2 Flags', customId: 'flag_vote_2', style: colors[2] || 1, emoji: emojis[2] || '🏳' },
    { label: labels[3] || '3 Flags', customId: 'flag_vote_3', style: colors[3] || 3, emoji: emojis[3] || '🏳' },
    { label: labels[4] || '4 Flags', customId: 'flag_vote_4', style: colors[4] || 2, emoji: emojis[4] || '🏳' },
    { label: labels[5] || '5 Flags', customId: 'flag_vote_5', style: colors[5] || 4, emoji: emojis[5] || '🏳' },
  ];
  return buttons.map(b => ({
    type: 2,
    style: b.style,
    label: b.label,
    custom_id: b.customId,
    emoji: { name: b.emoji },
    disabled: !!locked
  }));
}

// ----- Update Discord message (creates or edits) -----
async function updateDiscordMessage(actor = 'system', title, description, footer, embedColor, mode) {
  const settings = getSettings();
  const settingsJSON = getSettingsJSON();
  if (!settings.channel_id) return null;

  const { counts, total } = getCounts();
  const embed = buildFlagEmbed(counts, total, !!settings.locked, title, description, footer, embedColor);
  const components = buildFlagComponents(!!settings.locked, settingsJSON);

  let messageId = settings.message_id;
  let newMsg = null;

  // If mode is 'create' or no message exists, create new
  if (mode === 'create' || !messageId) {
    const created = await callDiscordAPI(`/channels/${settings.channel_id}/messages`, 'POST', {
      embeds: [embed],
      components: [{ type: 1, components }]
    });
    messageId = created.id;
    updateSettings({ message_id: messageId }, actor);
    newMsg = created;
    auditLog(null, 'flag_message_created', 'flag_call', null, { messageId }, null);
    return newMsg;
  }

  // Otherwise update existing
  try {
    await callDiscordAPI(`/channels/${settings.channel_id}/messages/${messageId}`, 'PATCH', {
      embeds: [embed],
      components: [{ type: 1, components }]
    });
    newMsg = { id: messageId };
    return newMsg;
  } catch (err) {
    if (err.status === 404 || err.code === 10008) {
      // Message gone – create new
      const created = await callDiscordAPI(`/channels/${settings.channel_id}/messages`, 'POST', {
        embeds: [embed],
        components: [{ type: 1, components }]
      });
      messageId = created.id;
      updateSettings({ message_id: messageId }, actor);
      newMsg = created;
      auditLog(null, 'flag_message_recreated', 'flag_call', null, { newMessageId: messageId, actor }, null);
      return newMsg;
    }
    throw err;
  }
}

// ----- Interaction handler -----
async function handleFlagInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('flag_vote_')) return;

  try {
    const settings = getSettings();
    if (settings.locked) {
      await interaction.reply({ content: '🔒 Voting is currently locked.', ephemeral: true });
      return;
    }

    const flagCount = parseInt(interaction.customId.split('_')[2], 10);
    const discordId = interaction.user.id;
    const username = interaction.user.username;
    const avatar = interaction.user.displayAvatarURL();

    const existing = db.prepare('SELECT * FROM warboard_flag_calls WHERE discord_id = ?').get(discordId);

    if (existing) {
      const previous = existing.flag_count;
      db.prepare(`UPDATE warboard_flag_calls SET flag_count = ?, edited_by = ?, edited_at = datetime('now') WHERE discord_id = ?`)
        .run(flagCount, username, discordId);
      await interaction.reply({ content: `✅ Vote updated to **${flagCount} Flags**.`, ephemeral: true });
    } else {
      db.prepare(`INSERT INTO warboard_flag_calls (discord_id, username, avatar, flag_count) VALUES (?, ?, ?, ?)`)
        .run(discordId, username, avatar, flagCount);
      await interaction.reply({ content: `✅ Vote recorded: **${flagCount} Flags**.`, ephemeral: true });
    }

    await updateDiscordMessage(username);
  } catch (err) {
    console.error('[Flag Calls] Interaction error:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '⚠ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
}

// ----- Router -----
router.get('/status', requirePermission('view_flag_calls'), async (req, res) => {
  try {
    const settings = getSettings();
    const { counts, total } = getCounts();
    const validId = await getValidMessageId(); // checks existence
    const hasValidMessage = !!validId;

    res.json({
      ok: true,
      locked: !!settings.locked,
      channelId: settings.channel_id,
      channelName: settings.channel_name,
      messageId: settings.message_id,
      messageExists: hasValidMessage,
      counts,
      total,
      updatedAt: settings.updated_at,
      botConnected: !!process.env.DISCORD_BOT_TOKEN,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to load status' });
  }
});

router.get('/results', requirePermission('view_flag_calls'), (req, res) => {
  try {
    const { votes, counts, total } = getCounts();
    const grouped = { 2: [], 3: [], 4: [], 5: [] };
    for (const v of votes) {
      grouped[v.flag_count].push({
        discordId: v.discord_id,
        username: v.username,
        avatar: v.avatar,
        submittedAt: v.submitted_at,
        editedBy: v.edited_by,
        editedAt: v.edited_at,
      });
    }
    res.json({ ok: true, counts, total, grouped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to load results' });
  }
});

router.get('/activity', requirePermission('view_flag_calls'), (req, res) => {
  // In-memory activity log (you can move to DB)
  res.json({ ok: true, activity: [] });
});

router.get('/search', requirePermission('manage_flag_calls'), (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, results: [] });
  const rows = db.prepare(`
    SELECT discord_id, username, avatar, flag_count, submitted_at
    FROM warboard_flag_calls
    WHERE username LIKE ? OR discord_id LIKE ?
    ORDER BY submitted_at DESC
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`);
  res.json({ ok: true, results: rows });
});

// ----- GET settings (for button config, embed color) -----
router.get('/settings', requirePermission('manage_flag_calls'), (req, res) => {
  const json = getSettingsJSON();
  const settings = getSettings();
  res.json({ ok: true, settings: json, locked: !!settings.locked });
});

// ----- PUT settings (update button config, embed color, etc.) -----
router.put('/settings', requirePermission('manage_flag_calls'), (req, res) => {
  const { buttonLabels, buttonEmojis, buttonColors, embedColor } = req.body;
  const json = getSettingsJSON();
  if (buttonLabels) json.buttonLabels = buttonLabels;
  if (buttonEmojis) json.buttonEmojis = buttonEmojis;
  if (buttonColors) json.buttonColors = buttonColors;
  if (embedColor) json.embedColor = embedColor;
  updateSettingsJSON(json, req.user.username);
  auditLog(req.user.id, 'flag_settings_updated', 'flag_call', null, { by: req.user.username, settings: json }, req.ip);
  res.json({ ok: true });
});

router.post('/lock', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    updateSettings({ locked: 1 }, req.user.username);
    await updateDiscordMessage(req.user.username);
    auditLog(req.user.id, 'flag_call_locked', 'flag_call', null, { by: req.user.username }, req.ip);
    res.json({ ok: true, locked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to lock' });
  }
});

router.post('/unlock', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    updateSettings({ locked: 0 }, req.user.username);
    await updateDiscordMessage(req.user.username);
    auditLog(req.user.id, 'flag_call_unlocked', 'flag_call', null, { by: req.user.username }, req.ip);
    res.json({ ok: true, locked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to unlock' });
  }
});

router.post('/restart', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    db.prepare('DELETE FROM warboard_flag_calls').run();
    updateSettings({ locked: 0 }, req.user.username);
    await updateDiscordMessage(req.user.username);
    auditLog(req.user.id, 'flag_call_restarted', 'flag_call', null, { by: req.user.username }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to restart' });
  }
});

router.put('/change/:discordId', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    const { discordId } = req.params;
    const { flagCount, username } = req.body;
    if (![2,3,4,5].includes(parseInt(flagCount, 10))) {
      return res.status(400).json({ ok: false, error: 'Invalid flag count' });
    }

    const existing = db.prepare('SELECT * FROM warboard_flag_calls WHERE discord_id = ?').get(discordId);
    const actor = req.user.username;

    if (existing) {
      db.prepare(`UPDATE warboard_flag_calls SET flag_count = ?, edited_by = ?, edited_at = datetime('now') WHERE discord_id = ?`)
        .run(flagCount, actor, discordId);
    } else {
      db.prepare(`INSERT INTO warboard_flag_calls (discord_id, username, flag_count, edited_by, edited_at) VALUES (?, ?, ?, ?, datetime('now'))`)
        .run(discordId, username || discordId, flagCount, actor);
    }

    auditLog(req.user.id, 'flag_vote_changed', 'flag_call', discordId, { newFlagCount: flagCount, by: actor }, req.ip);
    await updateDiscordMessage(actor);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to change vote' });
  }
});

router.get('/channels', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) throw new Error('DISCORD_GUILD_ID not set.');
    const channels = await callDiscordAPI(`/guilds/${guildId}/channels`);
    const textChannels = channels.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
    res.json({ ok: true, channels: textChannels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/channel', requirePermission('manage_flag_calls'), (req, res) => {
  try {
    const { channelId, channelName } = req.body;
    if (!channelId) return res.status(400).json({ ok: false, error: 'channelId required' });
    updateSettings({ channel_id: channelId, channel_name: channelName || null, message_id: null }, req.user.username);
    auditLog(req.user.id, 'flag_channel_changed', 'flag_call', null, { channelId, channelName, by: req.user.username }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Failed to set channel' });
  }
});

router.post('/test', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    const settings = getSettings();
    if (!settings.channel_id) throw new Error('No Discord channel selected.');
    await callDiscordAPI(`/channels/${settings.channel_id}/messages`, 'POST', {
      content: `✅ Test message from Flag Call System (by ${req.user.username}).`
    });
    auditLog(req.user.id, 'flag_test_message_sent', 'flag_call', null, { channelId: settings.channel_id }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/send', requirePermission('manage_flag_calls'), async (req, res) => {
  try {
    const settings = getSettings();
    if (!settings.channel_id) throw new Error('No Discord channel selected.');
    const { title, description, footer, embedColor, mode } = req.body;
    const json = getSettingsJSON();
    const finalTitle = title || 'Flag Call Results';
    const finalDesc = description || '';
    const finalFooter = footer || 'Click a button below to vote';
    const finalColor = embedColor || json.embedColor || '#2ecc71';
    const finalMode = mode || 'update';

    const result = await updateDiscordMessage(req.user.username, finalTitle, finalDesc, finalFooter, finalColor, finalMode);
    if (result && result.id !== settings.message_id) {
      updateSettings({ message_id: result.id }, req.user.username);
    }
    const action = finalMode === 'create' ? 'flag_message_created' : 'flag_message_updated';
    auditLog(req.user.id, action, 'flag_call', null, { channelId: settings.channel_id, messageId: result?.id, title: finalTitle }, req.ip);
    res.json({ ok: true, messageId: result?.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- Setup function for bot client -----
function setupFlagCallInteractions(client) {
  client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId.startsWith('flag_vote_')) {
      await handleFlagInteraction(interaction);
    }
  });
  console.log('[Flag Calls] Interaction handler registered.');
}

module.exports = router;
module.exports.setupFlagCallInteractions = setupFlagCallInteractions;