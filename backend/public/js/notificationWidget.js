/**
 * notificationWidget.js
 * Widget flottant de notifications pour l'espace de gestion.
 * Chargé en <script type="module"> depuis gestion.html.
 */

// ─── Catégories — icônes et couleurs ─────────────────────────────────────────

const CATEGORY_CONFIG = {
  prestations:    { icon: 'bi-scissors',          color: 'var(--theme-accent)' },
  formations:     { icon: 'bi-mortarboard',       color: 'var(--theme-accent-strong)' },
  ventes:         { icon: 'bi-cash-stack',        color: '#22c55e' },
  système:        { icon: 'bi-gear',              color: 'var(--color-text-muted, #6b7280)' },
  remboursements: { icon: 'bi-arrow-return-left', color: '#f97316' },
  clients:        { icon: 'bi-people',            color: '#3b82f6' }
};

function getCategoryConfig(category) {
  return CATEGORY_CONFIG[category] || CATEGORY_CONFIG['système'];
}

// ─── Format de date relative ──────────────────────────────────────────────────

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'À l\'instant';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH} heure${diffH > 1 ? 's' : ''}`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `Il y a ${diffD} jour${diffD > 1 ? 's' : ''}`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── État global ──────────────────────────────────────────────────────────────

let state = {
  notifications: [],
  unreadCount: 0,
  previousUnreadCount: 0,
  pollingInterval: null,
  config: null,
  isOpen: false,
  bannerTimeout: null
};

// ─── Éléments DOM ─────────────────────────────────────────────────────────────

let btn, badge, banner, bannerText, overlay, modal, modalList;

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init() {
  // Charger la config
  try {
    const res = await fetch('/api/gestion/notifications/config', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      state.config = data.config || { widgetPosition: 'bottom-right', pollingIntervalSeconds: 30 };
    }
  } catch {
    state.config = { widgetPosition: 'bottom-right', pollingIntervalSeconds: 30 };
  }

  buildDOM();
  attachEvents();

  // Poll immédiat puis à intervalles
  await pollNotifications();
  const intervalMs = (state.config?.pollingIntervalSeconds || 30) * 1000;
  state.pollingInterval = setInterval(pollNotifications, intervalMs);
}

// ─── Construction du DOM ──────────────────────────────────────────────────────

function buildDOM() {
  const position = state.config?.widgetPosition || 'bottom-right';

  // Bouton flottant
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ntf-widget-btn ntf-widget-btn--${position}`;
  btn.id = 'ntf-widget-btn';
  btn.setAttribute('aria-label', 'Notifications');
  btn.innerHTML = `<i class="bi bi-bell-fill"></i>`;

  badge = document.createElement('span');
  badge.className = 'ntf-badge';
  badge.id = 'ntf-badge';
  badge.hidden = true;
  badge.textContent = '0';
  btn.appendChild(badge);

  // Bannière
  banner = document.createElement('div');
  banner.className = `ntf-banner ntf-banner--${position}`;
  banner.id = 'ntf-banner';
  banner.hidden = true;
  bannerText = document.createElement('span');
  bannerText.id = 'ntf-banner-text';
  banner.innerHTML = `<i class="bi bi-bell"></i>`;
  banner.appendChild(bannerText);

  // Overlay
  overlay = document.createElement('div');
  overlay.className = 'ntf-overlay';
  overlay.id = 'ntf-overlay';

  // Modal
  modal = document.createElement('div');
  modal.className = 'ntf-modal';
  modal.id = 'ntf-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Notifications');
  modal.innerHTML = `
    <div class="ntf-modal__header">
      <p class="ntf-modal__title">Notifications</p>
      <div class="ntf-modal__actions">
        <button type="button" class="ntf-modal__read-all-btn" id="ntf-read-all-btn">
          Tout marquer lu
        </button>
        <button type="button" class="ntf-modal__close-btn" id="ntf-close-btn" aria-label="Fermer">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
    <div class="ntf-modal__list" id="ntf-modal-list"></div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(banner);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  modalList = document.getElementById('ntf-modal-list');
}

// ─── Événements ───────────────────────────────────────────────────────────────

function attachEvents() {
  btn.addEventListener('click', toggleModal);
  overlay.addEventListener('click', closeModal);
  modal.querySelector('#ntf-close-btn').addEventListener('click', closeModal);
  modal.querySelector('#ntf-read-all-btn').addEventListener('click', handleReadAll);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollNotifications() {
  try {
    const res = await fetch('/api/gestion/notifications?limit=50', {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = await res.json();

    const newUnread = data.unreadCount || 0;

    if (newUnread > state.previousUnreadCount && state.previousUnreadCount >= 0) {
      const diff = newUnread - state.previousUnreadCount;
      showBanner(diff);
    }

    state.previousUnreadCount = newUnread;
    state.unreadCount = newUnread;
    state.notifications = data.notifications || [];

    updateBadge(newUnread);

    if (state.isOpen) {
      renderList();
    }
  } catch {
    // silencieux
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(count) {
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// ─── Bannière ─────────────────────────────────────────────────────────────────

function showBanner(newCount) {
  if (state.bannerTimeout) {
    clearTimeout(state.bannerTimeout);
    state.bannerTimeout = null;
  }

  bannerText.textContent =
    newCount === 1
      ? 'Vous avez 1 nouvelle notification'
      : `Vous avez ${newCount} nouvelles notifications`;

  banner.hidden = false;
  banner.classList.remove('ntf-banner--hiding');
  banner.classList.add('ntf-banner--visible');

  state.bannerTimeout = setTimeout(() => {
    banner.classList.remove('ntf-banner--visible');
    banner.classList.add('ntf-banner--hiding');
    const onEnd = () => {
      banner.hidden = true;
      banner.classList.remove('ntf-banner--hiding');
      banner.removeEventListener('animationend', onEnd);
    };
    banner.addEventListener('animationend', onEnd);
    state.bannerTimeout = null;
  }, 3000);
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function toggleModal() {
  if (state.isOpen) {
    closeModal();
  } else {
    openModal();
  }
}

function openModal() {
  state.isOpen = true;
  renderList();
  modal.classList.add('ntf-modal--open');
  overlay.classList.add('ntf-overlay--visible');
  btn.setAttribute('aria-expanded', 'true');
}

function closeModal() {
  state.isOpen = false;
  modal.classList.remove('ntf-modal--open');
  overlay.classList.remove('ntf-overlay--visible');
  btn.setAttribute('aria-expanded', 'false');
}

// ─── Rendu liste ──────────────────────────────────────────────────────────────

function renderList() {
  if (!state.notifications.length) {
    modalList.innerHTML = `
      <div class="ntf-modal__empty">
        <i class="bi bi-bell-slash"></i>
        <span>Aucune notification</span>
      </div>
    `;
    return;
  }

  modalList.innerHTML = state.notifications.map(n => renderItem(n)).join('');

  // Attacher les listeners sur chaque item
  modalList.querySelectorAll('.ntf-item').forEach(el => {
    el.addEventListener('click', async () => {
      const notifId = el.dataset.notifId;
      if (!notifId) return;

      await markRead(notifId);
      const notif = state.notifications.find(n => n.notificationId === notifId);
      if (notif && !notif.isRead) {
        notif.isRead = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
        state.previousUnreadCount = state.unreadCount;
        updateBadge(state.unreadCount);
        renderList();
      }
    });
  });
}

function renderItem(n) {
  const cat = getCategoryConfig(n.category);
  const iconBg = `color-mix(in oklab, ${cat.color} 12%, transparent 88%)`;
  const unreadClass = n.isRead ? '' : ' ntf-item--unread';

  return `
    <div
      class="ntf-item${unreadClass}"
      data-notif-id="${escHtml(n.notificationId)}"
      role="button"
      tabindex="0"
    >
      <div class="ntf-item__icon" style="background:${iconBg}; color:${cat.color}">
        <i class="bi ${escHtml(cat.icon)}"></i>
      </div>
      <div class="ntf-item__body">
        <div class="ntf-item__top">
          <span class="ntf-item__title">${escHtml(n.title)}</span>
          ${!n.isRead ? '<span class="ntf-item__unread-dot"></span>' : ''}
        </div>
        <div class="ntf-item__message">${escHtml(n.message)}</div>
        <div class="ntf-item__time">${formatRelativeTime(n.createdAt)}</div>
      </div>
    </div>
  `;
}

// ─── Actions API ──────────────────────────────────────────────────────────────

async function markRead(notificationId) {
  try {
    await fetch(`/api/gestion/notifications/${notificationId}/read`, {
      method: 'PATCH',
      credentials: 'include'
    });
  } catch {
    // silencieux
  }
}

async function handleReadAll() {
  try {
    await fetch('/api/gestion/notifications/read-all', {
      method: 'PATCH',
      credentials: 'include'
    });
    state.notifications.forEach(n => { n.isRead = true; });
    state.unreadCount = 0;
    state.previousUnreadCount = 0;
    updateBadge(0);
    renderList();
  } catch {
    // silencieux
  }
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

// Attendre que le DOM soit prêt et que l'utilisateur soit connecté
// (le widget n'a de sens que sur gestion.html qui charge ce fichier en module)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
