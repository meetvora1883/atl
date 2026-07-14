const { verifyAccessToken } = require('../utils/tokens');
const { getUserById, getUserRoles, getUserPermissions, isOwner, getHighestRolePosition, getGlobalSettings } = require('../db');

function loadUserFromToken(req) {
  const token = req.cookies && req.cookies.access_token;
  if (!token) return { user: null, code: 'NO_TOKEN' };

  const { payload, expired } = verifyAccessToken(token);
  if (!payload) return { user: null, code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN' };

  const user = getUserById(payload.sub);
  if (!user) return { user: null, code: 'NO_USER' };
  if (user.banned) return { user: null, code: 'BANNED' };

  const roleData = getUserRoles.all(user.id);
  user.roles = roleData.map((r) => r.name);
  user.rolesFull = roleData;
  user.permissions = getUserPermissions.all(user.id).map((p) => p.name);
  user.isOwner = isOwner(user.id) || user.roles.includes('owner');
  user.highestRolePosition = getHighestRolePosition(user.id);
  return { user, code: null };
}

function attachUser(req, res, next) {
  const { user } = loadUserFromToken(req);
  req.user = user;
  res.locals.user = user || null;
  
  // Attach global settings (for meta tags & templates)
  const global = getGlobalSettings();
  res.locals.globalSettings = global;
  
  // Also attach user language (from settings table)
  if (user) {
    const settings = req.db ? req.db.prepare('SELECT language FROM settings WHERE user_id = ?').get(user.id) : null;
    res.locals.userLanguage = settings?.language || 'en';
  } else {
    res.locals.userLanguage = 'en';
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const { user, code } = loadUserFromToken(req);
    req.user = user;
    res.locals.user = user || null;

    if (!user) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ error: 'Not authenticated', code });
      }
      return res.redirect(code === 'BANNED' ? '/?banned=1' : '/?authRequired=1');
    }
  }
  next();
}

module.exports = { attachUser, requireAuth, loadUserFromToken };