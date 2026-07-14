-- ============================================================
-- HyperCity Dashboard – Complete Schema
-- ============================================================

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id      TEXT UNIQUE NOT NULL,
  username        TEXT NOT NULL,
  discriminator   TEXT,
  avatar          TEXT,
  banner          TEXT,
  email           TEXT,
  bio             TEXT,
  timezone        TEXT DEFAULT 'UTC',
  last_login_at   TEXT,
  banned          INTEGER NOT NULL DEFAULT 0,
  banned_reason   TEXT,
  banned_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash    TEXT NOT NULL,
  prev_refresh_token_hash TEXT,
  prev_hash_expires_at  TEXT,
  device_type           TEXT,
  browser               TEXT,
  os                    TEXT,
  user_agent            TEXT,
  ip_address            TEXT,
  country               TEXT,
  remember              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at            TEXT NOT NULL,
  revoked_at            TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme       TEXT NOT NULL DEFAULT 'dark',
  language    TEXT NOT NULL DEFAULT 'en',
  email_notifications INTEGER NOT NULL DEFAULT 1,
  push_notifications INTEGER NOT NULL DEFAULT 1,
  profile_public INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#8b8fa3',
  icon        TEXT DEFAULT 'bi-shield',
  priority    INTEGER DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  protected   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  target_id   INTEGER,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owner_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT,
  action      TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  event_date  TEXT,
  reminder_minutes_before INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT UNIQUE NOT NULL,
  username    TEXT NOT NULL,
  avatar      TEXT,
  joined_at   TEXT,
  notes_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timeouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname    TEXT DEFAULT 'HyperCity Bot',
  avatar_url  TEXT,
  status      TEXT DEFAULT 'online',
  presence_text TEXT DEFAULT 'Watching over the city',
  modules_json TEXT DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS console_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  meta        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS translations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT UNIQUE NOT NULL,
  en          TEXT,
  hi          TEXT,
  gu          TEXT,
  ta          TEXT,
  te          TEXT,
  ru          TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS server_settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  maintenance_message TEXT DEFAULT 'HyperCity is undergoing scheduled maintenance. Please check back soon.',
  settings_json   TEXT DEFAULT '{}',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS failed_logins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT,
  reason      TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  icon        TEXT,
  color       TEXT DEFAULT '#4fd1ff'
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  widgets_json TEXT DEFAULT '["stats","announcements","activity"]',
  theme_json   TEXT DEFAULT '{}',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload_json TEXT DEFAULT '{}',
  cron_expr   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  size_bytes  INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- WARBOARD TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS warboard_buildings (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 5,
  max_shields INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warboard_garrison (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id       TEXT NOT NULL REFERENCES warboard_buildings(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  external_player_id INTEGER REFERENCES warboard_external_players(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(building_id, position)
);

-- ===== IMPORTANT: warboard_external_players includes 'might' column =====
CREATE TABLE IF NOT EXISTS warboard_external_players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  discord_id  TEXT UNIQUE,
  might       TEXT,            -- <-- external player might stored here
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warboard_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id TEXT,
  action      TEXT NOT NULL,
  target_id   TEXT,
  details     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS player_stats (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  might       TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PLAYER HERO IMAGES – supports both Discord & external
-- ============================================================
CREATE TABLE IF NOT EXISTS player_hero_images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  player_type       TEXT NOT NULL CHECK (player_type IN ('discord', 'external')),
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  external_player_id INTEGER REFERENCES warboard_external_players(id) ON DELETE CASCADE,
  image_path        TEXT NOT NULL,
  display_order     INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  CHECK (
    (player_type = 'discord' AND user_id IS NOT NULL AND external_player_id IS NULL) OR
    (player_type = 'external' AND external_player_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hero_images_discord ON player_hero_images (player_type, user_id);
CREATE INDEX IF NOT EXISTS idx_hero_images_external ON player_hero_images (player_type, external_player_id);

-- ============================================================
-- ATTACK PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS attack_plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id     TEXT NOT NULL REFERENCES warboard_buildings(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  our_might       TEXT,
  opponent_might  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (building_id, position)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attack_plans_building_user
  ON attack_plans (building_id, user_id);

CREATE INDEX IF NOT EXISTS idx_attack_plans_building
  ON attack_plans (building_id);

CREATE TABLE IF NOT EXISTS attack_plan_backups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    TEXT NOT NULL REFERENCES warboard_buildings(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (building_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attack_plan_backups_building
  ON attack_plan_backups (building_id, display_order);

-- ============================================================
-- FLAG CALLS
-- ============================================================
CREATE TABLE IF NOT EXISTS flag_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    TEXT NOT NULL REFERENCES warboard_buildings(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  call_type      TEXT NOT NULL CHECK (call_type IN ('attack', 'defend')),
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  message        TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flag_calls_building ON flag_calls (building_id);
CREATE INDEX IF NOT EXISTS idx_flag_calls_user ON flag_calls (user_id);
CREATE INDEX IF NOT EXISTS idx_flag_calls_target ON flag_calls (target_user_id);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Roles
INSERT OR IGNORE INTO roles (name, description, color, icon, priority, enabled, protected) VALUES
  ('owner', 'Full control of the dashboard and bot', '#ff5fae', 'bi-award', 100, 1, 1),
  ('developer', 'Access to console, API health and dev tools', '#4fd1ff', 'bi-code-square', 90, 1, 0),
  ('administrator', 'Manage users, roles, and server settings', '#ffb454', 'bi-shield-fill', 80, 1, 1),
  ('moderator', 'Manage members and moderation actions', '#7a8dff', 'bi-shield', 70, 1, 0),
  ('support', 'View-only access to help members', '#6bd98a', 'bi-headset', 60, 1, 0),
  ('member', 'Standard authenticated user', '#8b8fa3', 'bi-person', 50, 1, 1),
  ('guest', 'Limited read-only access', '#5b6178', 'bi-person-badge', 10, 1, 0);

-- Permissions
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('view_dashboard', 'View the main dashboard'),
  ('manage_users', 'View and manage other users'),
  ('manage_roles', 'Create, edit and delete roles'),
  ('manage_permissions', 'Assign permissions to roles'),
  ('view_analytics', 'View analytics and charts'),
  ('manage_bot', 'Manage bot settings and commands'),
  ('manage_events', 'Create and edit events'),
  ('moderate_members', 'Warn, timeout, and ban members'),
  ('console_access', 'Access the admin console'),
  ('owner_panel', 'Access the owner panel'),
  ('ban_users', 'Ban and unban users'),
  ('manage_user_roles', 'Assign or remove roles from users'),
  ('manage_sessions', 'Revoke user sessions'),
  ('bypass_maintenance', 'Bypass maintenance mode and access the dashboard during downtime'),
  ('manage_translations', 'Manage dashboard languages and translations'),
  ('view_warboard', 'View the clan warboard map'),
  ('manage_warboard', 'Manage warboard garrison assignments'),
  ('view_attack_plans', 'View the attack planning board'),
  ('manage_attack_plans', 'Create and edit attack plans'),
  ('view_flag_calls', 'View the Flag Call system'),
  ('manage_flag_calls', 'Manage Flag Call system (lock, restart, change votes, send Discord)');

-- Grant all permissions to 'owner'
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'owner';

-- Developer permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'developer'
  AND p.name IN ('view_dashboard', 'console_access', 'view_analytics');

-- Administrator permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'administrator'
  AND p.name IN ('view_dashboard', 'manage_users', 'manage_events', 'moderate_members', 'view_analytics',
                 'manage_roles', 'ban_users', 'manage_user_roles', 'manage_sessions', 'manage_translations',
                 'view_warboard', 'manage_warboard', 'view_attack_plans', 'manage_attack_plans',
                 'view_flag_calls', 'manage_flag_calls');

-- Moderator permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'moderator'
  AND p.name IN ('view_dashboard', 'moderate_members', 'view_warboard', 'view_attack_plans', 'view_flag_calls');

-- Support permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'support'
  AND p.name IN ('view_dashboard', 'view_warboard');

-- Member permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'member'
  AND p.name IN ('view_dashboard', 'view_warboard', 'view_attack_plans', 'view_flag_calls');

-- Server settings
INSERT OR IGNORE INTO server_settings (id, maintenance_mode) VALUES (1, 0);

-- Bot settings
INSERT OR IGNORE INTO bot_settings (id, nickname, presence_text) VALUES (1, 'HyperCity Bot', 'Watching over the city');

-- Translations (multilingual sample)
INSERT OR IGNORE INTO translations (key, en, hi, gu, ta, te, ru) VALUES
  ('nav.dashboard', 'Dashboard', 'डैशबोर्ड', 'ડેશબોર્ડ', 'டாஷ்போர்டு', 'డాష్‌బోర్డ్', 'Панель управления'),
  ('nav.members', 'Members', 'सदस्य', 'સભ્યો', 'உறுப்பினர்கள்', 'సభ్యులు', 'Участники'),
  ('nav.analytics', 'Analytics', 'विश्लेषण', 'વિશ્લેષણ', 'பகுப்பாய்வு', 'విశ్లేషణ', 'Аналитика'),
  ('nav.bot', 'Bot Manager', 'बॉट प्रबंधक', 'બોટ મેનેજર', 'பாட் மேலாளர்', 'బాట్ మేనేజర్', 'Менеджер бота'),
  ('nav.moderation', 'Moderation', 'मॉडरेशन', 'મોડરેશન', 'நடுநிலையாக்கம்', 'మోడరేషన్', 'Модерация'),
  ('nav.events', 'Events', 'कार्यक्रम', 'ઇવેન્ટ્સ', 'நிகழ்வுகள்', 'ఈవెంట్స్', 'События'),
  ('nav.settings', 'Settings', 'सेटिंग्स', 'સેટિંગ્સ', 'அமைப்புகள்', 'సెట్టింగ్స్', 'Настройки'),
  ('nav.owner', 'Owner Panel', 'ओनर पैनल', 'ઓનર પેનલ', 'உரிமையாளர் குழு', 'యజమాని ప్యానెల్', 'Панель владельца'),
  ('common.save', 'Save changes', 'सहेजें', 'સાચવો', 'சேமிக்கவும்', 'సేవ్ చేయండి', 'Сохранить'),
  ('common.logout', 'Log out', 'लॉग आउट', 'લોગ આઉટ', 'வெளியேறு', 'లాగ్ అవుట్', 'Выйти');

-- Warboard buildings (seed)
INSERT OR IGNORE INTO warboard_buildings (id, name, capacity, max_shields) VALUES
  ('boathouse', 'Boathouse', 2, 2),
  ('docks', 'Docks', 2, 2),
  ('eastern_bridge', 'Eastern Bridge', 3, 3),
  ('central_bridge', 'Central Bridge', 3, 3),
  ('western_bridge', 'Western Bridge', 3, 3),
  ('main_gate', 'Main Gate', 6, 6),
  ('scriptorium', 'Scriptorium', 3, 3),
  ('laboratory', 'Laboratory', 3, 3),
  ('tower_of_elements', 'Tower of Elements', 3, 3),
  ('tower_of_foresight', 'Tower of Foresight', 3, 3),
  ('citadel', 'Citadel', 9, 9);
  
  
  -- ============================================================
-- WARBOARD LOGS & UNDO (for activity history and undo)
-- ============================================================

CREATE TABLE IF NOT EXISTS warboard_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    TEXT,
  action         TEXT NOT NULL,
  actor_id       TEXT,
  actor_name     TEXT,
  actor_avatar   TEXT,
  target_id      TEXT,
  target_name    TEXT,
  details        TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  is_undo        INTEGER DEFAULT 0,
  undoable       INTEGER DEFAULT 1,
  undo_parent_id INTEGER,
  extra_data     TEXT
);

CREATE TABLE IF NOT EXISTS warboard_log_undo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id         INTEGER NOT NULL,
  undo_log_id    INTEGER NOT NULL,
  created_at     TEXT DEFAULT (datetime('now'))
);