const express = require('express');
const router = express.Router();
const { getUserPreferences, saveWidgets, saveTheme } = require('../../db');

router.get('/', (req, res) => {
  res.json(getUserPreferences(req.user.id));
});

// Body: { widgets: ["stats","charts","events",...] } — order = display order
router.put('/', (req, res) => {
  const widgets = Array.isArray(req.body.widgets) ? req.body.widgets : [];
  saveWidgets.run(JSON.stringify(widgets), req.user.id);
  res.json({ ok: true });
});

router.put('/theme', (req, res) => {
  const { accent, sidebar, background, cardStyle, font } = req.body;
  const theme = { accent, sidebar, background, cardStyle, font };
  saveTheme.run(JSON.stringify(theme), req.user.id);
  res.json({ ok: true, theme });
});

module.exports = router;
