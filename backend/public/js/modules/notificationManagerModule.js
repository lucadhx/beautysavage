/**
 * notificationManagerModule.js
 * Module de gestion des notifications — 4 onglets :
 *   Notifications | Événements | Catégories | Paramètres
 */

const API_ROOT = '/api/gestion/notifications';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'À l\'instant';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function showFeedback(el, msg, type = 'info') {
  if (!el) return;
  el.textContent = msg;
  el.setAttribute('data-status', type);
  el.hidden = false;
}

function clearFeedback(el) {
  if (!el) return;
  el.textContent = '';
  el.removeAttribute('data-status');
  el.hidden = true;
}

function setSaving(btn, saving) {
  if (!btn) return;
  btn.disabled = saving;
  if (saving) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="nmm-spinner"></span> Enregistrement…`;
  } else if (btn.dataset.originalHtml) {
    btn.innerHTML = btn.dataset.originalHtml;
  }
}

// ─── Bootstrap Icons list ─────────────────────────────────────────────────────

const BOOTSTRAP_ICONS = [
  'bi-alarm','bi-archive','bi-arrow-clockwise','bi-arrow-down','bi-arrow-left',
  'bi-arrow-return-left','bi-arrow-right','bi-arrow-up','bi-at','bi-award',
  'bi-bag','bi-bag-check','bi-bag-heart','bi-bag-plus','bi-bar-chart',
  'bi-bar-chart-line','bi-bell','bi-bell-fill','bi-bell-slash','bi-bicycle',
  'bi-bookmark','bi-bookmark-fill','bi-bookmark-star','bi-box','bi-box-seam',
  'bi-briefcase','bi-briefcase-fill','bi-brush','bi-building','bi-calendar',
  'bi-calendar-check','bi-calendar-date','bi-calendar-event','bi-calendar-heart','bi-camera',
  'bi-camera-fill','bi-card-checklist','bi-cart','bi-cart-check','bi-cart-plus',
  'bi-cash','bi-cash-coin','bi-cash-stack','bi-chat','bi-chat-dots',
  'bi-chat-left','bi-check','bi-check-all','bi-check-circle','bi-check-circle-fill',
  'bi-check-lg','bi-check2','bi-check2-all','bi-check2-circle','bi-chevron-down',
  'bi-chevron-right','bi-chevron-up','bi-clipboard','bi-clipboard-check','bi-clock',
  'bi-clock-history','bi-cloud','bi-cloud-arrow-up','bi-cloud-check','bi-code',
  'bi-code-slash','bi-coin','bi-collection','bi-columns','bi-compass',
  'bi-cpu','bi-credit-card','bi-credit-card-fill','bi-crop','bi-cursor',
  'bi-dash','bi-dash-circle','bi-dash-lg','bi-database','bi-database-check',
  'bi-diagram-3','bi-display','bi-door-open','bi-download','bi-droplet',
  'bi-emoji-smile','bi-envelope','bi-envelope-fill','bi-envelope-open','bi-exclamation',
  'bi-exclamation-circle','bi-exclamation-diamond','bi-exclamation-triangle','bi-eye','bi-eye-slash',
  'bi-file','bi-file-check','bi-file-earmark','bi-file-pdf','bi-file-text',
  'bi-filter','bi-flag','bi-flag-fill','bi-flower1','bi-folder',
  'bi-folder-check','bi-folder-plus','bi-gem','bi-gear','bi-gear-fill',
  'bi-gift','bi-git','bi-globe','bi-globe2','bi-graph-up',
  'bi-graph-up-arrow','bi-grid','bi-hand-thumbs-up','bi-hash','bi-heart',
  'bi-heart-fill','bi-house','bi-house-fill','bi-image','bi-inbox',
  'bi-info','bi-info-circle','bi-info-circle-fill','bi-journal','bi-journal-check',
  'bi-key','bi-laptop','bi-layers','bi-layout-text-sidebar','bi-lightbulb',
  'bi-lightning','bi-lightning-charge','bi-lightning-fill','bi-link','bi-link-45deg',
  'bi-list','bi-list-check','bi-list-ul','bi-lock','bi-lock-fill',
  'bi-magic','bi-map','bi-map-fill','bi-megaphone','bi-megaphone-fill',
  'bi-moon','bi-mortarboard','bi-mortarboard-fill','bi-music-note','bi-music-note-beamed',
  'bi-palette','bi-patch-check','bi-patch-check-fill','bi-pause','bi-pencil',
  'bi-pencil-fill','bi-percent','bi-people','bi-people-fill','bi-person',
  'bi-person-badge','bi-person-check','bi-person-fill','bi-person-gear','bi-person-heart',
  'bi-person-plus','bi-phone','bi-phone-fill','bi-pin','bi-pin-fill',
  'bi-play','bi-play-fill','bi-plus','bi-plus-circle','bi-plus-lg',
  'bi-printer','bi-puzzle','bi-question','bi-question-circle','bi-receipt',
  'bi-receipt-cutoff','bi-recycle','bi-repeat','bi-reply','bi-robot',
  'bi-rocket','bi-rocket-takeoff','bi-scissors','bi-search','bi-send',
  'bi-send-fill','bi-share','bi-shield','bi-shield-check','bi-shield-fill',
  'bi-shop','bi-shop-window','bi-sliders','bi-smartphone','bi-sort-down',
  'bi-sort-up','bi-star','bi-star-fill','bi-stars','bi-stopwatch',
  'bi-sun','bi-tag','bi-tag-fill','bi-tags','bi-tags-fill',
  'bi-telephone','bi-telephone-fill','bi-thermometer','bi-ticket','bi-ticket-fill',
  'bi-toggles','bi-tools','bi-trash','bi-trash-fill','bi-trophy',
  'bi-trophy-fill','bi-truck','bi-truck-flatbed','bi-upc-scan','bi-upload',
  'bi-vector-pen','bi-wallet','bi-wallet-fill','bi-wallet2','bi-watch',
  'bi-wrench','bi-x','bi-x-circle','bi-x-circle-fill','bi-x-lg',
  'bi-zoom-in','bi-zoom-out'
];

// ─── Custom select ─────────────────────────────────────────────────────────────

// One-time document listener to close open dropdowns on outside click
let _selectDocListenerAdded = false;
function ensureSelectDocListener() {
  if (_selectDocListenerAdded) return;
  _selectDocListenerAdded = true;
  document.addEventListener('click', () => {
    document.querySelectorAll('.nmm-select__dropdown:not([hidden])').forEach(d => { d.hidden = true; });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nmm-select__dropdown:not([hidden])').forEach(d => { d.hidden = true; });
    }
  });
}

/**
 * options: [{ value, label, icon?, color? }]
 */
function buildCustomSelect({ id, options, value, disabled = false, placeholder = '' }) {
  const selected = options.find(o => o.value === value) || (placeholder ? null : options[0]);
  const displayLabel = selected ? selected.label : placeholder;
  const displayIcon  = selected?.icon || '';
  const displayColor = selected?.color || 'currentColor';

  return `
    <div class="nmm-select${disabled ? ' nmm-select--disabled' : ''}"
         data-nmm-select="${escHtml(id)}"
         data-value="${escHtml(selected?.value ?? '')}">
      <div class="nmm-select__trigger" tabindex="${disabled ? '-1' : '0'}" role="button" aria-haspopup="listbox">
        <span class="nmm-select__icon-wrap">${displayIcon ? `<i class="bi ${escHtml(displayIcon)}" style="color:${escHtml(displayColor)}"></i>` : ''}</span>
        <span class="nmm-select__value">${escHtml(displayLabel)}</span>
        <i class="bi bi-chevron-down nmm-select__arrow"></i>
      </div>
      <div class="nmm-select__dropdown" hidden role="listbox">
        ${options.map(opt => `
          <div class="nmm-select__option${opt.value === (selected?.value ?? '') ? ' is-selected' : ''}"
               data-value="${escHtml(opt.value)}" role="option">
            ${opt.icon ? `<i class="bi ${escHtml(opt.icon)}" style="color:${escHtml(opt.color || 'currentColor')}"></i>` : ''}
            <span>${escHtml(opt.label)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function attachCustomSelects(root) {
  root.querySelectorAll('[data-nmm-select]:not([data-select-attached])').forEach(select => {
    select.dataset.selectAttached = '1';
    const trigger  = select.querySelector('.nmm-select__trigger');
    const dropdown = select.querySelector('.nmm-select__dropdown');
    if (!trigger || !dropdown || select.classList.contains('nmm-select--disabled')) return;

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      // Close all others
      document.querySelectorAll('.nmm-select__dropdown:not([hidden])').forEach(d => {
        if (d !== dropdown) d.hidden = true;
      });
      dropdown.hidden = isOpen;
    });

    trigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    });

    dropdown.addEventListener('click', e => {
      e.stopPropagation();
      const opt = e.target.closest('.nmm-select__option');
      if (!opt) return;
      const value = opt.dataset.value;

      dropdown.querySelectorAll('.nmm-select__option').forEach(o => {
        o.classList.toggle('is-selected', o.dataset.value === value);
      });

      const optIcon  = opt.querySelector('i');
      const optLabel = opt.querySelector('span');
      const iconWrap = trigger.querySelector('.nmm-select__icon-wrap');
      const valueSpan = trigger.querySelector('.nmm-select__value');
      if (iconWrap) iconWrap.innerHTML = optIcon ? optIcon.outerHTML : '';
      if (valueSpan && optLabel) valueSpan.textContent = optLabel.textContent;

      select.dataset.value = value;
      select.dispatchEvent(new CustomEvent('nmm-change', { detail: { value }, bubbles: true }));
      dropdown.hidden = true;
    });
  });
}

// ─── Category helpers ─────────────────────────────────────────────────────────

function getCategoryById(id) {
  return (state.config?.categories || []).find(c => c.id === id) || null;
}

function getCategorySelectOptions(includeEmpty = false) {
  const cats = state.config?.categories || [];
  const opts = cats.map(c => ({ value: c.id, label: c.label, icon: c.icon, color: c.color }));
  if (includeEmpty) opts.unshift({ value: '', label: '— Sans catégorie —' });
  return opts;
}

function getFilterCategoryOptions() {
  return [
    { value: '', label: 'Toutes les catégories' },
    ...getCategorySelectOptions()
  ];
}

// ─── État global ──────────────────────────────────────────────────────────────

let state = {
  activeTab: 'notifications',
  notifications: [],
  unreadCount: 0,
  config: null,
  filterCategory: '',
  filterRead: 'all',
  lastFocusedField: null
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderModule(container) {
  ensureSelectDocListener();
  container.innerHTML = `<div class="nmm-shell">${renderShell()}</div>`;
  attachTabSwitcher(container);
  await loadConfig();
  await renderActiveTab(container);
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

function renderShell() {
  return `
    <div class="nmm-header">
      <h2 class="nmm-title"><i class="bi bi-bell-fill"></i> Notifications</h2>
    </div>
    <div class="nmm-tabs" data-nmm-tabs>
      <button class="nmm-tab nmm-tab--active" data-tab="notifications" type="button">
        <i class="bi bi-bell"></i> Notifications
      </button>
      <button class="nmm-tab" data-tab="events" type="button">
        <i class="bi bi-lightning-charge"></i> Événements
      </button>
      <button class="nmm-tab" data-tab="categories" type="button">
        <i class="bi bi-tags"></i> Catégories
      </button>
      <button class="nmm-tab" data-tab="settings" type="button">
        <i class="bi bi-sliders"></i> Paramètres
      </button>
    </div>
    <div class="nmm-tab-content" data-nmm-content></div>
  `;
}

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const res = await fetch(`${API_ROOT}/config`, { credentials: 'include' });
    const data = await res.json();
    state.config = data.config || null;
  } catch {
    state.config = null;
  }
}

// ─── Tab switcher ─────────────────────────────────────────────────────────────

function attachTabSwitcher(container) {
  const tabsBar = container.querySelector('[data-nmm-tabs]');
  if (!tabsBar) return;
  tabsBar.addEventListener('click', async e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab === state.activeTab) return;
    state.activeTab = tab;
    tabsBar.querySelectorAll('.nmm-tab').forEach(b => {
      b.classList.toggle('nmm-tab--active', b.dataset.tab === tab);
    });
    const content = container.querySelector('[data-nmm-content]');
    if (content) { content.classList.remove('nmm-tab-content'); void content.offsetWidth; content.classList.add('nmm-tab-content'); }
    await renderActiveTab(container);
  });
}

async function renderActiveTab(container) {
  const content = container.querySelector('[data-nmm-content]');
  if (!content) return;
  if (state.activeTab === 'notifications') await renderNotificationsTab(content);
  else if (state.activeTab === 'events')   await renderEventsTab(content);
  else if (state.activeTab === 'categories') renderCategoriesTab(content);
  else if (state.activeTab === 'settings')  renderSettingsTab(content);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONGLET NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function renderNotificationsTab(container) {
  container.innerHTML = `
    <div class="nmm-notifs">
      <div class="nmm-notifs__toolbar">
        <div class="nmm-notifs__filters">
          ${buildCustomSelect({ id: 'filterCategory', options: getFilterCategoryOptions(), value: state.filterCategory })}
          ${buildCustomSelect({
            id: 'filterRead',
            options: [
              { value: 'all',    label: 'Toutes' },
              { value: 'unread', label: 'Non lues' },
              { value: 'read',   label: 'Lues' }
            ],
            value: state.filterRead
          })}
        </div>
        <button class="nmm-btn-secondary" data-mark-all-read type="button">
          <i class="bi bi-check2-all"></i> Tout marquer lu
        </button>
      </div>
      <div data-notifs-list>${renderSkeletonNotifs()}</div>
    </div>
  `;

  attachCustomSelects(container);
  attachNotifFilters(container);
  await fetchAndRenderNotifs(container);
}

function renderSkeletonNotifs() {
  return `<div class="nmm-skeleton">${'<div class="nmm-skeleton__item"></div>'.repeat(4)}</div>`;
}

function attachNotifFilters(container) {
  container.querySelector('[data-nmm-select="filterCategory"]')?.addEventListener('nmm-change', async e => {
    state.filterCategory = e.detail.value;
    await fetchAndRenderNotifs(container);
  });
  container.querySelector('[data-nmm-select="filterRead"]')?.addEventListener('nmm-change', async e => {
    state.filterRead = e.detail.value;
    await fetchAndRenderNotifs(container);
  });
  container.querySelector('[data-mark-all-read]')?.addEventListener('click', async () => {
    try {
      await fetch(`${API_ROOT}/read-all`, { method: 'PATCH', credentials: 'include' });
      state.notifications.forEach(n => { n.isRead = true; });
      state.unreadCount = 0;
      renderNotifList(container.querySelector('[data-notifs-list]'));
    } catch {}
  });
}

async function fetchAndRenderNotifs(container) {
  const list = container.querySelector('[data-notifs-list]');
  if (!list) return;
  const unreadOnly = state.filterRead === 'unread';
  try {
    const res = await fetch(`${API_ROOT}?limit=100${unreadOnly ? '&unreadOnly=true' : ''}`, {
      credentials: 'include', cache: 'no-store'
    });
    const data = await res.json();
    state.notifications = (data.notifications || []).filter(n => {
      if (state.filterCategory && n.category !== state.filterCategory) return false;
      if (state.filterRead === 'read' && !n.isRead) return false;
      return true;
    });
    state.unreadCount = data.unreadCount || 0;
    renderNotifList(list);
  } catch {
    list.innerHTML = `<p class="nmm-error"><i class="bi bi-exclamation-triangle"></i> Erreur de chargement.</p>`;
  }
}

function renderNotifList(list) {
  if (!list) return;
  if (!state.notifications.length) {
    list.innerHTML = `<div class="nmm-empty"><i class="bi bi-bell-slash"></i><span>Aucune notification pour ces filtres</span></div>`;
    return;
  }
  list.innerHTML = state.notifications.map(n => {
    const cat = getCategoryById(n.category);
    const iconName = cat?.icon || 'bi-bell';
    const iconColor = cat?.color || 'var(--color-muted)';
    const iconBg = `color-mix(in oklab, ${iconColor} 12%, transparent 88%)`;
    const unreadClass = n.isRead ? '' : ' nmm-notif--unread';
    return `
      <div class="nmm-notif${unreadClass}" data-notif-id="${escHtml(n.notificationId)}">
        <div class="nmm-notif__icon" style="background:${iconBg};color:${iconColor}">
          <i class="bi ${escHtml(iconName)}"></i>
        </div>
        <div class="nmm-notif__body">
          <div class="nmm-notif__top">
            <span class="nmm-notif__title">${escHtml(n.title)}</span>
            <span class="nmm-notif__time">${formatRelativeTime(n.createdAt)}</span>
          </div>
          <div class="nmm-notif__msg">${escHtml(n.message)}</div>
          <div class="nmm-notif__meta">
            <span class="nmm-badge nmm-badge--cat">${escHtml(cat?.label || n.category || 'Système')}</span>
            ${!n.isRead ? '<span class="nmm-notif__dot" data-dot></span>' : ''}
          </div>
        </div>
        <div class="nmm-notif__actions">
          ${!n.isRead ? `<button class="nmm-notif__btn-read" data-action="read" title="Marquer comme lu" type="button"><i class="bi bi-check2"></i></button>` : ''}
          <button class="nmm-notif__btn-delete" data-action="delete" title="Supprimer" type="button"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.nmm-notif').forEach(el => {
    const notifId = el.dataset.notifId;
    el.querySelector('[data-action="read"]')?.addEventListener('click', async e => {
      e.stopPropagation();
      const dot = el.querySelector('[data-dot]');
      if (dot) dot.classList.add('nmm-notif__dot--reading');
      await fetch(`${API_ROOT}/${notifId}/read`, { method: 'PATCH', credentials: 'include' });
      const notif = state.notifications.find(n => n.notificationId === notifId);
      if (notif) { notif.isRead = true; state.unreadCount = Math.max(0, state.unreadCount - 1); }
      setTimeout(() => renderNotifList(list), 300);
    });
    el.querySelector('[data-action="delete"]')?.addEventListener('click', async e => {
      e.stopPropagation();
      el.style.transition = 'opacity 200ms ease, transform 200ms ease';
      el.style.opacity = '0'; el.style.transform = 'translateX(12px)';
      await fetch(`${API_ROOT}/${notifId}`, { method: 'DELETE', credentials: 'include' });
      state.notifications = state.notifications.filter(n => n.notificationId !== notifId);
      setTimeout(() => renderNotifList(list), 200);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONGLET ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

async function renderEventsTab(container) {
  if (!state.config?.events?.length) {
    container.innerHTML = `<div class="nmm-empty"><i class="bi bi-exclamation-circle"></i><span>Aucune configuration. Relancez le serveur.</span></div>`;
    return;
  }
  container.innerHTML = `
    <div class="nmm-events">
      ${state.config.events.map((ev, idx) => renderEventCard(ev, idx)).join('')}
    </div>
  `;
  attachCustomSelects(container);
  attachEventCardListeners(container);
}

function renderEventCard(ev, idx) {
  const inactiveClass = ev.isActive ? '' : ' nmm-event-card--inactive';
  const disabled = ev.isActive ? false : true;

  const catOptions = getCategorySelectOptions(true);
  const targetOptions = [
    { value: 'all',            label: 'Tous',                  icon: 'bi-people' },
    { value: 'role',           label: 'Par rôle',              icon: 'bi-person-gear' },
    { value: 'user_concerned', label: 'Praticienne concernée', icon: 'bi-person-heart' }
  ];
  const roleOptions = [
    { value: 'admin', label: 'Admin',        icon: 'bi-person-gear' },
    { value: 'dev',   label: 'Développeur',  icon: 'bi-code-slash' }
  ];
  const varChips = (ev.availableVariables || [])
    .filter(v => !['userId', 'link', 'linkLabel'].includes(v))
    .map(v => `<button class="nmm-var-chip" data-var="${escHtml(v)}" type="button">{{${escHtml(v)}}}</button>`)
    .join('');

  const showRoleSelect = ev.targetType === 'role';

  return `
    <div class="nmm-event-card${inactiveClass}" data-event-idx="${idx}" data-event-type="${escHtml(ev.eventType)}">
      <div class="nmm-event-card__header">
        <label class="nmm-toggle" title="${ev.isActive ? 'Désactiver' : 'Activer'}">
          <input class="nmm-toggle__input" type="checkbox" data-field="isActive" ${ev.isActive ? 'checked' : ''}>
          <span class="nmm-toggle__track"><span class="nmm-toggle__thumb"></span></span>
        </label>
        <span class="nmm-event-card__label">${escHtml(ev.label)}</span>
        <span class="nmm-badge nmm-badge--event-type">${escHtml(ev.eventType)}</span>
      </div>

      <div class="nmm-event-card__fields">
        <div class="nmm-field-row">
          <label class="nmm-label">Catégorie</label>
          ${buildCustomSelect({ id: 'category', options: catOptions, value: ev.category || '', disabled })}
        </div>
        <div class="nmm-field-row">
          <label class="nmm-label">Destinataire</label>
          ${buildCustomSelect({ id: 'targetType', options: targetOptions, value: ev.targetType, disabled })}
        </div>
        <div class="nmm-field-row nmm-role-field${showRoleSelect ? '' : ' nmm-role-field--hidden'}" data-role-field>
          <label class="nmm-label">Rôle</label>
          ${buildCustomSelect({ id: 'targetRole', options: roleOptions, value: ev.targetRole || 'admin', disabled })}
        </div>
        <div class="nmm-field-row nmm-field-row--full">
          <label class="nmm-label">Titre</label>
          <input class="nmm-input" type="text" data-field="titleTemplate"
            value="${escHtml(ev.titleTemplate)}"
            placeholder="ex : Nouvelle réservation — {{serviceName}}"
            ${disabled ? 'disabled' : ''}>
        </div>
        <div class="nmm-field-row nmm-field-row--full">
          <label class="nmm-label">Corps du message</label>
          <textarea class="nmm-textarea" data-field="messageTemplate" rows="2"
            ${disabled ? 'disabled' : ''}>${escHtml(ev.messageTemplate)}</textarea>
        </div>
        ${varChips ? `
        <div class="nmm-field-row nmm-field-row--full">
          <label class="nmm-label">Variables <span style="font-weight:400;text-transform:none;letter-spacing:0">(cliquer pour insérer)</span></label>
          <div class="nmm-vars">${varChips}</div>
        </div>` : ''}
      </div>

      <div class="nmm-event-card__footer">
        <span class="nmm-feedback" data-event-feedback hidden></span>
        <button class="nmm-btn-primary nmm-btn-sm" data-action="save-event" type="button">
          <i class="bi bi-check-lg"></i> Enregistrer
        </button>
      </div>
    </div>
  `;
}

function attachEventCardListeners(container) {
  container.addEventListener('focusin', e => {
    const field = e.target.closest('[data-field="titleTemplate"], [data-field="messageTemplate"]');
    if (field) state.lastFocusedField = field;
  });

  container.querySelectorAll('.nmm-event-card').forEach(card => {
    const idx      = parseInt(card.dataset.eventIdx, 10);
    const feedback = card.querySelector('[data-event-feedback]');
    const saveBtn  = card.querySelector('[data-action="save-event"]');
    const roleField = card.querySelector('[data-role-field]');

    // Toggle isActive
    card.querySelector('[data-field="isActive"]')?.addEventListener('change', e => {
      const isActive = e.currentTarget.checked;
      card.classList.toggle('nmm-event-card--inactive', !isActive);
      card.querySelectorAll('[data-field]:not([data-field="isActive"]), [data-nmm-select]').forEach(f => {
        if (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA') f.disabled = !isActive;
        if (f.dataset.nmmSelect) f.classList.toggle('nmm-select--disabled', !isActive);
      });
    });

    // targetType → show/hide role field
    card.querySelector('[data-nmm-select="targetType"]')?.addEventListener('nmm-change', e => {
      if (!roleField) return;
      const show = e.detail.value === 'role';
      roleField.classList.toggle('nmm-role-field--hidden', !show);
      if (show) roleField.style.animation = 'nmm-slide-up 200ms ease forwards';
    });

    // Var chips
    card.querySelectorAll('.nmm-var-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const varName = chip.dataset.var;
        const target = state.lastFocusedField && card.contains(state.lastFocusedField)
          ? state.lastFocusedField
          : card.querySelector('[data-field="titleTemplate"]');
        if (!target) return;
        const insert = `{{${varName}}}`;
        const start = target.selectionStart ?? target.value.length;
        const end   = target.selectionEnd   ?? target.value.length;
        target.value = target.value.slice(0, start) + insert + target.value.slice(end);
        target.focus();
        target.selectionStart = target.selectionEnd = start + insert.length;
      });
    });

    // Save
    saveBtn?.addEventListener('click', async () => {
      const updatedEvent = {
        ...state.config.events[idx],
        isActive:        card.querySelector('[data-field="isActive"]')?.checked ?? state.config.events[idx].isActive,
        category:        card.querySelector('[data-nmm-select="category"]')?.dataset.value || null,
        targetType:      card.querySelector('[data-nmm-select="targetType"]')?.dataset.value || state.config.events[idx].targetType,
        targetRole:      card.querySelector('[data-nmm-select="targetRole"]')?.dataset.value || null,
        titleTemplate:   card.querySelector('[data-field="titleTemplate"]')?.value?.trim() || '',
        messageTemplate: card.querySelector('[data-field="messageTemplate"]')?.value?.trim() || ''
      };
      const updatedEvents = [...state.config.events];
      updatedEvents[idx] = updatedEvent;

      setSaving(saveBtn, true);
      clearFeedback(feedback);
      try {
        const res = await fetch(`${API_ROOT}/config`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: updatedEvents })
        });
        const data = await res.json();
        setSaving(saveBtn, false);
        if (data.ok) {
          state.config = data.config;
          showFeedback(feedback, '✓ Enregistré', 'success');
          setTimeout(() => clearFeedback(feedback), 2500);
        } else {
          showFeedback(feedback, data.error || 'Erreur', 'error');
        }
      } catch {
        setSaving(saveBtn, false);
        showFeedback(feedback, 'Erreur réseau', 'error');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONGLET CATÉGORIES
// ═══════════════════════════════════════════════════════════════════════════════

function renderCategoriesTab(container) {
  const cats = state.config?.categories || [];
  container.innerHTML = `
    <div class="nmm-categories">
      <div class="nmm-categories__list" data-cat-list>
        ${cats.length
          ? cats.map((cat, idx) => renderCategoryRow(cat, idx)).join('')
          : `<div class="nmm-empty"><i class="bi bi-tags"></i><span>Aucune catégorie. Relancez le serveur.</span></div>`
        }
      </div>
      <button class="nmm-btn-secondary nmm-categories__add" data-action="add-category" type="button">
        <i class="bi bi-plus-lg"></i> Ajouter une catégorie
      </button>
    </div>
  `;
  attachCategoryListeners(container);
}

function renderCategoryRow(cat, idx) {
  return `
    <div class="nmm-cat-row" data-cat-id="${escHtml(cat.id)}">
      <div class="nmm-cat-row__icon" style="background:color-mix(in oklab,${escHtml(cat.color)} 15%,transparent 85%);color:${escHtml(cat.color)}">
        <i class="bi ${escHtml(cat.icon)}"></i>
      </div>
      <span class="nmm-cat-row__label">${escHtml(cat.label)}</span>
      <code class="nmm-cat-row__id">${escHtml(cat.id)}</code>
      <div class="nmm-cat-row__actions">
        <button class="nmm-icon-btn" data-action="edit-category" data-idx="${idx}" title="Modifier" type="button"><i class="bi bi-pencil"></i></button>
        <button class="nmm-icon-btn nmm-icon-btn--danger" data-action="delete-category" data-cat-id="${escHtml(cat.id)}" title="Supprimer" type="button"><i class="bi bi-trash3"></i></button>
      </div>
    </div>
  `;
}

function attachCategoryListeners(container) {
  container.querySelector('[data-action="add-category"]')?.addEventListener('click', () => {
    openCategoryModal({ cat: null, idx: null });
  });
  container.querySelectorAll('[data-action="edit-category"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const cat = state.config.categories[idx];
      openCategoryModal({ cat, idx });
    });
  });
  container.querySelectorAll('[data-action="delete-category"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.catId;
      const cat = state.config.categories.find(c => c.id === catId);
      if (!cat) return;
      const affectedCount = state.config.events.filter(e => e.category === catId).length;
      const msg = affectedCount > 0
        ? `Supprimer "${cat.label}" ? ${affectedCount} événement(s) seront mis à jour.`
        : `Supprimer la catégorie "${cat.label}" ?`;
      if (!window.confirm(msg)) return;

      try {
        const res = await fetch(`${API_ROOT}/config/categories/${encodeURIComponent(catId)}`, {
          method: 'DELETE', credentials: 'include'
        });
        const data = await res.json();
        if (data.ok) {
          state.config = data.config;
          const tabContent = container.closest('[data-nmm-content]');
          if (tabContent) renderCategoriesTab(tabContent);
        } else {
          alert(data.error || 'Erreur');
        }
      } catch { alert('Erreur réseau'); }
    });
  });
}

// ─── Modal catégorie ──────────────────────────────────────────────────────────

function openCategoryModal({ cat, idx }) {
  const isNew = cat === null;
  document.getElementById('nmm-cat-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'nmm-cat-modal';
  modal.className = 'nmm-modal-overlay';
  modal.innerHTML = `
    <div class="nmm-modal" role="dialog" aria-modal="true">
      <div class="nmm-modal__header">
        <h3 class="nmm-modal__title">${isNew ? 'Nouvelle catégorie' : 'Modifier la catégorie'}</h3>
        <button class="nmm-modal__close" data-close type="button"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="nmm-modal__body">

        <div class="nmm-field-row">
          <label class="nmm-label">Nom</label>
          <input class="nmm-input" type="text" data-field="label" value="${escHtml(cat?.label || '')}" placeholder="ex : Prestations" autocomplete="off">
        </div>

        <div class="nmm-field-row">
          <label class="nmm-label">Identifiant</label>
          <input class="nmm-input" type="text" data-field="id" value="${escHtml(cat?.id || '')}"
            placeholder="ex : prestations" autocomplete="off" ${!isNew ? 'readonly' : ''}>
          ${isNew ? '<p class="nmm-hint">Généré automatiquement depuis le nom</p>' : ''}
        </div>

        <div class="nmm-field-row">
          <label class="nmm-label">Icône Bootstrap</label>
          <div class="nmm-icon-picker" data-icon-picker>
            <div class="nmm-icon-picker__search-wrap">
              <i class="bi bi-search"></i>
              <input class="nmm-icon-picker__search" type="text" placeholder="Rechercher…" autocomplete="off">
            </div>
            <div class="nmm-icon-picker__grid" data-icon-grid></div>
            <div class="nmm-icon-picker__selected">
              Sélectionnée :
              <i class="bi ${escHtml(cat?.icon || 'bi-bell')}" data-selected-icon-preview style="font-size:1.1rem"></i>
              <code data-selected-icon-name>${escHtml(cat?.icon || 'bi-bell')}</code>
            </div>
          </div>
          <input type="hidden" data-field="icon" value="${escHtml(cat?.icon || 'bi-bell')}">
        </div>

        <div class="nmm-field-row">
          <label class="nmm-label">Couleur</label>
          <div class="nmm-color-row">
            <input type="color" class="nmm-color-input" data-field="color" value="${escHtml(cat?.color || '#6b7280')}">
            <code class="nmm-color-hex" data-color-hex>${escHtml(cat?.color || '#6b7280')}</code>
          </div>
        </div>

      </div>
      <div class="nmm-modal__footer">
        <span class="nmm-feedback" data-modal-feedback hidden></span>
        <div class="nmm-modal__actions">
          <button class="nmm-btn-secondary" data-close type="button">Annuler</button>
          <button class="nmm-btn-primary" data-action="save-category" type="button">
            <i class="bi bi-check-lg"></i> Enregistrer
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  attachCategoryModalListeners(modal, { isNew, cat, idx });
}

function attachCategoryModalListeners(modal, { isNew, cat, idx }) {
  // Close
  modal.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Auto-generate id from label (new only)
  if (isNew) {
    const labelInput = modal.querySelector('[data-field="label"]');
    const idInput    = modal.querySelector('[data-field="id"]');
    labelInput?.addEventListener('input', () => {
      idInput.value = slugify(labelInput.value);
    });
  }

  // Color hex display
  const colorInput = modal.querySelector('[data-field="color"]');
  const colorHex   = modal.querySelector('[data-color-hex]');
  colorInput?.addEventListener('input', () => { if (colorHex) colorHex.textContent = colorInput.value; });

  // Icon picker
  const iconGrid      = modal.querySelector('[data-icon-grid]');
  const iconSearch    = modal.querySelector('.nmm-icon-picker__search');
  const iconHidden    = modal.querySelector('[data-field="icon"]');
  const iconPreview   = modal.querySelector('[data-selected-icon-preview]');
  const iconName      = modal.querySelector('[data-selected-icon-name]');
  let selectedIcon    = cat?.icon || 'bi-bell';

  function renderIconGrid(filter = '') {
    const filtered = filter
      ? BOOTSTRAP_ICONS.filter(ic => ic.includes(filter.toLowerCase()))
      : BOOTSTRAP_ICONS;
    iconGrid.innerHTML = filtered.map(ic => `
      <button class="nmm-icon-tile${ic === selectedIcon ? ' is-selected' : ''}"
              data-icon="${ic}" type="button" title="${ic}">
        <i class="bi ${ic}"></i>
      </button>
    `).join('');
    iconGrid.querySelectorAll('.nmm-icon-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        selectedIcon = tile.dataset.icon;
        iconGrid.querySelectorAll('.nmm-icon-tile').forEach(t => t.classList.toggle('is-selected', t.dataset.icon === selectedIcon));
        if (iconPreview) { iconPreview.className = `bi ${selectedIcon}`; iconPreview.style.fontSize = '1.1rem'; }
        if (iconName)    iconName.textContent = selectedIcon;
        if (iconHidden)  iconHidden.value = selectedIcon;
      });
    });
  }

  renderIconGrid();
  iconSearch?.addEventListener('input', () => renderIconGrid(iconSearch.value));

  // Save
  const saveBtn  = modal.querySelector('[data-action="save-category"]');
  const feedback = modal.querySelector('[data-modal-feedback]');

  saveBtn?.addEventListener('click', async () => {
    const labelVal = modal.querySelector('[data-field="label"]')?.value?.trim();
    const idVal    = modal.querySelector('[data-field="id"]')?.value?.trim();
    const iconVal  = modal.querySelector('[data-field="icon"]')?.value || 'bi-bell';
    const colorVal = modal.querySelector('[data-field="color"]')?.value || '#6b7280';

    if (!labelVal) return showFeedback(feedback, 'Le nom est requis', 'error');
    if (!idVal)    return showFeedback(feedback, 'L\'identifiant est requis', 'error');

    const cats = [...(state.config?.categories || [])];

    if (isNew) {
      if (cats.some(c => c.id === idVal)) return showFeedback(feedback, 'Cet identifiant existe déjà', 'error');
      cats.push({ id: idVal, label: labelVal, icon: iconVal, color: colorVal });
    } else {
      cats[idx] = { ...cats[idx], label: labelVal, icon: iconVal, color: colorVal };
    }

    setSaving(saveBtn, true);
    clearFeedback(feedback);
    try {
      const res = await fetch(`${API_ROOT}/config`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: cats })
      });
      const data = await res.json();
      setSaving(saveBtn, false);
      if (data.ok) {
        state.config = data.config;
        modal.remove();
        // Refresh categories tab if active
        const tabContent = document.querySelector('[data-nmm-content]');
        if (tabContent && state.activeTab === 'categories') renderCategoriesTab(tabContent);
      } else {
        showFeedback(feedback, data.error || 'Erreur', 'error');
      }
    } catch {
      setSaving(saveBtn, false);
      showFeedback(feedback, 'Erreur réseau', 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONGLET PARAMÈTRES
// ═══════════════════════════════════════════════════════════════════════════════

function renderSettingsTab(container) {
  const cfg      = state.config || {};
  const pos      = cfg.widgetPosition || 'bottom-right';
  const polling  = cfg.pollingIntervalSeconds ?? 30;
  const lifetime = cfg.notificationLifetimeDays ?? 30;

  const positions = [
    { value: 'top-left',     label: 'Haut gauche', dotClass: 'nmm-pos-card__dot--tl' },
    { value: 'top-right',    label: 'Haut droite',  dotClass: 'nmm-pos-card__dot--tr' },
    { value: 'bottom-left',  label: 'Bas gauche',   dotClass: 'nmm-pos-card__dot--bl' },
    { value: 'bottom-right', label: 'Bas droite',   dotClass: 'nmm-pos-card__dot--br' }
  ];

  container.innerHTML = `
    <div class="nmm-settings">
      <div class="nmm-settings__section">
        <div class="nmm-settings__section-header">
          <span class="nmm-settings__section-icon"><i class="bi bi-geo-alt"></i></span>
          <div>
            <p class="nmm-settings__section-title">Position du widget</p>
            <p class="nmm-settings__section-sub">Où apparaît le bouton flottant de notifications</p>
          </div>
        </div>
        <div class="nmm-position-grid">
          ${positions.map(p => `
            <label class="nmm-pos-card${pos === p.value ? ' nmm-pos-card--active' : ''}">
              <input type="radio" name="widgetPosition" value="${p.value}" ${pos === p.value ? 'checked' : ''}>
              <div class="nmm-pos-card__preview"><span class="nmm-pos-card__dot ${escHtml(p.dotClass)}"></span></div>
              <span class="nmm-pos-card__label">${p.label}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="nmm-settings__section">
        <div class="nmm-settings__section-header">
          <span class="nmm-settings__section-icon"><i class="bi bi-clock"></i></span>
          <div>
            <p class="nmm-settings__section-title">Fréquence de mise à jour</p>
            <p class="nmm-settings__section-sub">Intervalle de vérification des nouvelles notifications</p>
          </div>
        </div>
        <div class="nmm-stepper-wrap">
          <div class="nmm-stepper-row">
            <button class="nmm-stepper-btn" data-stepper="polling" data-dir="-10" type="button"><i class="bi bi-dash-lg"></i></button>
            <input class="nmm-stepper-input" type="number" data-stepper-val="polling" min="10" max="300" value="${polling}">
            <button class="nmm-stepper-btn" data-stepper="polling" data-dir="10" type="button"><i class="bi bi-plus-lg"></i></button>
          </div>
          <span class="nmm-stepper-unit">secondes</span>
        </div>
        <p class="nmm-hint">Min : 10 s — Max : 300 s</p>
      </div>

      <div class="nmm-settings__section">
        <div class="nmm-settings__section-header">
          <span class="nmm-settings__section-icon"><i class="bi bi-hourglass-split"></i></span>
          <div>
            <p class="nmm-settings__section-title">Durée de vie des notifications</p>
            <p class="nmm-settings__section-sub">Les notifications plus anciennes sont supprimées automatiquement</p>
          </div>
        </div>
        <div class="nmm-stepper-wrap">
          <div class="nmm-stepper-row">
            <button class="nmm-stepper-btn" data-stepper="lifetime" data-dir="-1" type="button"><i class="bi bi-dash-lg"></i></button>
            <input class="nmm-stepper-input" type="number" data-stepper-val="lifetime" min="0" max="365" value="${lifetime}">
            <button class="nmm-stepper-btn" data-stepper="lifetime" data-dir="1" type="button"><i class="bi bi-plus-lg"></i></button>
          </div>
          <span class="nmm-stepper-unit">jours</span>
        </div>
        <p class="nmm-hint">0 = conservation indéfinie</p>
      </div>

      <div class="nmm-settings__footer">
        <span class="nmm-feedback" data-settings-feedback hidden></span>
        <button class="nmm-btn-primary nmm-btn-primary--full" data-action="save-settings" type="button">
          <i class="bi bi-floppy"></i> Enregistrer les paramètres
        </button>
      </div>
    </div>
  `;
  attachSettingsListeners(container);
}

function attachSettingsListeners(container) {
  container.querySelectorAll('[name="widgetPosition"]').forEach(radio => {
    radio.addEventListener('change', () => {
      container.querySelectorAll('.nmm-pos-card').forEach(card => {
        card.classList.toggle('nmm-pos-card--active', card.querySelector('input')?.checked);
      });
    });
  });

  container.querySelectorAll('[data-stepper]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key   = btn.dataset.stepper;
      const dir   = parseInt(btn.dataset.dir, 10);
      const input = container.querySelector(`[data-stepper-val="${key}"]`);
      if (!input) return;
      const min = parseInt(input.min, 10) || 0;
      const max = parseInt(input.max, 10) || 9999;
      input.value = Math.min(max, Math.max(min, parseInt(input.value, 10) + dir));
    });
  });

  const feedback = container.querySelector('[data-settings-feedback]');
  const saveBtn  = container.querySelector('[data-action="save-settings"]');

  saveBtn?.addEventListener('click', async () => {
    const widgetPosition          = container.querySelector('[name="widgetPosition"]:checked')?.value || 'bottom-right';
    const pollingIntervalSeconds  = Math.max(10, Math.min(300, parseInt(container.querySelector('[data-stepper-val="polling"]')?.value, 10) || 30));
    const notificationLifetimeDays = Math.max(0, Math.min(365, parseInt(container.querySelector('[data-stepper-val="lifetime"]')?.value, 10) || 0));

    setSaving(saveBtn, true);
    clearFeedback(feedback);
    try {
      const res = await fetch(`${API_ROOT}/config`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetPosition, pollingIntervalSeconds, notificationLifetimeDays })
      });
      const data = await res.json();
      setSaving(saveBtn, false);
      if (data.ok) {
        state.config = data.config;
        showFeedback(feedback, '✓ Paramètres enregistrés. Rechargez la page pour repositionner le widget.', 'success');
      } else {
        showFeedback(feedback, data.error || 'Erreur', 'error');
      }
    } catch {
      setSaving(saveBtn, false);
      showFeedback(feedback, 'Erreur réseau', 'error');
    }
  });
}
