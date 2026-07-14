const express = require('express');
const router = express.Router();
const { db, getGlobalSettings, updateGlobalSettings } = require('../../db');

const VALID_THEMES = new Set(['dark', 'light']);
const VALID_LANGUAGES = new Set(['en', 'hi', 'gu']); // add more as needed

// GET /api/settings
router.get('/', (req, res) => {
  const userSettings = db.prepare('SELECT theme, language FROM settings WHERE user_id = ?').get(req.user.id) || { theme: 'dark', language: 'en' };
  const response = { ...userSettings };

  const global = getGlobalSettings();
  const server = db.prepare('SELECT maintenance_mode, maintenance_message FROM server_settings WHERE id = 1').get();
  global.maintenance_mode = !!server.maintenance_mode;
  global.maintenance_message = server.maintenance_message;
  response.global = global;

  res.json(response);
});

// PUT /api/settings
router.put('/', (req, res) => {
  const { theme, language, global } = req.body;

  // Update user settings
  if (theme || language) {
    if (theme && !VALID_THEMES.has(theme)) return res.status(400).json({ error: 'Invalid theme' });
    if (language && !VALID_LANGUAGES.has(language)) return res.status(400).json({ error: 'Invalid language' });

    db.prepare(
      `UPDATE settings SET
         theme = COALESCE(@theme, theme),
         language = COALESCE(@language, language),
         updated_at = datetime('now')
       WHERE user_id = @user_id`
    ).run({ theme: theme || null, language: language || null, user_id: req.user.id });
  }

  // Update global settings (admin only)
  if (global) {
    const isAdmin = req.user.permissions?.includes('manage_bot') || req.user.permissions?.includes('owner_panel') || req.user.isOwner;
    if (!isAdmin) return res.status(403).json({ error: 'Insufficient permissions to update global settings' });

    updateGlobalSettings(global);

    if (global.maintenance_mode !== undefined) {
      db.prepare('UPDATE server_settings SET maintenance_mode = ? WHERE id = 1').run(global.maintenance_mode ? 1 : 0);
    }
    if (global.maintenance_message !== undefined) {
      db.prepare('UPDATE server_settings SET maintenance_message = ? WHERE id = 1').run(global.maintenance_message);
    }
  }

  // Return updated settings
  const updatedUser = db.prepare('SELECT theme, language FROM settings WHERE user_id = ?').get(req.user.id);
  const result = { ...updatedUser };
  const globalSettings = getGlobalSettings();
  const server = db.prepare('SELECT maintenance_mode, maintenance_message FROM server_settings WHERE id = 1').get();
  globalSettings.maintenance_mode = !!server.maintenance_mode;
  globalSettings.maintenance_message = server.maintenance_message;
  result.global = globalSettings;

  res.json(result);
});

module.exports = router;