const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { findOrCreateUser, assignDefaultRole, ensureDefaultSettings } = require('../db');

// Owner IDs are only used by the optional script (add-owners.js) – not here.
// The passport strategy will NOT assign the owner role automatically.

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ['identify', 'email'],
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const avatarUrl = profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : null;

        const user = findOrCreateUser({
          discord_id: profile.id,
          username: profile.username,
          discriminator: profile.discriminator || null,
          avatar: avatarUrl,
            banner: null,
          email: profile.email || null,
        });

        // Assign the default 'member' role
        assignDefaultRole.run(user.id, null);
        ensureDefaultSettings(user.id);

        // We no longer assign 'owner' here – run scripts/add-owners.js after login.
        // If you want to keep automatic assignment, uncomment the block below:
        /*
        if (OWNER_IDS.includes(profile.id)) {
          assignRoleByName.run(user.id, 'owner', null);
        }
        */

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;