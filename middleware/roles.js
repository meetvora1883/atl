function requireRole(roleName) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles.includes(roleName)) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ error: 'Insufficient role' });
      }
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: "You don't have access to this page.",
        user: req.user || null,
      });
    }
    next();
  };
}

function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions.includes(permissionName)) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ error: 'Insufficient permission' });
      }
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: "You don't have permission to view this page.",
        user: req.user || null,
      });
    }
    next();
  };
}

function requireAnyRole(roleNames) {
  return (req, res, next) => {
    if (!req.user) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
      return res.redirect('/?authRequired=1');
    }
    const hasRole = req.user.roles.some(r => roleNames.includes(r));
    if (!hasRole) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ error: 'Insufficient role' });
      }
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: "You don't have the required role.",
        user: req.user,
      });
    }
    next();
  };
}

module.exports = { requireRole, requirePermission, requireAnyRole };