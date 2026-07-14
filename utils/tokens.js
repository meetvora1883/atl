const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, discord_id: user.discord_id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function verifyAccessToken(token) {
  try {
    return { payload: jwt.verify(token, process.env.JWT_SECRET), expired: false };
  } catch (err) {
    return { payload: null, expired: err.name === 'TokenExpiredError' };
  }
}

function generateRefreshToken() {
  // Raw token sent to the client; only its SHA-256 hash is stored server-side.
  const raw = crypto.randomBytes(64).toString('hex');
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return { raw, hash, expiresAt };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
};
