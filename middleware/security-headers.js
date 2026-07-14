/**
 * middleware/security-headers.js
 *
 * Lightweight security headers – no CSP, no HSTS, no HTTPS enforcement.
 * Adds:
 *   - X-Frame-Options: SAMEORIGIN (protects against clickjacking)
 *   - X-Content-Type-Options: nosniff (prevents MIME type sniffing)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - X-XSS-Protection: 1; mode=block (deprecated but harmless)
 *
 * This does NOT include CSP, HSTS, or any HTTPS redirect, so it won't
 * interfere with your current HTTP setup.
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Control referrer info
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // XSS protection (browser built-in)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
}

module.exports = securityHeaders;