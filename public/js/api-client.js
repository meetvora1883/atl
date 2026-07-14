/**
 * Global API client used by every page instead of raw fetch().
 *
 * Fixes two related bugs:
 *  1. "Token invalid" flashes after resizing / switching layout on mobile:
 *     that happened because several components each called fetch()
 *     independently, and when the access token had expired, EACH of them
 *     tried to refresh it at the same time. Refresh tokens rotate on use,
 *     so the first refresh call would succeed and the rest would see an
 *     already-rotated (and therefore "invalid") token.
 *     Fix: only ONE refresh request is ever in flight at a time
 *     (`refreshPromise` below). Every other call just waits on it.
 *  2. Invalid/expired tokens didn't consistently send the user back to the
 *     login page. Fix: any request that comes back 401 after a refresh
 *     attempt (or where refresh itself fails) redirects to `/`.
 */
(function (window) {
  let refreshPromise = null;

  function doRefresh(csrfToken) {
    if (!refreshPromise) {
      refreshPromise = fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
        .then((res) => res.ok)
        .catch(() => false)
        .finally(() => {
          // Clear after the microtask so concurrent callers still see the result.
          setTimeout(() => { refreshPromise = null; }, 0);
        });
    }
    return refreshPromise;
  }

  function goToLogin() {
    if (!window.location.pathname.startsWith('/') || window.location.pathname === '/') return;
    window.location.href = '/?sessionExpired=1';
  }

  async function apiFetch(url, options = {}) {
    const csrfToken = window.__CSRF_TOKEN__ || '';
    const opts = { ...options };
    opts.headers = { ...(options.headers || {}), 'x-csrf-token': csrfToken };

    let res = await fetch(url, opts);

    if (res.status === 401) {
      let body = null;
      try { body = await res.clone().json(); } catch (e) { /* ignore */ }
      const code = body && body.code;

      if (code === 'TOKEN_EXPIRED') {
        const refreshed = await doRefresh(csrfToken);
        if (refreshed) {
          res = await fetch(url, opts);
          if (res.status !== 401) return res;
        }
      }

      // Either refresh failed, or the token was never valid to begin with
      // (NO_TOKEN / INVALID_TOKEN / NO_USER) — nothing left to do but log out.
      goToLogin();
      return res;
    }

    return res;
  }

  window.apiFetch = apiFetch;
})(window);
