const express = require('express');
const router = express.Router();
const { getAllPermissions } = require('../../db');
const { requirePermission } = require('../../middleware/roles');

router.use(requirePermission('manage_roles'));

router.get('/', (req, res) => {
  res.json(getAllPermissions.all());
});

module.exports = router;