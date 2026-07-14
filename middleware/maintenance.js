const { getServerSettings } = require('../db');

function maintenanceCheck(req, res, next) {
  // Exclude auth, health, static assets, API routes, AND the splash page
  if (
    req.path.startsWith('/auth') ||
    req.path === '/health' ||
    req.path.startsWith('/css') ||
    req.path.startsWith('/js') ||
    req.path.startsWith('/icons') ||
    req.path.startsWith('/api') ||
    req.path === '/'  // ✅ allow the splash page
  ) {
    return next();
  }

  const settings = getServerSettings();
  console.log('[Maintenance] Settings:', settings);

  if (settings && settings.maintenance_mode) {
    console.log('[Maintenance] Mode is ON. Path:', req.path, 'User:', req.user ? req.user.username : 'guest');

    // Check bypass conditions
    let canBypass = false;

    if (req.user) {
      if (req.user.permissions?.includes('bypass_maintenance')) {
        console.log('[Maintenance] Bypass granted: has bypass_maintenance permission');
        canBypass = true;
      } else if (req.user.roles?.includes('owner')) {
        console.log('[Maintenance] Bypass granted: has owner role');
        canBypass = true;
      } else if (req.user.isOwner) {
        console.log('[Maintenance] Bypass granted: isOwner flag');
        canBypass = true;
      } else if (req.user.permissions?.includes('owner_panel')) {
        console.log('[Maintenance] Bypass granted: has owner_panel permission');
        canBypass = true;
      }
    }

    if (canBypass) {
      console.log('[Maintenance] Bypass granted for user:', req.user?.username);
      return next();
    }

    // Render maintenance page for all other users
    return res.status(503).render('maintenance', {
      message: settings.maintenance_message || 'HyperCity is undergoing scheduled maintenance. Please check back soon.'
    });
  }

  // Maintenance mode is OFF – proceed normally
  next();
}

module.exports = maintenanceCheck;