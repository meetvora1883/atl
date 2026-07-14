/**
 * pwa.js – Production PWA with robust install button hiding
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

// --- Immediately hide if already installed ---
if (installBtn) {
  if (isAppInstalled()) {
    installBtn.hidden = true;
    installBtn.style.display = 'none'; // extra safety
    console.log('[PWA] Button hidden (standalone mode)');
  }
}

// --- beforeinstallprompt: show only if NOT installed ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn && !isAppInstalled()) {
    installBtn.hidden = false;
    installBtn.style.display = ''; // restore if hidden
    console.log('[PWA] Install button shown');
  } else {
    // If installed, hide again (just in case)
    if (installBtn) {
      installBtn.hidden = true;
      installBtn.style.display = 'none';
    }
  }
});

// --- Click handler (unchanged) ---
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
        installBtn.style.display = 'none';
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

// --- appinstalled event ---
window.addEventListener('appinstalled', () => {
  if (installBtn) {
    installBtn.hidden = true;
    installBtn.style.display = 'none';
    console.log('[PWA] Button hidden after installation');
  }
});

// --- Continuous detection ---
function checkInstalledState() {
  if (isAppInstalled() && installBtn) {
    installBtn.hidden = true;
    installBtn.style.display = 'none';
    console.log('[PWA] Button hidden (standalone check)');
  }
}

// Run on DOM ready, visibility change, and display-mode change
document.addEventListener('DOMContentLoaded', checkInstalledState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkInstalledState();
});
const media = window.matchMedia('(display-mode: standalone)');
if (media.addEventListener) {
  media.addEventListener('change', checkInstalledState);
} else if (media.addListener) {
  media.addListener(checkInstalledState);
}

// Also run a safety check after 2 seconds (covers late events)
setTimeout(checkInstalledState, 2000);

console.log('[PWA] Initialization complete.');
