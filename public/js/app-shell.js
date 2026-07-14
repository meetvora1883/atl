/* global io, apiFetch */

(function () {
  // ---------- Sidebar (desktop collapse + mobile slide-in) ----------
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const moreBtn = document.getElementById('mobile-more-btn');

  if (localStorage.getItem('hc-sidebar-collapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }

  collapseBtn && collapseBtn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('hc-sidebar-collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
  });

  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('visible');
  }
  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
  }

  toggleBtn && toggleBtn.addEventListener('click', openMobileSidebar);
  moreBtn && moreBtn.addEventListener('click', openMobileSidebar);
  backdrop && backdrop.addEventListener('click', closeMobileSidebar);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > 900) closeMobileSidebar();
    }, 120);
  });

  // ---------- User menu dropdown ----------
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDropdown = document.getElementById('user-menu-dropdown');
  userMenuBtn && userMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    userMenuDropdown && userMenuDropdown.classList.remove('open');
    document.getElementById('notif-panel') && document.getElementById('notif-panel').classList.remove('open');
  });

  // ---------- Notifications ----------
  const notifBell = document.getElementById('notif-bell');
  const notifPanel = document.getElementById('notif-panel');
  const notifCount = document.getElementById('notif-count');
  const notifList = document.getElementById('notif-list');
  const notifMarkAll = document.getElementById('notif-mark-all');

  function renderNotifications(items) {
    if (!items.length) {
      notifList.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No notifications yet.</p>';
      return;
    }
    notifList.innerHTML = items
      .map(
        (n) => `
        <div class="notif-item notif-${n.type}">
          <div class="notif-item-title">${n.title}</div>
          <div class="notif-item-msg">${n.message}</div>
          <div class="notif-item-time">${n.created_at}</div>
        </div>`
      )
      .join('');
  }

  async function loadNotifications() {
    if (!window.apiFetch) return;
    try {
      const res = await window.apiFetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      renderNotifications(data.items);
      notifCount.style.display = data.unread > 0 ? 'flex' : 'none';
      notifCount.textContent = data.unread > 99 ? '99+' : data.unread;
    } catch (e) { /* ignore */ }
  }

  notifBell && notifBell.addEventListener('click', (e) => {
    e.stopPropagation();
    notifPanel.classList.toggle('open');
    if (notifPanel.classList.contains('open')) loadNotifications();
  });

  notifMarkAll && notifMarkAll.addEventListener('click', async () => {
    await window.apiFetch('/api/notifications/read-all', { method: 'POST' });
    loadNotifications();
  });

  loadNotifications();

  // ---------- Toasts ----------
  const toastContainer = document.getElementById('toast-container');
  window.showToast = function (type, title, message, duration) {
    if (!toastContainer) return;
    duration = duration || 5000;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: 'bi-check-circle', warning: 'bi-exclamation-triangle', error: 'bi-x-circle', info: 'bi-info-circle' };
    el.innerHTML = `
      <i class="bi ${icons[type] || icons.info}"></i>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-msg">${message}</div>` : ''}
      </div>
      <button class="toast-close"><i class="bi bi-x"></i></button>
      <div class="toast-timer"></div>
    `;
    toastContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const timerBar = el.querySelector('.toast-timer');
    timerBar.style.transitionDuration = duration + 'ms';
    requestAnimationFrame(() => { timerBar.style.transform = 'scaleX(0)'; });

    const remove = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    };
    const t = setTimeout(remove, duration);
    el.querySelector('.toast-close').addEventListener('click', () => { clearTimeout(t); remove(); });
  };

  // ---------- Count-up numbers ----------
  window.countUp = function (el, target, duration) {
    duration = duration || 1200;
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };
  document.querySelectorAll('[data-countup]').forEach((el) => {
    window.countUp(el, parseInt(el.dataset.countup, 10) || 0);
  });

  // ---------- Command palette (Ctrl+K) ----------
  const cmdkOverlay = document.getElementById('cmdk-overlay');
  const cmdkInput = document.getElementById('cmdk-input');
  const cmdkResults = document.getElementById('cmdk-results');
  const cmdkTrigger = document.getElementById('cmdk-trigger');

  const PAGES = [
    { label: 'Dashboard', icon: 'bi-speedometer2', href: '/dashboard' },
    { label: 'Members', icon: 'bi-people', href: '/members' },
    { label: 'Analytics', icon: 'bi-bar-chart-line', href: '/analytics' },
    { label: 'Bot Manager', icon: 'bi-robot', href: '/bot' },
    { label: 'Moderation', icon: 'bi-shield-exclamation', href: '/moderation' },
    { label: 'Events', icon: 'bi-calendar-event', href: '/events' },
    { label: 'Settings', icon: 'bi-gear', href: '/settings' },
    { label: 'Profile', icon: 'bi-person', href: '/profile' },
    { label: 'Active Sessions', icon: 'bi-laptop', href: '/sessions' },
    { label: 'Owner Panel', icon: 'bi-award', href: '/owner' },
  ];

  function renderCmdkResults(query) {
    const q = query.trim().toLowerCase();
    const filtered = q ? PAGES.filter((p) => p.label.toLowerCase().includes(q)) : PAGES;
    cmdkResults.innerHTML = filtered
      .map((p, i) => `<a href="${p.href}" class="cmdk-result ${i === 0 ? 'selected' : ''}"><i class="bi ${p.icon}"></i> ${p.label}</a>`)
      .join('') || '<div class="cmdk-empty">No matches</div>';
  }

  function openCmdk() {
    cmdkOverlay.classList.add('open');
    cmdkInput.value = '';
    renderCmdkResults('');
    setTimeout(() => cmdkInput.focus(), 50);
  }
  function closeCmdk() {
    cmdkOverlay.classList.remove('open');
  }

  cmdkTrigger && cmdkTrigger.addEventListener('click', openCmdk);
  cmdkOverlay && cmdkOverlay.addEventListener('click', (e) => { if (e.target === cmdkOverlay) closeCmdk(); });
  cmdkInput && cmdkInput.addEventListener('input', () => renderCmdkResults(cmdkInput.value));
  cmdkInput && cmdkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = cmdkResults.querySelector('.cmdk-result');
      if (first) window.location.href = first.getAttribute('href');
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      cmdkOverlay.classList.contains('open') ? closeCmdk() : openCmdk();
    }
    if (e.key === 'Escape') closeCmdk();
  });

  // ---------- Live updates via Socket.IO ----------
  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('notification', (payload) => {
      window.showToast(payload.type || 'info', payload.title, payload.message);
      loadNotifications();
    });
    window.hcSocket = socket;
  }

  // ---------- Loading screen fade-out ----------
  const loader = document.getElementById('hc-loading-screen');
  if (loader) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        loader.classList.add('fade-out');
        setTimeout(() => loader.remove(), 500);
      }, 400);
    });
  }

  // ---------- Reusable Confirmation Modal ----------
  const confirmModal = {
    el: document.getElementById('confirmationModal'),
    title: document.getElementById('confirmModalTitle'),
    message: document.getElementById('confirmModalMessage'),
    confirmBtn: document.getElementById('confirmModalConfirm'),
    cancelBtn: document.getElementById('confirmModalCancel'),
    closeBtn: document.getElementById('confirmModalClose'),
    callback: null,

    init() {
      if (!this.el) return;
      this.cancelBtn.addEventListener('click', () => this.close());
      this.closeBtn.addEventListener('click', () => this.close());
      this.el.addEventListener('click', (e) => {
        if (e.target === this.el) this.close();
      });
      this.confirmBtn.addEventListener('click', () => {
        if (typeof this.callback === 'function') this.callback();
        this.close();
      });
      // Ensure modal is hidden initially
      this.el.classList.remove('open');
    },

    open(options) {
      if (!this.el) return;
      this.title.textContent = options.title || 'Confirm';
      this.message.textContent = options.message || 'Are you sure?';
      this.confirmBtn.textContent = options.confirmText || 'Confirm';
      this.confirmBtn.className = options.confirmClass || 'btn btn-danger';
      this.callback = options.onConfirm || null;
      this.el.classList.add('open');
      document.body.style.overflow = 'hidden';
    },

    close() {
      if (!this.el) return;
      this.el.classList.remove('open');
      document.body.style.overflow = '';
      this.callback = null;
    }
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => confirmModal.init());
  } else {
    confirmModal.init();
  }

  // Expose globally so other scripts can use it
  window.confirmModal = confirmModal;

  console.log('[App Shell] Initialised.');
})();