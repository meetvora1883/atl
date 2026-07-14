/**
 * utils/signed-url.js
 *
 * Generate and verify signed URLs for temporary access to protected media.
 */
const crypto = require('crypto');

function generateSignedUrl(req, secret, key, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const base = `${key}.${expires}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(base)
    .digest('hex');
  return `${req.protocol}://${req.get('host')}/media/${base}.${signature}`;
}

function verifySignedRequest(req, secret) {
  // Expects the key parameter to be: "filename.expires.signature"
  const { key } = req.params;
  if (!key) return { valid: false, reason: 'missing_key' };

  const parts = key.split('.');
  if (parts.length < 3) return { valid: false, reason: 'invalid_format' };

  const signature = parts.pop();
  const base = parts.join('.');
  const [filename, expiresStr] = base.split('.');
  const expires = parseInt(expiresStr, 10);

  if (isNaN(expires) || Date.now() / 1000 > expires) {
    return { valid: false, reason: 'expired' };
  }

  const expected = crypto.createHmac('sha256', secret).update(base).digest('hex');
  if (signature !== expected) {
    return { valid: false, reason: 'bad_signature' };
  }

  return { valid: true, key: filename };
}

module.exports = { generateSignedUrl, verifySignedRequest };