(function () {
  'use strict';

  const API_BASE = '/api/attack-plans';
  const csrfToken = (window.__ATTACK_PLANNING__ || {}).csrfToken || '';

  const el = {
    buildingSelect: document.getElementById('ap-building'),
    slots: document.getElementById('ap-slots'),
    backups: document.getElementById('ap-backups'),
    addBackupBtn: document.getElementById('ap-add-backup'),
    tableBody: document.getElementById('ap-table-body'),
    tableBackupsList: document.getElementById('ap-table-backups-list'),
    previewText: document.getElementById('ap-preview-text'),
    copyBtn: document.getElementById('ap-copy'),
    clearAllBtn: document.getElementById('ap-clear-all'),
    clearModal: document.getElementById('ap-clear-modal'),
    clearModalClose: document.querySelector('.ap-clear-modal-close'),
    clearCancel: document.getElementById('ap-clear-cancel'),
    clearConfirmInput: document.getElementById('ap-clear-confirm-input'),
    clearDeleteBtn: document.getElementById('ap-clear-delete-btn'),
    clearLoading: document.getElementById('ap-clear-loading'),
    clearError: document.getElementById('ap-clear-error'),
  };

  let state = {
    buildings: [],
    currentBuildingId: null,
    plan: null,
    modalTarget: null,
    isModalOpen: false,
    selectedIndex: -1,
    allPlayers: [],
    filteredPlayers: [],
    isClearing: false,
  };

  const saveTimers = new Map();

  // Global toast wrapper
  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      const container = document.getElementById('toastContainer') || document.body;
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `
        <i class="bi bi-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <div><div class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div><div class="toast-msg">${message}</div></div>
        <button class="toast-close">&times;</button>
      `;
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }
  }

  // API
  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const message = (data && data.error) || 'Something went wrong.';
      throw new Error(message);
    }
    return data;
  }

  function avatarUrl(player) {
    return player?.avatar || '/img/default-avatar.png';
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Load buildings & plan
  async function loadBuildings() {
    const data = await api('/');
    state.buildings = data.buildings;
    el.buildingSelect.innerHTML = state.buildings
      .map(b => `<option value="${b.id}">${escapeHtml(b.name)} (${b.filledSlots}/${b.capacity})</option>`)
      .join('');
    if (state.buildings.length) {
      state.currentBuildingId = state.buildings[0].id;
      el.buildingSelect.value = state.currentBuildingId;
      await loadPlan(state.currentBuildingId);
    }
  }

  el.buildingSelect.addEventListener('change', async (e) => {
    state.currentBuildingId = e.target.value;
    state.plan = null;
    await loadPlan(state.currentBuildingId);
  });

  async function loadPlan(buildingId) {
    const plan = await api('/' + buildingId);
    state.plan = plan;
    renderAll();
  }

  // Rendering
  function renderAll() {
    renderSlots();
    renderBackups();
    renderTable();
    renderPreview();
    updateFilledCount();
  }

  function updateFilledCount() {
    const filled = state.plan.slots.filter(s => s.player).length;
    const total = state.plan.building.capacity;
    document.getElementById('ap-filled-count').textContent = `${filled} / ${total}`;
  }

  function slotByPosition(position) {
    return state.plan.slots.find(s => s.position === position) || null;
  }

  function renderSlots() {
    const { building } = state.plan;
    let html = '';
    for (let position = 0; position < building.capacity; position++) {
      const slot = slotByPosition(position);
      const filled = !!slot?.player;
      html += `
        <div class="ap-slot ${filled ? 'is-filled' : ''}" data-position="${position}">
          <div class="ap-slot-label">Attacker ${position + 1}</div>
          <div class="ap-slot-player ${filled ? '' : 'is-empty'}" data-action="pick-player" data-position="${position}">
            ${filled ? `
              <img class="ap-avatar" src="${avatarUrl(slot.player)}" alt="">
              <span class="ap-slot-name">${escapeHtml(slot.player.username)}</span>
              ${slot.player.storedMight ? `<span class="ap-slot-stored-might">${escapeHtml(slot.player.storedMight)}</span>` : ''}
            ` : `<span>+ Select Player</span>`}
          </div>
          <div class="ap-slot-inputs">
            <div class="ap-input-group">
              <label>Our Might</label>
              <input type="text" class="ap-input" data-field="ourMight" data-position="${position}"
                     value="${escapeHtml(slot?.ourMight || '')}" ${filled ? '' : 'disabled'} placeholder="e.g. 6.6k">
            </div>
            <div class="ap-input-group">
              <label>Opponent Might</label>
              <input type="text" class="ap-input" data-field="opponentMight" data-position="${position}"
                     value="${escapeHtml(slot?.opponentMight || '')}" ${filled ? '' : 'disabled'} placeholder="e.g. 7.2k">
            </div>
          </div>
          ${filled ? `<button class="ap-slot-remove" data-action="remove-slot" data-position="${position}">
            <i class="bi bi-trash3"></i> Remove
          </button>` : ''}
        </div>
      `;
    }
    el.slots.innerHTML = html;
  }

  function renderBackups() {
    const { backups } = state.plan;
    if (!backups.length) {
      el.backups.innerHTML = `<span class="ap-empty-hint">No backup players added yet.</span>`;
      return;
    }
    el.backups.innerHTML = backups.map(b => `
      <div class="ap-backup-chip" data-backup-id="${b.backupId}">
        <img class="ap-avatar" src="${avatarUrl(b.player)}" alt="">
        <span class="ap-slot-name">${escapeHtml(b.player.username)}</span>
        <button class="ap-backup-remove" data-action="remove-backup" data-backup-id="${b.backupId}">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    `).join('');
  }

  function renderTable() {
    const filled = state.plan.slots.filter(s => s.player);
    if (!filled.length) {
      el.tableBody.innerHTML = `<tr><td colspan="3" class="ap-empty-hint">No attackers assigned yet.</td></tr>`;
    } else {
      el.tableBody.innerHTML = filled.map(s => `
        <tr>
          <td>${s.position + 1}</td>
          <td>
            <div class="ap-table-player">
              <img class="ap-avatar" src="${avatarUrl(s.player)}" alt="">
              <span>${escapeHtml(s.player.username)}</span>
            </div>
          </td>
          <td>${escapeHtml(s.opponentMight || '—')}</td>
        </tr>
      `).join('');
    }
    el.tableBackupsList.innerHTML = state.plan.backups.length
      ? state.plan.backups.map(b => `<li>${escapeHtml(b.player.username)}</li>`).join('')
      : `<li class="ap-empty-hint">None</li>`;
  }

  // Preview & Copy – always simple list
  function buildSimpleText(withMentions) {
    const { building, slots, backups } = state.plan;
    const lines = [building.name, ''];
    slots
      .filter(s => s.player)
      .sort((a, b) => a.position - b.position)
      .forEach(s => {
        const player = s.player;
        let display = withMentions
          ? (player.discord_id ? `<@${player.discord_id}>` : player.username)
          : player.username;
        if (s.ourMight) display += ` ${s.ourMight}`;
        lines.push(display);
      });
    if (backups.length) {
      lines.push('', 'Backup', '');
      backups.forEach(b => {
        const player = b.player;
        let display = withMentions
          ? (player.discord_id ? `<@${player.discord_id}>` : player.username)
          : player.username;
        lines.push(display);
      });
    }
    return lines.join('\n');
  }

  function renderPreview() {
    el.previewText.textContent = buildSimpleText(false); // preview shows usernames
  }

  el.copyBtn.addEventListener('click', async () => {
    const text = buildSimpleText(true); // copy with mentions
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'success');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied to clipboard', 'success');
    }
  });

  // Slot & backup interactions
  el.slots.addEventListener('click', (e) => {
    const pickTarget = e.target.closest('[data-action="pick-player"]');
    if (pickTarget) {
      openPlayerModal({ type: 'slot', position: Number(pickTarget.dataset.position) });
      return;
    }
    const removeTarget = e.target.closest('[data-action="remove-slot"]');
    if (removeTarget) {
      removeSlot(Number(removeTarget.dataset.position));
    }
  });

  el.slots.addEventListener('input', (e) => {
    const input = e.target.closest('.ap-input');
    if (!input) return;
    const position = Number(input.dataset.position);
    const field = input.dataset.field;
    const slot = slotByPosition(position);
    if (!slot) return;
    slot[field] = input.value;
    renderPreview();
    renderTable();
    debouncedSave(`slot-${position}`, () => saveSlot(position));
  });

  async function saveSlot(position) {
    const slot = slotByPosition(position);
    if (!slot || !slot.player) return;
    try {
      const plan = await api('', {
        method: 'PUT',
        body: { buildingId: state.plan.building.id, position, ourMight: slot.ourMight, opponentMight: slot.opponentMight }
      });
      state.plan = plan;
      renderAll();
      await refreshPlayersIfModalOpen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function removeSlot(position) {
    try {
      const plan = await api(`/${state.plan.building.id}/${position}`, { method: 'DELETE' });
      state.plan = plan;
      renderAll();
      await refreshPlayersIfModalOpen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  el.addBackupBtn.addEventListener('click', () => openPlayerModal({ type: 'backup' }));

  el.backups.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-backup"]');
    if (!btn) return;
    removeBackup(Number(btn.dataset.backupId));
  });

  async function addBackup(userId) {
    try {
      const plan = await api('/backups', {
        method: 'POST',
        body: { buildingId: state.plan.building.id, userId }
      });
      state.plan = plan;
      renderAll();
      await refreshPlayersIfModalOpen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function removeBackup(backupId) {
    try {
      const plan = await api(`/backups/${backupId}`, { method: 'DELETE' });
      state.plan = plan;
      renderAll();
      await refreshPlayersIfModalOpen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Player modal
  let modalListenersAttached = false;

  function attachModalListeners() {
    if (modalListenersAttached) return;
    modalListenersAttached = true;
    el.modalClose = document.querySelector('.ap-modal-close');
    el.modalSearch = document.getElementById('ap-player-search');
    el.modalResults = document.getElementById('ap-player-results');
    el.modalOverlay = document.getElementById('ap-player-modal');

    el.modalClose.addEventListener('click', closePlayerModal);
    el.modalOverlay.addEventListener('click', (e) => {
      if (e.target === el.modalOverlay) closePlayerModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isModalOpen) closePlayerModal();
    });

    let searchTimer = null;
    el.modalSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value;
      searchTimer = setTimeout(() => filterPlayers(q), 150);
    });

    el.modalResults.addEventListener('click', (e) => {
      const item = e.target.closest('.ap-player-result');
      if (!item) return;
      const userId = item.dataset.userId;
      if (state.plan.slots.some(s => s.player && s.player.userId == userId)) {
        showToast('Player already assigned to this building.', 'warning');
        return;
      }
      selectPlayer(userId);
    });

    el.modalResults.addEventListener('keydown', (e) => {
      const items = el.modalResults.querySelectorAll('.ap-player-result:not([data-disabled="true"])');
      if (!items.length) return;
      let idx = state.selectedIndex;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1) % items.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = items[idx];
        if (selected) {
          const userId = selected.dataset.userId;
          selectPlayer(userId);
        }
        return;
      } else {
        return;
      }
      state.selectedIndex = idx;
      items.forEach((el, i) => {
        el.tabIndex = i === idx ? 0 : -1;
        if (i === idx) el.focus();
      });
    });
  }

  function openPlayerModal(target) {
    state.modalTarget = target;
    state.isModalOpen = true;
    el.modalOverlay.hidden = false;
    el.modalSearch.value = '';
    el.modalResults.innerHTML = '';
    state.selectedIndex = -1;
    document.body.style.overflow = 'hidden';
    if (state.allPlayers.length === 0) {
      showLoadingSkeletons();
      loadAllPlayers().then(() => {
        filterPlayers('');
      }).catch(err => {
        showToast(err.message, 'error');
        el.modalResults.innerHTML = `<div class="ap-empty-state"><i class="bi bi-exclamation-triangle"></i><p>Failed to load players.</p></div>`;
      });
    } else {
      filterPlayers('');
    }
    setTimeout(() => el.modalSearch.focus(), 100);
  }

  function closePlayerModal() {
    state.isModalOpen = false;
    el.modalOverlay.hidden = true;
    state.modalTarget = null;
    state.selectedIndex = -1;
    document.body.style.overflow = '';
  }

  async function loadAllPlayers() {
    const data = await api('/players?q=');
    state.allPlayers = data.players;
  }

  function showLoadingSkeletons() {
    const skeletons = Array.from({ length: 5 }, () => `
      <div class="ap-skeleton">
        <div class="ap-skeleton-avatar"></div>
        <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
          <div class="ap-skeleton-line"></div>
          <div class="ap-skeleton-line" style="width:40%;"></div>
        </div>
      </div>
    `).join('');
    el.modalResults.innerHTML = skeletons;
  }

  function filterPlayers(query) {
    const q = query.trim().toLowerCase();
    let filtered = state.allPlayers;
    if (q) {
      filtered = state.allPlayers.filter(p =>
        p.username.toLowerCase().includes(q) ||
        p.discordId.includes(q) ||
        (p.storedMight && p.storedMight.toLowerCase().includes(q))
      );
    }
    state.filteredPlayers = filtered;
    renderPlayerResults(filtered);
  }

  function renderPlayerResults(players) {
    if (!players.length) {
      el.modalResults.innerHTML = `
        <div class="ap-empty-state">
          <i class="bi bi-search"></i>
          <p>No Players Found</p>
          <p class="ap-empty-sub">Try another search.</p>
        </div>
      `;
      return;
    }

    const assignedUserIds = state.plan.slots.filter(s => s.player).map(s => s.player.userId);

    const items = players.map(p => {
      const assigned = assignedUserIds.includes(p.userId);
      const attackAssignments = p.attackAssignments || [];
      const backupAssignments = p.backupAssignments || [];

      let assignmentsHtml = '';
      if (attackAssignments.length || backupAssignments.length) {
        if (attackAssignments.length) {
          assignmentsHtml += `<div class="ap-assignment-group"><span class="ap-badge-attack">ATTACKING</span> ${attackAssignments.map(name => `<span class="ap-building-name">${escapeHtml(name)}</span>`).join(', ')}</div>`;
        }
        if (backupAssignments.length) {
          assignmentsHtml += `<div class="ap-assignment-group"><span class="ap-badge-backup">BACKUP</span> ${backupAssignments.map(name => `<span class="ap-building-name">${escapeHtml(name)}</span>`).join(', ')}</div>`;
        }
      } else {
        assignmentsHtml = `<div class="ap-assignment-group" style="color:var(--text-muted);">No current assignments</div>`;
      }

      return `
        <li class="ap-player-result" data-user-id="${p.userId}" data-disabled="${assigned}" tabindex="0" role="option">
          <img class="ap-avatar" src="${avatarUrl(p)}" alt="">
          <div class="ap-info">
            <div>
              <span class="ap-slot-name">${escapeHtml(p.username)}</span>
              ${p.storedMight ? `<span class="ap-slot-stored-might">${escapeHtml(p.storedMight)}</span>` : ''}
            </div>
            <div class="ap-discord-id">${p.discordId ? `ID: ${escapeHtml(p.discordId)}` : ''}</div>
            ${assignmentsHtml}
          </div>
          ${assigned ? `<span class="ap-assigned-badge">Assigned</span>` : `<button class="ap-select-btn">Select</button>`}
        </li>
      `;
    });

    el.modalResults.innerHTML = items.join('');
  }

  async function selectPlayer(userId) {
    const target = state.modalTarget;
    if (!target) return;
    if (state.plan.slots.some(s => s.player && s.player.userId == userId)) {
      showToast('Player already assigned to this building.', 'warning');
      closePlayerModal();
      return;
    }
    closePlayerModal();
    if (target.type === 'backup') {
      await addBackup(userId);
    } else if (target.type === 'slot') {
      await pickPlayerForSlot(target.position, userId);
    }
  }

  async function pickPlayerForSlot(position, userId) {
    const found = state.allPlayers.find(p => p.userId == userId);
    const ourMight = found?.storedMight || '';
    try {
      const plan = await api('', {
        method: 'POST',
        body: {
          buildingId: state.plan.building.id,
          position,
          userId,
          ourMight,
          opponentMight: slotByPosition(position)?.opponentMight || ''
        }
      });
      state.plan = plan;
      renderAll();
      await refreshPlayersIfModalOpen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function refreshPlayersIfModalOpen() {
    if (state.isModalOpen) {
      await loadAllPlayers();
      filterPlayers(el.modalSearch.value);
    }
  }

  attachModalListeners();

  function debouncedSave(key, fn, delay = 500) {
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(fn, delay));
  }

  // Clear All
  el.clearAllBtn.addEventListener('click', () => {
    el.clearModal.hidden = false;
    el.clearConfirmInput.value = '';
    el.clearDeleteBtn.disabled = true;
    el.clearLoading.style.display = 'none';
    el.clearError.style.display = 'none';
    document.body.style.overflow = 'hidden';
    el.clearConfirmInput.focus();
  });

  function closeClearModal() {
    el.clearModal.hidden = true;
    document.body.style.overflow = '';
  }

  el.clearModalClose.addEventListener('click', closeClearModal);
  el.clearCancel.addEventListener('click', closeClearModal);
  el.clearModal.addEventListener('click', (e) => {
    if (e.target === el.clearModal) closeClearModal();
  });

  el.clearConfirmInput.addEventListener('input', () => {
    el.clearDeleteBtn.disabled = el.clearConfirmInput.value !== 'CONFIRM';
  });

  el.clearDeleteBtn.addEventListener('click', async () => {
    if (el.clearDeleteBtn.disabled || state.isClearing) return;
    state.isClearing = true;
    el.clearDeleteBtn.disabled = true;
    el.clearLoading.style.display = 'block';
    el.clearError.style.display = 'none';

    try {
      await api('/clear', { method: 'POST' });
      showToast('Attack Planning has been cleared successfully.', 'success');
      closeClearModal();
      await loadPlan(state.currentBuildingId);
      renderPreview();
      await loadAllPlayers();
      if (state.isModalOpen) closePlayerModal();
    } catch (err) {
      el.clearError.textContent = err.message || 'Failed to clear attack planning.';
      el.clearError.style.display = 'block';
      showToast(err.message, 'error');
    } finally {
      state.isClearing = false;
      el.clearLoading.style.display = 'none';
      el.clearDeleteBtn.disabled = false;
    }
  });

  // Init
  loadBuildings();
})();