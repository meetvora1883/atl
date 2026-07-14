const express = require('express');
const router = express.Router();
const { db, auditLog } = require('../../db');
const { requirePermission } = require('../../middleware/roles');
const { reloadTranslations } = require('../../middleware/translations');

// ---- Language Management (admin) ----

// GET /api/translations/languages – list all languages
router.get('/languages', requirePermission('manage_translations'), (req, res) => {
  const langs = [
    { code: 'en', name: 'English', flag: '🇺🇸', enabled: true },
    { code: 'hi', name: 'Hindi', flag: '🇮🇳', enabled: true },
    { code: 'gu', name: 'Gujarati', flag: '🇮🇳', enabled: true },
    { code: 'ta', name: 'Tamil', flag: '🇮🇳', enabled: false },
    { code: 'te', name: 'Telugu', flag: '🇮🇳', enabled: false },
    { code: 'ru', name: 'Russian', flag: '🇷🇺', enabled: false },
  ];
  res.json(langs);
});

// POST /api/translations/languages – add a new language
router.post('/languages', requirePermission('manage_translations'), (req, res) => {
  const { name, code, flag, enabled, copyFrom } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code are required' });

  try {
    db.prepare(`ALTER TABLE translations ADD COLUMN ${code} TEXT`).run();
  } catch (e) {
    // Column might already exist – ignore
  }

  if (copyFrom) {
    const rows = db.prepare('SELECT key, ' + copyFrom + ' as translation FROM translations').all();
    const stmt = db.prepare(`INSERT OR IGNORE INTO translations (key, ${code}) VALUES (?, ?)`);
    for (const row of rows) {
      stmt.run(row.key, row.translation || '');
    }
  }

  auditLog(req.user.id, 'language_added', 'language', code, { name, flag, enabled }, req.ip);
  reloadTranslations();
  res.status(201).json({ ok: true, language: { name, code, flag, enabled } });
});

// PUT /api/translations/languages/:code – toggle enabled
router.put('/languages/:code', requirePermission('manage_translations'), (req, res) => {
  const { enabled } = req.body;
  auditLog(req.user.id, 'language_toggled', 'language', req.params.code, { enabled }, req.ip);
  reloadTranslations();
  res.json({ ok: true });
});

// GET /api/translations/keys – list all translation keys
router.get('/keys', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT key FROM translations ORDER BY key').all();
  const keys = rows.map(r => r.key);
  res.json(keys);
});

// GET /api/translations/export/:lang – export translations
router.get('/export/:lang', requirePermission('manage_translations'), (req, res) => {
  const lang = req.params.lang.toLowerCase();
  const format = req.query.format || 'json';
  const rows = db.prepare('SELECT key, en, ' + lang + ' as translation FROM translations').all();

  if (format === 'csv') {
    let csv = 'key,en,translation\n';
    rows.forEach(r => {
      csv += `"${r.key}","${r.en || ''}","${r.translation || ''}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=translations_${lang}.csv`);
    return res.send(csv);
  } else if (format === 'yaml') {
    let yaml = '';
    rows.forEach(r => {
      yaml += `${r.key}: ${r.translation || ''}\n`;
    });
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', `attachment; filename=translations_${lang}.yaml`);
    return res.send(yaml);
  } else {
    const result = {};
    rows.forEach(r => {
      result[r.key] = r.translation || '';
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=translations_${lang}.json`);
    return res.json(result);
  }
});

// GET /api/translations/scan-missing – scan missing translations
router.get('/scan-missing', requirePermission('manage_translations'), (req, res) => {
  const lang = req.query.lang || 'hi';
  const rows = db.prepare('SELECT key, ' + lang + ' as translation FROM translations').all();
  const missing = rows.filter(r => !r.translation || !r.translation.trim());
  res.json({
    totalKeys: rows.length,
    missingCount: missing.length,
    completion: rows.length > 0 ? Math.round(((rows.length - missing.length) / rows.length) * 100) : 0,
    language: lang,
    missingKeys: missing.map(r => r.key)
  });
});

// PUT /api/translations/settings – update language settings
router.put('/settings', requirePermission('manage_translations'), (req, res) => {
  const settings = req.body;
  const current = db.prepare('SELECT settings_json FROM server_settings WHERE id = 1').get();
  let obj = {};
  try { obj = JSON.parse(current.settings_json || '{}'); } catch (e) {}
  obj.languageSettings = settings;
  db.prepare('UPDATE server_settings SET settings_json = ? WHERE id = 1').run(JSON.stringify(obj));
  auditLog(req.user.id, 'language_settings_updated', 'settings', null, settings, req.ip);
  reloadTranslations();
  res.json({ ok: true });
});

// ---- Language Management (public) ----

// GET /api/translations/:lang – get translations for a language (must be last!)
router.get('/:lang', (req, res) => {
  const lang = req.params.lang.toLowerCase();
  const allowed = ['en', 'hi', 'gu', 'ta', 'te', 'ru'];
  if (!allowed.includes(lang)) return res.status(400).json({ error: 'Invalid language' });

  const rows = db.prepare('SELECT key, ' + lang + ' as translation FROM translations').all();
  const result = {};
  rows.forEach(row => {
    result[row.key] = row.translation || '';
  });
  res.json(result);
});

module.exports = router;