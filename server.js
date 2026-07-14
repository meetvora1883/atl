require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { Server } = require('socket.io');
const { Client, GatewayIntentBits } = require('discord.js');

const passport = require('./config/passport');
const { attachUser, requireAuth } = require('./middleware/auth');
const { translationMiddleware, reloadTranslations } = require('./middleware/translations');
const maintenanceCheck = require('./middleware/maintenance');
const csrfProtection = require('./middleware/csrf');
const { initSockets } = require('./sockets');
const { requirePermission } = require('./middleware/roles');

// Auth & pages
const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');

// APIs
const userApi = require('./routes/api/user');
const settingsApi = require('./routes/api/settings');
const sessionsApi = require('./routes/api/sessions');
const ownerApi = require('./routes/api/owner');
const notificationsApi = require('./routes/api/notifications');
const membersApi = require('./routes/api/members');
const analyticsApi = require('./routes/api/analytics');
const eventsApi = require('./routes/api/events');
const translationsApi = require('./routes/api/translations');
const rolesApi = require('./routes/api/roles');
const userRolesApi = require('./routes/api/user-roles');
const permissionsApi = require('./routes/api/permissions');
const usersApi = require('./routes/api/users');
const consoleApi = require('./routes/api/console');
const systemApi = require('./routes/api/system');
const dbApi = require('./routes/api/db');
const warboardApi = require('./routes/api/warboard');
const attackPlansApi = require('./routes/attack-plans');
const flagCallsApi = require('./routes/api/flag_calls');
const { setupFlagCallInteractions } = require('./routes/api/flag_calls');

const { syncGuildMembers } = require('./routes/api/warboard');



const securityHeaders = require('./middleware/security-headers');
const { apiRateLimiter, authRateLimiter, blockIfFlagged } = require('./middleware/rate-limit');
const securityRoutes = require('./routes/security');




const app = express();
const server = http.createServer(app);
const io = new Server(server);

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'db') }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);



app.use(securityRoutes);
app.use(passport.initialize());
app.use(attachUser);
app.use(translationMiddleware);

app.use(securityHeaders);


app.use(csrfProtection);
app.use(maintenanceCheck);




app.use('/api', blockIfFlagged, apiRateLimiter());
app.use('/auth/login', authRateLimiter());



// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Auth
app.use('/auth', authRoutes);

// Pages
app.use('/', pageRoutes);

// API routes
app.use('/api/user', requireAuth, userApi);
app.use('/api/settings', requireAuth, settingsApi);
app.use('/api/sessions', requireAuth, sessionsApi);
app.use('/api/owner', requireAuth, ownerApi);
app.use('/api/notifications', requireAuth, notificationsApi);
app.use('/api/members', requireAuth, membersApi);
app.use('/api/analytics', requireAuth, analyticsApi);
app.use('/api/events', requireAuth, eventsApi);
app.use('/api/translations', translationsApi);
app.use('/api/roles', requireAuth, rolesApi);
app.use('/api/users', requireAuth, userRolesApi);
app.use('/api/permissions', requireAuth, permissionsApi);
app.use('/api/users', requireAuth, usersApi);
app.use('/api/console', requireAuth, consoleApi);
app.use('/api/system', requireAuth, systemApi);
app.use('/api/db', requireAuth, dbApi);
app.use('/api/warboard', requireAuth, warboardApi);
app.use('/api/warboard/flags', requireAuth, flagCallsApi);
app.use('/api/attack-plans', requireAuth, attackPlansApi);



app.use('/api', apiRateLimiter());

// Apply stricter rate limiting to login
app.use('/auth/login', authRateLimiter());



// Attack Plans page
app.get('/attack-plans', requireAuth, requirePermission('view_attack_plans'), (req, res) => {
  res.render('attack-plans', {
    user: req.user,
    csrfToken: req.session?.csrfToken || '',
    t: req.t || {},
    active: 'attack-plans'
  });
});

// 404
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you are looking for does not exist.',
  });
});

initSockets(io);
app.set('io', io);

const PORT = process.env.PORT || 6297;
server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  🎪 HyperCity Dashboard Starting  🎪  ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║  URL: ${process.env.DOMAIN || `http://localhost:${PORT}`}`);
  console.log(`║  Port: ${PORT}`);
  console.log(`║  Node: ${process.version.split('v')[1]}`);
  console.log(`║  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`╚════════════════════════════════════════╝\n`);

  const { cleanupSessions } = require('./db');
  cleanupSessions();
  setInterval(cleanupSessions, 3600000);
  console.log('[Scheduler] Session cleanup scheduled every hour.');

  syncGuildMembers();
  setInterval(syncGuildMembers, 5 * 60 * 1000);
  console.log('[Warboard] Guild member sync scheduled every 5 minutes.');
});

const botToken = process.env.DISCORD_BOT_TOKEN;
if (botToken) {
  const botClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]
  });

  botClient.once('ready', () => {
    console.log(`🤖 Discord bot logged in as ${botClient.user.tag}`);
    setupFlagCallInteractions(botClient);
  });

  botClient.login(botToken).catch(err => {
    console.error('❌ Failed to login Discord bot:', err.message);
  });
} else {
  console.warn('⚠️ DISCORD_BOT_TOKEN not set – Discord bot not started.');
}