/**
 * public/js/deterrents.js
 *
 * COSMETIC DETERRENT + VISUAL WARNING.
 *
 * This runs in the browser and can be disabled by the user.
 * It does NOT provide real security – all sensitive data is
 * protected server‑side via authentication, authorization,
 * rate limiting, CSRF, and signed URLs.
 *
 * What this does:
 *   - Detects if DevTools is likely open (window size delta).
 *   - Shows a full‑screen security warning overlay.
 *   - Clears sensitive DOM content and application state.
 *   - Aborts pending API requests.
 *   - Disconnects WebSocket connections.
 *   - Redirects to /security-notice after a short delay.
 *
 * This is intended to reduce casual inspection and copying
 * of page assets, not to be a security boundary.
 */
(function () {
  'use strict';

  // ---------- Configuration ----------
  const CONFIG = {
    sizeThresholdPx: 160, // generous to reduce false positives
    reportEndpoint: '/api/security/report-devtools-heuristic',
    warningPage: '/security-notice',
    abortPendingRequests: true,
    disconnectWebsockets: true,
    clearSessionStorage: true,
    clearLocalStorage: false, // optional – be careful not to break user preferences
    redirectAfterMs: 1500,
  };

  // ---------- Utilities ----------
  function report(reason) {
    try {
      fetch(CONFIG.reportEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.__CSRF_TOKEN__ || '',
        },
        body: JSON.stringify({ reason }),
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  }

  // ---------- DOM / State Cleanup ----------
  function clearSensitiveContent() {
    // Remove all hero images and galleries
    document.querySelectorAll('.hero-gallery, .hero-card, .garrison-slot, .warboard-container').forEach(el => {
      el.innerHTML = '';
      el.textContent = 'Content unavailable in this session.';
    });

    // Remove user data from any visible elements
    document.querySelectorAll('[data-user], [data-discord-id], [data-might]').forEach(el => {
      el.removeAttribute('data-user');
      el.removeAttribute('data-discord-id');
      el.removeAttribute('data-might');
    });

    // Clear any inline scripts that may hold data
    const scripts = document.querySelectorAll('script[data-sensitive]');
    scripts.forEach(el => el.remove());

    // Hide any visible sensitive panels
    document.querySelectorAll('.profile-panel, .user-menu, .settings-panel').forEach(el => {
      el.style.display = 'none';
    });
  }

  function clearApplicationState() {
    if (CONFIG.clearSessionStorage) {
      try { sessionStorage.clear(); } catch (_) {}
    }
    if (CONFIG.clearLocalStorage) {
      try { localStorage.removeItem('user'); } catch (_) {}
    }
    // Reset global variables if any
    if (window.__appState) window.__appState = {};
    if (window.__user) window.__user = null;
  }

  function abortApiRequests() {
    if (!CONFIG.abortPendingRequests) return;
    // Abort any fetch requests using AbortController
    if (window.__abortController) {
      window.__abortController.abort();
      window.__abortController = null;
    }
    // Cancel any pending XHR requests
    if (window.__pendingXHR) {
      window.__pendingXHR.forEach(xhr => {
        try { xhr.abort(); } catch (_) {}
      });
      window.__pendingXHR = [];
    }
  }

  function disconnectWebsockets() {
    if (!CONFIG.disconnectWebsockets) return;
    // Close any Socket.IO connections
    if (window.io && window.io.socket) {
      try { window.io.socket.disconnect(); } catch (_) {}
    }
    // Close any raw WebSockets
    if (window.__ws) {
      try { window.__ws.close(); } catch (_) {}
    }
  }

  // ---------- Full‑screen warning overlay ----------
  function showWarning() {
    // Prevent duplicate overlays
    if (document.getElementById('__security_warning_overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = '__security_warning_overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0c0a1e 0%, #1a0a2e 50%, #0c0a1e 100%);
      color: #f2efff;
      font-family: 'Inter', -apple-system, sans-serif;
      padding: 24px;
      text-align: center;
      animation: fadeInWarning 0.5s ease;
    `;

    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeInWarning {
        0% { opacity: 0; transform: scale(0.95); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes pulseGlow {
        0%, 100% { text-shadow: 0 0 20px rgba(255, 95, 174, 0.3); }
        50% { text-shadow: 0 0 40px rgba(255, 95, 174, 0.7), 0 0 80px rgba(88, 101, 242, 0.3); }
      }
      @keyframes spinShield {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    overlay.innerHTML = `
      <div style="font-size: 4rem; margin-bottom: 20px; animation: pulseGlow 2s ease-in-out infinite;">
        🛡️
      </div>
      <h1 style="font-size: 2.2rem; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em;">
        Developer Tools Detected
      </h1>
      <p style="color: #9a92bd; max-width: 480px; font-size: 1.1rem; line-height: 1.6; margin: 8px 0 20px;">
        Protected resources are not available in this session.<br>
        Please close developer tools and refresh the page to continue.
      </p>
      <div style="display: flex; gap: 12px; margin-top: 8px;">
        <span style="
          background: rgba(255,255,255,0.06);
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 0.75rem;
          color: #9a92bd;
          border: 1px solid rgba(255,255,255,0.06);
        ">🔒 Secured Session</span>
        <span style="
          background: rgba(255,255,255,0.06);
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 0.75rem;
          color: #9a92bd;
          border: 1px solid rgba(255,255,255,0.06);
        ">⛔ Access Denied</span>
      </div>
      <div style="margin-top: 28px;">
        <div style="
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top: 3px solid #5865f2;
          border-radius: 50%;
          animation: spinShield 1.2s linear infinite;
          display: inline-block;
        "></div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Clear content
    clearSensitiveContent();
    clearApplicationState();
    abortApiRequests();
    disconnectWebsockets();

    // Report the event
    report('window_size_delta_warning');

    // Redirect after delay
    if (CONFIG.redirectAfterMs > 0) {
      setTimeout(() => {
        window.location.href = CONFIG.warningPage;
      }, CONFIG.redirectAfterMs);
    }
  }

  // ---------- Heuristic detection ----------
  let warned = false;

  function checkDevTools() {
    if (warned) return;
    const widthDelta = window.outerWidth - window.innerWidth;
    const heightDelta = window.outerHeight - window.innerHeight;
    if (widthDelta > CONFIG.sizeThresholdPx || heightDelta > CONFIG.sizeThresholdPx) {
      warned = true;
      showWarning();
    }
  }

  // ---------- Debounced resize listener ----------
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(checkDevTools, 400);
  });

  // Initial check after load
  window.addEventListener('load', () => setTimeout(checkDevTools, 1000));

  // Also check periodically (some DevTools are opened without resize)
  setInterval(checkDevTools, 3000);

  // Expose the warning function for manual testing (optional)
  window.__securityShowWarning = showWarning;
})();