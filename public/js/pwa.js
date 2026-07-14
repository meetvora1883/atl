/**
 * pwa.js – Production-ready PWA with toast notifications
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

// Reliable secure‑origin check
function isSecureContext() {
  // Check protocol and hostname
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const isHttps = protocol === 'https:';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isSecure = isHttps || isLocalhost;
  console.log('[PWA] Secure context check:', { protocol, hostname, isSecure });
  return isSecure;
}

// Hide button if not secure or already installed
if (installBtn) {
  if (isAppInstalled() || !isSecureContext()) {
    installBtn.hidden = true;
    if (!isSecureContext()) {
      console.warn('[PWA] Not a secure context – install disabled.');
    }
  }
}

// Show button when browser fires beforeinstallprompt
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
    if (!isSecureContext()) {
      window.showToast('error', 'HTTPS Required', 'App installation requires a secure HTTPS connection.');
      return;
    }

    installBtn.disabled = true;
    installBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Installing...';
    window.showToast('info', 'Preparing Installation', 'The installation dialog is opening...');

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
      if (!installBtn.hidden) {
        installBtn.disabled = false;
        installBtn.innerHTML = '<i class="bi bi-download"></i> Install App';
      }
    }
  });
}

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.hidden = true;
});

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
