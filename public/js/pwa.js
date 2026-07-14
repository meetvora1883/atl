/**
 * pwa.js – Production-ready PWA with toast notifications
 * Uses the existing window.showToast from app-shell.js
 */
console.log('[PWA] Initializing...');

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
      .then(reg => {
        console.log('[PWA] SW registered');
        setInterval(() => reg.update(), 60 * 60 * 1000);
      })
      .catch(err => console.error('[PWA] SW registration failed', err));
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// ---------- Install Button Logic ----------
let deferredPrompt = null;
const installBtn = document.getElementById('installAppBtn');

function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Reliable secure‑origin check (HTTPS or localhost)
function isSecureContext() {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return protocol === 'https:' ||
         hostname === 'localhost' ||
         hostname === '127.0.0.1';
}

// Hide button if:
// - already installed, or
// - not a secure context (HTTP + non‑localhost)
if ((isAppInstalled() || !isSecureContext()) && installBtn) {
  installBtn.hidden = true;
  if (!isSecureContext()) {
    console.warn('[PWA] Not a secure context – install disabled.');
  }
}

// Show button when browser fires beforeinstallprompt (only on secure origins)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn && !isAppInstalled() && isSecureContext()) {
    installBtn.hidden = false;
    console.log('[PWA] Install button shown');
  }
});

// Click handler
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    // 1. First, check if we are in a secure context
    if (!isSecureContext()) {
      window.showToast('error', 'HTTPS Required', 'App installation requires a secure HTTPS connection.');
      return; // exit early – no spinner, no preparing toast
    }

    // 2. Disable button and show spinner
    installBtn.disabled = true;
    installBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Installing...';

    // 3. Show preparing toast (only now that we know it's secure)
    if (typeof window.showToast === 'function') {
      window.showToast('info', 'Preparing Installation', 'The installation dialog is opening...');
    }

    // 4. Check if prompt is available
    if (!deferredPrompt) {
      let msg = '';
      if (isAppInstalled()) {
        msg = 'HyperCity Dashboard is already installed on this device.';
        window.showToast('info', 'Already Installed', msg);
      } else {
        msg = 'Your browser does not support installing this application.';
        window.showToast('error', 'Installation Unavailable', msg);
      }
      installBtn.disabled = false;
      installBtn.innerHTML = '<i class="bi bi-download"></i> Install App';
      return;
    }

    // 5. Show the native prompt
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;

      if (outcome === 'accepted') {
        window.showToast('success', 'Installation Successful', '🎉 HyperCity Dashboard installed successfully! You can now launch it directly from your Home Screen or Desktop.');
        installBtn.hidden = true;
      } else {
        window.showToast('warning', 'Installation Cancelled', 'Installation was cancelled. You can install HyperCity Dashboard anytime from the profile menu.');
      }
    } catch (err) {
      console.error('[PWA] Install error', err);
      window.showToast('error', 'Installation Failed', 'Installation failed. Please try again later.');
    } finally {
      // Re‑enable button if still visible
      if (!installBtn.hidden) {
        installBtn.disabled = false;
        installBtn.innerHTML = '<i class="bi bi-download"></i> Install App';
      }
    }
  });
}

// Listen for successful installation (catch‑all)
window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.hidden = true;
});

// Detect standalone mode on startup and after changes
function checkInstalledState() {
  if (isAppInstalled() && installBtn) installBtn.hidden = true;
}
document.addEventListener('DOMContentLoaded', checkInstalledState);
const media = window.matchMedia('(display-mode: standalone)');
if (media.addEventListener) media.addEventListener('change', checkInstalledState);
else if (media.addListener) media.addListener(checkInstalledState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkInstalledState();
});

console.log('[PWA] Initialization complete.');
