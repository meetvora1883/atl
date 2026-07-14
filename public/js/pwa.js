/**
 * pwa.js – Final production version
 * Uses beforeinstallprompt as the single source of truth.
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

// Hide button if already installed
if (isAppInstalled() && installBtn) {
  installBtn.hidden = true;
}

// Show button ONLY when beforeinstallprompt fires
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn && !isAppInstalled()) {
    installBtn.hidden = false;
    console.log('[PWA] Install button shown');
  }
});

// Click handler
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      if (isAppInstalled()) {
        window.showToast('info', 'Already Installed', 'HyperCity Dashboard is already installed on this device.');
      } else {
        window.showToast('error', 'Installation Unavailable', 'Your browser does not support installing this application.');
      }
      return;
    }

    // Disable button, show spinner
    installBtn.disabled = true;
    installBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Installing...';
    window.showToast('info', 'Preparing Installation', 'The installation dialog is opening...');

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
