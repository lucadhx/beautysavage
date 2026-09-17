import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';

// â”€â”€â”€ API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const API = {
  services: '/api/gestion/services',
  service: id => `/api/gestion/services/${id}`,
  uploadPhoto: id => `/api/gestion/services/${id}/upload-photo`,
  deletePhoto: (id, idx) => `/api/gestion/services/${id}/photos/${idx}`,
  boost: id => `/api/gestion/services/${id}/boost`,
  promotion: id => `/api/gestion/services/${id}/promotion`,
  practitioners: '/api/gestion/practitioners',
  practitionerMe: '/api/gestion/practitioners/me',
  practitionerActivate: '/api/gestion/practitioners/me/activate',
  practitionerDeactivate: '/api/gestion/practitioners/me/deactivate',
  practitionerUpdate: '/api/gestion/practitioners/me',
  serviceSettings: '/api/gestion/service-settings'
};

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const state = {
  container: null,
  activeTab: 'services',
  services: [],
  practitioners: [],
  practitionersSubTab: 'list',
  myAdmin: null,
  myPractitioner: null,
  myPractForm: {
    displayName: '',
    bio: '',
    slotGranularity: 30,
    serviceIds: []
  },
  myPractSaving: false,
  myPractToggling: false,
  loading: false,
  // Modal
  modalOpen: false,
  modalMode: 'create', // 'create' | 'edit'
  modalTab: 'general',
  editingId: null,
  saving: false,
  form: {},
  // Service settings
  serviceSettings: null,
  serviceSettingsSaving: false
};

// â”€â”€â”€ Formatters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
function formatPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? fmt.format(n) : 'â€”';
}
function formatDuration(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return 'â€”';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}min`;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, '0')}`;
}
function escHtml(v = '') {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getDefaultPractitionerForm(profile = null) {
  return {
    displayName: profile?.displayName || '',
    bio: profile?.bio || '',
    slotGranularity: [15, 30, 45, 60].includes(Number(profile?.slotGranularity))
      ? Number(profile.slotGranularity)
      : 30,
    serviceIds: Array.isArray(profile?.serviceIds) ? [...profile.serviceIds] : []
  };
}

function formatPersonName(person = null) {
  const firstName = String(person?.firstName || '').trim();
  const lastName = String(person?.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  const fallback = String(person?.fullName || '').trim();
  if (fallback) return fallback;
  const email = String(person?.email || '').trim();
  if (email) return email.split('@')[0];
  return 'Admin';
}

function mapServiceNames(serviceIds = []) {
  return serviceIds
    .map(id => state.services.find(service => service.id === id)?.name)
    .filter(Boolean);
}

// â”€â”€â”€ CSS injection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function injectCss() {
  if (document.getElementById('svm-styles')) return;
  const link = document.createElement('link');
  link.id = 'svm-styles';
  link.rel = 'stylesheet';
  link.href = '/css/serviceModule.css';
  document.head.appendChild(link);
}

// â”€â”€â”€ Fetch helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// â”€â”€â”€ Load data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadServices() {
  try {
    const data = await apiFetch(API.services);
    state.services = data.services || [];
  } catch (err) {
    logUiError('serviceModule.loadServices', err);
    showToast({ type: 'error', message: 'Erreur chargement prestations.', durationMs: 1000 });
  }
}

async function loadPractitioners() {
  try {
    const data = await apiFetch(API.practitioners);
    state.practitioners = data.practitioners || [];
  } catch (err) {
    logUiError('serviceModule.loadPractitioners', err);
    showToast({ type: 'error', message: 'Erreur chargement praticiennes.', durationMs: 1000 });
  }
}

async function loadMyPractitionerProfile() {
  try {
    const data = await apiFetch(API.practitionerMe);
    state.myAdmin = data.admin || null;
    state.myPractitioner = data.practitioner || null;
    state.myPractForm = getDefaultPractitionerForm(data.practitioner || null);
  } catch (err) {
    logUiError('serviceModule.loadMyPractitionerProfile', err);
    showToast({ type: 'error', message: 'Erreur chargement de mon profil.', durationMs: 1000 });
  }
}

// â”€â”€â”€ Tab bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderTabs() {
  return `
    <div class="svm-tabs">
      <button class="svm-tab ${state.activeTab === 'services' ? 'svm-tab--active' : ''}"
        data-svm-tab="services">
        <i class="bi bi-scissors"></i> Prestations
      </button>
      <button class="svm-tab ${state.activeTab === 'practitioners' ? 'svm-tab--active' : ''}"
        data-svm-tab="practitioners">
        <i class="bi bi-person-badge"></i> Praticiennes
      </button>
      <button class="svm-tab ${state.activeTab === 'settings' ? 'svm-tab--active' : ''}"
        data-svm-tab="settings">
        <i class="bi bi-sliders"></i> Paramètres
      </button>
    </div>
  `;
}

// â”€â”€â”€ Service list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildPromoLabel(service) {
  if (!service.promotion?.isActive) return '';
  const p = service.promotion;
  const label = p.type === 'percentage' ? `-${p.value}%` : `-${formatPrice(p.value)}`;
  return `<span class="svm-badge svm-badge--promo">${escHtml(label)}</span>`;
}

function buildBoostBadge(service) {
  if (!service.boost?.isActive) return '';
  return `<span class="svm-badge svm-badge--boost"><i class="bi bi-lightning-fill"></i> Boost</span>`;
}

function buildActiveBadge(service) {
  return service.isActive
    ? `<span class="svm-badge svm-badge--active">Actif</span>`
    : `<span class="svm-badge svm-badge--inactive">Inactif</span>`;
}

function renderServiceCard(service) {
  const thumb = service.photos?.[0]
    ? `<img class="svm-card__thumb" src="${escHtml(service.photos[0])}" alt="${escHtml(service.name)}">`
    : `<div class="svm-card__thumb svm-card__thumb--empty"><i class="bi bi-image"></i></div>`;

  return `
    <div class="svm-card" data-svm-service-id="${escHtml(service.id)}">
      ${thumb}
      <div class="svm-card__body">
        <div class="svm-card__title">${escHtml(service.name)}</div>
        <div class="svm-card__meta">
          <i class="bi bi-clock"></i> ${escHtml(formatDuration(service.duration))}
          &nbsp;Â·&nbsp;
          <i class="bi bi-currency-euro"></i> ${escHtml(formatPrice(service.price))}
        </div>
        <div class="svm-card__badges">
          ${buildBoostBadge(service)}
          ${buildPromoLabel(service)}
          ${buildActiveBadge(service)}
        </div>
      </div>
      <div class="svm-card__actions">
        <button class="svm-btn svm-btn--sm svm-btn--outline" data-svm-edit="${escHtml(service.id)}">
          <i class="bi bi-pencil"></i> Ã‰diter
        </button>
        <div class="svm-kebab-wrap">
          <button class="svm-kebab-btn" data-svm-kebab="${escHtml(service.id)}" aria-label="Options">
            <i class="bi bi-three-dots-vertical"></i>
          </button>
          <ul class="svm-kebab-menu" id="kebab-${escHtml(service.id)}">
            <li><button data-svm-toggle-active="${escHtml(service.id)}" data-active="${service.isActive}">
              <i class="bi bi-${service.isActive ? 'eye-slash' : 'eye'}"></i>
              ${service.isActive ? 'DÃ©sactiver' : 'Activer'}
            </button></li>
            <li><button data-svm-toggle-boost="${escHtml(service.id)}" data-boost="${service.boost?.isActive}">
              <i class="bi bi-lightning${service.boost?.isActive ? '-fill' : ''}"></i>
              ${service.boost?.isActive ? 'DÃ©sactiver boost' : 'Activer boost'}
            </button></li>
            <li><button data-svm-promo="${escHtml(service.id)}">
              <i class="bi bi-tag"></i> Configurer promotion
            </button></li>
            <li><button data-svm-duplicate="${escHtml(service.id)}">
              <i class="bi bi-copy"></i> Dupliquer
            </button></li>
            <li class="svm-kebab-menu__danger"><button data-svm-delete="${escHtml(service.id)}">
              <i class="bi bi-trash3"></i> Supprimer
            </button></li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderServicesTab() {
  const cards = state.services.length
    ? state.services.map(renderServiceCard).join('')
    : `<div class="svm-empty"><i class="bi bi-scissors"></i><p>Aucune prestation crÃ©Ã©e.</p></div>`;

  return `
    <div class="svm-toolbar">
      <span class="svm-count">${state.services.length} prestation${state.services.length !== 1 ? 's' : ''}</span>
      <button class="svm-btn svm-btn--primary" id="svm-create-service">
        <i class="bi bi-plus-lg"></i> Nouvelle prestation
      </button>
    </div>
    <div class="svm-cards" id="svm-cards-list">
      ${cards}
    </div>
  `;
}

// â”€â”€â”€ Practitioners tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderPractitionerStatusBadge(isActive) {
  return `<span class="svm-badge ${isActive ? 'svm-badge--active' : 'svm-badge--inactive'}">${isActive ? 'Active' : 'Inactive'}</span>`;
}

function renderPractitionerListCard(adminAccount) {
  const practitioner = adminAccount?.practitioner || null;
  const isActive = Boolean(practitioner?.isActive);
  const serviceNames = mapServiceNames(practitioner?.serviceIds || []);
  const serviceLabel = isActive
    ? serviceNames.join(' · ') || 'Aucune prestation associee'
    : practitioner
      ? 'Profil desactive'
      : 'Pas encore configuree';

  const granularityLabel = isActive
    ? `Granularité : toutes les ${Number(practitioner?.slotGranularity) || 30} min`
    : '';

  const displayName = practitioner?.displayName || formatPersonName(adminAccount);

  return `
    <article class="svm-pract-card">
      <div class="svm-pract-card__name">${escHtml(displayName)}</div>
      <div class="svm-pract-card__email">${escHtml(adminAccount?.email || 'Email indisponible')}</div>
      <div class="svm-pract-card__status-row">
        ${renderPractitionerStatusBadge(isActive)}
        <span class="svm-pract-card__services">${escHtml(serviceLabel)}</span>
      </div>
      ${granularityLabel ? `<div class="svm-pract-card__granularity">${escHtml(granularityLabel)}</div>` : ''}
    </article>
  `;
}

function renderPractitionersListSubTab() {
  if (!state.practitioners.length) {
    return `<div class="svm-empty"><i class="bi bi-person-badge"></i><p>Aucun compte admin trouve.</p></div>`;
  }

  return `
    <div class="svm-pract-list">
      ${state.practitioners.map(renderPractitionerListCard).join('')}
    </div>
  `;
}

function renderMyPractitionerInactivePanel() {
  return `
    <div class="svm-pract-panel svm-pract-panel--inactive">
      <i class="bi bi-person-badge svm-pract-panel__icon" aria-hidden="true"></i>
      <p class="svm-pract-panel__title">Vous n'êtes pas encore praticienne</p>
      <button class="svm-btn svm-btn--primary svm-pract-panel__action"
        id="svm-pract-activate"
        ${state.myPractToggling ? 'disabled' : ''}>
        ${state.myPractToggling
          ? '<i class="bi bi-arrow-repeat svm-spin"></i> Activation...'
          : '<i class="bi bi-toggle-off"></i> Activer mon statut'}
      </button>
    </div>
  `;
}

function renderMyPractitionerActivePanel() {
  const form = state.myPractForm;
  const granularity = Number(form.slotGranularity) || 30;
  const serviceChecks = state.services.map(service => `
    <label class="svm-check-label">
      <input
        type="checkbox"
        class="svm-check"
        data-svm-me-service="${escHtml(service.id)}"
        ${(form.serviceIds || []).includes(service.id) ? 'checked' : ''}>
      <span>${escHtml(service.name)}</span>
    </label>
  `).join('');

  return `
    <div class="svm-pract-panel">
      <div class="svm-pract-status-head">
        <span class="svm-pract-status-head__toggle"><i class="bi bi-toggle-on"></i> Statut praticienne actif</span>
      </div>

      <div class="svm-field">
        <label for="svm-me-display-name">Nom affiché</label>
        <input id="svm-me-display-name" type="text" class="svm-input" data-svm-me-field="displayName" value="${escHtml(form.displayName || '')}">
        <span class="svm-hint">Visible par les clients.</span>
      </div>

      <div class="svm-field">
        <label for="svm-me-bio">Bio</label>
        <textarea id="svm-me-bio" class="svm-textarea" rows="4" data-svm-me-field="bio">${escHtml(form.bio || '')}</textarea>
      </div>

      <div class="svm-field">
        <label>Intervalle entre créneaux</label>
        <span class="svm-hint">Détermine la fréquence des rendez-vous proposés aux clients. Ex : 30 min = créneaux proposés à 9h00, 9h30, 10h00...</span>
        <div class="svm-pract-radios">
          ${[15, 30, 45, 60].map(value => `
            <label class="svm-pract-radio ${granularity === value ? 'svm-pract-radio--active' : ''}">
              <input type="radio" name="svm-pract-granularity" value="${value}" data-svm-me-granularity="${value}" ${granularity === value ? 'checked' : ''}>
              <span>${value} min</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="svm-field">
        <label>Mes prestations</label>
        <div class="svm-service-checks">
          ${serviceChecks || '<p class="svm-muted">Aucune prestation disponible.</p>'}
        </div>
      </div>

      <div class="svm-pract-actions">
        <button class="svm-btn svm-btn--primary"
          id="svm-pract-save"
          ${state.myPractSaving ? 'disabled' : ''}>
          ${state.myPractSaving
            ? '<i class="bi bi-arrow-repeat svm-spin"></i> Enregistrement...'
            : '<i class="bi bi-check-lg"></i> Enregistrer'}
        </button>
      </div>

      <div class="svm-pract-danger">
        <button class="svm-btn svm-btn--outline"
          id="svm-pract-deactivate"
          ${state.myPractToggling ? 'disabled' : ''}>
          ${state.myPractToggling
            ? '<i class="bi bi-arrow-repeat svm-spin"></i> Desactivation...'
            : '<i class="bi bi-toggle-on"></i> Desactiver mon statut'}
        </button>
      </div>
    </div>
  `;
}

function renderMyPractitionerSubTab() {
  if (!state.myPractitioner || !state.myPractitioner.isActive) {
    return renderMyPractitionerInactivePanel();
  }
  return renderMyPractitionerActivePanel();
}

function renderPractitionersTab() {
  const content = state.practitionersSubTab === 'list'
    ? renderPractitionersListSubTab()
    : renderMyPractitionerSubTab();

  return `
    <div class="svm-pract-subtabs">
      <button class="svm-pract-subtab ${state.practitionersSubTab === 'list' ? 'svm-pract-subtab--active' : ''}"
        data-svm-pract-tab="list">
        <i class="bi bi-list-ul"></i> Liste
      </button>
      <button class="svm-pract-subtab ${state.practitionersSubTab === 'me' ? 'svm-pract-subtab--active' : ''}"
        data-svm-pract-tab="me">
        <i class="bi bi-person-circle"></i> Mon profil
      </button>
    </div>
    ${content}
  `;
}

// â”€â”€â”€ Service Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getDefaultForm() {
  return {
    name: '', description: '', shortDescription: '', duration: 60, price: '',
    isActive: true, isBookable: true, paymentType: 'full',
    depositType: 'percentage', depositValue: 0, capacity: 1,
    bufferTime: 0, cancellationDays: 7, bookingLeadDays: 0, options: [],
    photos: [],
    promotion: { isActive: false, type: 'percentage', value: 0, startDate: '', endDate: '' },
    boost: { isActive: false, order: 0 }
  };
}

function renderModalTabBar() {
  const tabs = [
    { id: 'general', label: 'GÃ©nÃ©ral', icon: 'bi-info-circle' },
    { id: 'tarifs', label: 'Tarifs', icon: 'bi-currency-euro' },
    { id: 'options', label: 'Options', icon: 'bi-list-check' },
    { id: 'photos', label: 'Photos', icon: 'bi-images' },
    { id: 'avance', label: 'AvancÃ©', icon: 'bi-sliders' }
  ];
  return `<div class="svm-modal-tabs">${tabs.map(t => `
    <button class="svm-modal-tab ${state.modalTab === t.id ? 'svm-modal-tab--active' : ''}"
      data-svm-modal-tab="${t.id}">
      <i class="bi ${t.icon}"></i> ${t.label}
    </button>`).join('')}</div>`;
}

function renderGeneralTab() {
  const f = state.form;
  return `
    <div class="svm-field">
      <label>Nom <span class="svm-required">*</span></label>
      <input type="text" class="svm-input" data-svm-field="name" value="${escHtml(f.name || '')}" placeholder="Ex: Pose de cils classique">
    </div>
    <div class="svm-field">
      <label>Description courte</label>
      <input type="text" class="svm-input" data-svm-field="shortDescription" value="${escHtml(f.shortDescription || '')}" maxlength="160" placeholder="RÃ©sumÃ© en 1-2 phrases">
    </div>
    <div class="svm-field">
      <label>Description complÃ¨te</label>
      <textarea class="svm-textarea" data-svm-field="description" rows="5" placeholder="Description dÃ©taillÃ©e...">${escHtml(f.description || '')}</textarea>
    </div>
    <div class="svm-row">
      <div class="svm-field">
        <label>DurÃ©e (minutes) <span class="svm-required">*</span></label>
        <div class="svm-duration-wrap">
          <button type="button" class="svm-dur-btn" data-svm-dur="-15"><i class="bi bi-dash"></i></button>
          <input type="number" class="svm-input svm-input--center" data-svm-field="duration" value="${Number(f.duration) || 60}" min="5" step="5">
          <button type="button" class="svm-dur-btn" data-svm-dur="+15"><i class="bi bi-plus"></i></button>
        </div>
        <span class="svm-hint">${escHtml(formatDuration(f.duration))}</span>
      </div>
      <div class="svm-field">
        <label>CapacitÃ© (pers.)</label>
        <div class="svm-duration-wrap">
          <button type="button" class="svm-dur-btn" data-svm-cap="-1"><i class="bi bi-dash"></i></button>
          <input type="number" class="svm-input svm-input--center" data-svm-field="capacity" value="${Number(f.capacity) || 1}" min="1">
          <button type="button" class="svm-dur-btn" data-svm-cap="+1"><i class="bi bi-plus"></i></button>
        </div>
      </div>
    </div>
  `;
}

function renderTarifsTab() {
  const f = state.form;
  const isDeposit = f.paymentType === 'deposit';
  const isFree = f.paymentType === 'free';
  return `
    <div class="svm-field">
      <label>Prix (â‚¬) <span class="svm-required">*</span></label>
      <input type="number" class="svm-input" data-svm-field="price" value="${f.price !== '' && f.price !== undefined ? f.price : ''}" min="0" step="0.01" placeholder="0.00" ${isFree ? 'disabled' : ''}>
    </div>
    <div class="svm-field">
      <label>Type de paiement</label>
      <div class="svm-payment-type-group">
        ${['full', 'deposit', 'free'].map(pt => `
          <button type="button" class="svm-pt-btn ${f.paymentType === pt ? 'svm-pt-btn--active' : ''}" data-svm-pt="${pt}">
            ${pt === 'full' ? '<i class="bi bi-credit-card"></i> Complet' : pt === 'deposit' ? '<i class="bi bi-piggy-bank"></i> Acompte' : '<i class="bi bi-gift"></i> Gratuit'}
          </button>
        `).join('')}
      </div>
    </div>
    ${isDeposit ? `
      <div class="svm-field">
        <label>Type d'acompte</label>
        <div class="svm-payment-type-group">
          <button type="button" class="svm-pt-btn ${f.depositType === 'percentage' ? 'svm-pt-btn--active' : ''}" data-svm-dt="percentage"><i class="bi bi-percent"></i> Pourcentage</button>
          <button type="button" class="svm-pt-btn ${f.depositType === 'fixed' ? 'svm-pt-btn--active' : ''}" data-svm-dt="fixed"><i class="bi bi-currency-euro"></i> Fixe</button>
        </div>
      </div>
      <div class="svm-field">
        <label>Valeur acompte ${f.depositType === 'percentage' ? '(%)' : '(â‚¬)'}</label>
        <input type="number" class="svm-input" data-svm-field="depositValue" value="${f.depositValue || 0}" min="0" step="${f.depositType === 'percentage' ? '1' : '0.01'}">
      </div>
    ` : ''}
    <div class="svm-field">
      <label>Délai annulation (jours)</label>
      <input type="number" class="svm-input" data-svm-field="cancellationDays" value="${f.cancellationDays ?? 7}" min="0">
      <span class="svm-hint">Nombre de jours avant le RDV pour annuler sans frais.</span>
    </div>
    <div class="svm-field">
      <label>Délai minimum de réservation (jours)</label>
      <div class="svm-stepper">
        <button type="button" class="svm-stepper__btn" data-svm-dec="bookingLeadDays"><i class="bi bi-dash"></i></button>
        <input type="number" class="svm-input svm-stepper__input" data-svm-field="bookingLeadDays" value="${f.bookingLeadDays ?? 0}" min="0">
        <button type="button" class="svm-stepper__btn" data-svm-inc="bookingLeadDays"><i class="bi bi-plus"></i></button>
      </div>
      <span class="svm-hint">Le client ne peut pas réserver à moins de X jours de la prestation.</span>
    </div>
  `;
}

function renderOptionsTab() {
  const options = state.form.options || [];
  const rows = options.map((opt, i) => `
    <div class="svm-option-row" data-opt-idx="${i}">
      <input type="text" class="svm-input svm-input--sm" data-opt-name="${i}" value="${escHtml(opt.name || '')}" placeholder="Nom option">
      <input type="number" class="svm-input svm-input--xs" data-opt-price="${i}" value="${opt.price ?? ''}" placeholder="â‚¬" min="0" step="0.01">
      <label class="svm-toggle-label svm-toggle-label--sm">
        <input type="checkbox" class="svm-toggle" data-opt-active="${i}" ${opt.isActive !== false ? 'checked' : ''}>
        <span class="svm-toggle-track"></span>
      </label>
      <button type="button" class="svm-icon-btn svm-icon-btn--danger" data-opt-remove="${i}">
        <i class="bi bi-x"></i>
      </button>
    </div>
  `).join('');

  return `
    <div class="svm-options-list" id="svm-options-list">
      ${rows || '<p class="svm-muted">Aucune option. Ajoutez-en ci-dessous.</p>'}
    </div>
    <button type="button" class="svm-btn svm-btn--outline" id="svm-add-option">
      <i class="bi bi-plus-lg"></i> Ajouter une option
    </button>
  `;
}

function renderPhotosTab() {
  const photos = state.form.photos || [];
  const existing = photos.map((url, i) => `
    <div class="svm-photo-item">
      <img src="${escHtml(url)}" alt="Photo ${i + 1}">
      <button type="button" class="svm-photo-remove" data-photo-idx="${i}" title="Supprimer">
        <i class="bi bi-x-circle-fill"></i>
      </button>
    </div>
  `).join('');

  const uploadDisabled = !state.editingId ? 'disabled' : '';
  return `
    <div class="svm-photos-grid" id="svm-photos-grid">
      ${existing}
      ${!uploadDisabled ? `
        <label class="svm-photo-dropzone" for="svm-photo-input">
          <i class="bi bi-cloud-upload"></i>
          <span>Ajouter une photo</span>
          <input type="file" id="svm-photo-input" accept="image/*" style="display:none">
        </label>
      ` : `<p class="svm-muted">Sauvegardez d'abord la prestation pour ajouter des photos.</p>`}
    </div>
  `;
}

function renderAvanceTab() {
  const f = state.form;
  const promo = f.promotion || {};
  const boost = f.boost || {};
  return `
    <div class="svm-section-title"><i class="bi bi-clock-history"></i> Temps de battement</div>
    <div class="svm-field">
      <label>Battement aprÃ¨s prestation (min)</label>
      <input type="number" class="svm-input" data-svm-field="bufferTime" value="${f.bufferTime || 0}" min="0" step="5">
      <span class="svm-hint">Temps de prÃ©paration/nettoyage entre deux RDV.</span>
    </div>

    <div class="svm-section-title"><i class="bi bi-tag"></i> Promotion</div>
    <div class="svm-field">
      <label class="svm-toggle-label">
        <input type="checkbox" class="svm-toggle" data-svm-field="promotion.isActive" ${promo.isActive ? 'checked' : ''}>
        <span class="svm-toggle-track"></span>
        <span>Promotion active</span>
      </label>
    </div>
    ${promo.isActive ? `
      <div class="svm-row">
        <div class="svm-field">
          <label>Type</label>
          <select class="svm-select" data-svm-field="promotion.type">
            <option value="percentage" ${promo.type === 'percentage' ? 'selected' : ''}>Pourcentage (%)</option>
            <option value="fixed" ${promo.type === 'fixed' ? 'selected' : ''}>Fixe (â‚¬)</option>
          </select>
        </div>
        <div class="svm-field">
          <label>Valeur</label>
          <input type="number" class="svm-input" data-svm-field="promotion.value" value="${promo.value || 0}" min="0" step="${promo.type === 'percentage' ? '1' : '0.01'}">
        </div>
      </div>
      <div class="svm-row">
        <div class="svm-field">
          <label>Date dÃ©but</label>
          <input type="date" class="svm-input" data-svm-field="promotion.startDate" value="${promo.startDate ? promo.startDate.substring(0, 10) : ''}">
        </div>
        <div class="svm-field">
          <label>Date fin</label>
          <input type="date" class="svm-input" data-svm-field="promotion.endDate" value="${promo.endDate ? promo.endDate.substring(0, 10) : ''}">
        </div>
      </div>
    ` : ''}

    <div class="svm-section-title"><i class="bi bi-lightning"></i> Boost vitrine</div>
    <div class="svm-field">
      <label class="svm-toggle-label">
        <input type="checkbox" class="svm-toggle" data-svm-field="boost.isActive" ${boost.isActive ? 'checked' : ''}>
        <span class="svm-toggle-track"></span>
        <span>Mettre en avant sur la vitrine</span>
      </label>
    </div>
    ${boost.isActive ? `
      <div class="svm-field">
        <label>Ordre d'affichage</label>
        <input type="number" class="svm-input" data-svm-field="boost.order" value="${boost.order || 0}" min="0">
      </div>
    ` : ''}

    <div class="svm-section-title"><i class="bi bi-toggle-on"></i> Statut</div>
    <div class="svm-field">
      <label class="svm-toggle-label">
        <input type="checkbox" class="svm-toggle" data-svm-field="isActive" ${f.isActive !== false ? 'checked' : ''}>
        <span class="svm-toggle-track"></span>
        <span>Prestation active (visible en vitrine)</span>
      </label>
    </div>
    <div class="svm-field">
      <label class="svm-toggle-label">
        <input type="checkbox" class="svm-toggle" data-svm-field="isBookable" ${f.isBookable !== false ? 'checked' : ''}>
        <span class="svm-toggle-track"></span>
        <span>RÃ©servation activÃ©e</span>
      </label>
    </div>
  `;
}

function renderModalContent() {
  switch (state.modalTab) {
    case 'general': return renderGeneralTab();
    case 'tarifs': return renderTarifsTab();
    case 'options': return renderOptionsTab();
    case 'photos': return renderPhotosTab();
    case 'avance': return renderAvanceTab();
    default: return '';
  }
}

function renderServiceModal() {
  const title = state.modalMode === 'create' ? 'Nouvelle prestation' : 'Modifier la prestation';
  return `
    <div class="svm-overlay" id="svm-modal-overlay">
      <div class="svm-modal" id="svm-modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <div class="svm-modal__header">
          <span class="svm-modal__title"><i class="bi bi-scissors"></i> ${escHtml(title)}</span>
          <button class="svm-modal__close" id="svm-modal-close" aria-label="Fermer"><i class="bi bi-x-lg"></i></button>
        </div>
        ${renderModalTabBar()}
        <div class="svm-modal__body" id="svm-modal-body">
          ${renderModalContent()}
        </div>
        <div class="svm-modal__footer">
          <button class="svm-btn svm-btn--ghost" id="svm-modal-cancel">Annuler</button>
          <button class="svm-btn svm-btn--primary" id="svm-modal-save" ${state.saving ? 'disabled' : ''}>
            ${state.saving ? '<i class="bi bi-arrow-repeat svm-spin"></i> Enregistrementâ€¦' : '<i class="bi bi-check-lg"></i> Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  `;
}


// â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// ─── Service settings tab ────────────────────────────────────────────────────

async function loadServiceSettings() {
  try {
    const res = await fetch(API.serviceSettings, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) state.serviceSettings = data.settings || {};
  } catch (_) {}
}

function renderSettingsTab() {
  const s = state.serviceSettings || {};
  const reminders = Array.isArray(s.reminders) ? s.reminders : [];
  const noShowEnabled = s.noShowSystemEnabled !== false;
  const threshold = Math.min(10, Math.max(1, Number(s.noShowSuspensionThreshold) || 3));

  const remindersHtml = reminders.length === 0
    ? '<p class="svm-settings-empty">Aucun rappel configuré.</p>'
    : reminders.map((r, i) => {
        const hours = Number(r.hoursBeforeAppointment) || 24;
        return `
          <div class="svm-reminder-row" data-reminder-idx="${i}">
            <span class="svm-reminder-row__label">${hours}h avant</span>
            <label class="svm-toggle-wrap">
              <input type="checkbox" ${r.isActive ? 'checked' : ''} data-reminder-active="${i}">
              <span class="svm-toggle-label">${r.isActive ? 'Actif' : 'Inactif'}</span>
            </label>
            <button type="button" class="svm-btn-icon-sm svm-btn--danger" data-reminder-remove="${i}" title="Supprimer">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        `;
      }).join('');

  return `
    <div class="svm-settings-root">
      <section class="svm-settings-section">
        <h3 class="svm-settings-section__title"><i class="bi bi-person-x"></i> Système No-show</h3>
        <div class="svm-settings-row">
          <span class="svm-settings-label">Activer le système de no-show</span>
          <label class="svm-toggle-wrap">
            <input type="checkbox" id="svm-noshow-enabled" ${noShowEnabled ? 'checked' : ''}>
            <span class="svm-toggle-label">${noShowEnabled ? 'Actif' : 'Inactif'}</span>
          </label>
        </div>
        <div class="svm-settings-row${noShowEnabled ? '' : ' svm-settings-row--disabled'}" id="svm-threshold-row">
          <span class="svm-settings-label">Suspendre après</span>
          <div class="svm-stepper">
            <button type="button" class="svm-stepper__btn" data-svm-stepper="minus" ${threshold <= 1 || !noShowEnabled ? 'disabled' : ''}>
              <i class="bi bi-dash"></i>
            </button>
            <span class="svm-stepper__val" id="svm-threshold-val">${threshold}</span>
            <button type="button" class="svm-stepper__btn" data-svm-stepper="plus" ${threshold >= 10 || !noShowEnabled ? 'disabled' : ''}>
              <i class="bi bi-plus"></i>
            </button>
          </div>
          <span class="svm-settings-sublabel">no-shows consécutifs</span>
        </div>
      </section>
      <section class="svm-settings-section">
        <h3 class="svm-settings-section__title"><i class="bi bi-bell"></i> Rappels automatiques</h3>
        <div id="svm-reminders-list">${remindersHtml}</div>
        <div class="svm-add-reminder-form" id="svm-add-reminder-form" hidden>
          <input type="number" class="svm-input svm-input--xs" id="svm-new-reminder-hours" min="1" max="720" value="24" placeholder="ex: 24">
          <span class="svm-settings-sublabel">h avant</span>
          <button type="button" class="svm-btn-secondary svm-btn--sm" id="svm-add-reminder-confirm">
            <i class="bi bi-check-lg"></i> Valider
          </button>
          <button type="button" class="svm-btn-icon-sm" id="svm-add-reminder-cancel" title="Annuler">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <button type="button" class="svm-btn-secondary svm-btn--add-reminder" id="svm-add-reminder">
          <i class="bi bi-plus"></i> Ajouter un rappel
        </button>
      </section>
      <section class="svm-settings-section">
        <h3 class="svm-settings-section__title"><i class="bi bi-people"></i> Réservations</h3>
        <div class="svm-settings-row">
          <span class="svm-settings-label">Permettre au client de choisir sa praticienne</span>
          <label class="svm-toggle-wrap">
            <input type="checkbox" id="svm-allow-choose-pract" ${s.allowClientChoosePractitioner !== false ? 'checked' : ''}>
            <span class="svm-toggle-label">${s.allowClientChoosePractitioner !== false ? 'Oui' : 'Non'}</span>
          </label>
        </div>
      </section>
      <div class="svm-settings-footer">
        <button type="button" class="svm-btn-primary" id="svm-save-settings" ${state.serviceSettingsSaving ? 'disabled' : ''}>
          ${state.serviceSettingsSaving
            ? '<i class="bi bi-arrow-repeat svm-spin"></i> Enregistrement\u2026'
            : '<i class="bi bi-floppy"></i> Enregistrer les param\u00e8tres'}
        </button>
      </div>
    </div>
  `;
}

function renderAll() {
  if (!state.container) return;
  const content = state.activeTab === 'services'
    ? renderServicesTab()
    : state.activeTab === 'settings'
      ? renderSettingsTab()
      : renderPractitionersTab();

  state.container.innerHTML = `
    <div class="svm-root">
      ${renderTabs()}
      <div class="svm-tab-content" id="svm-tab-content">
        ${content}
      </div>
    </div>
    ${state.modalOpen ? renderServiceModal() : ''}
  `;

  attachEvents();
}

function rerenderModalBody() {
  const body = document.getElementById('svm-modal-body');
  if (body) body.innerHTML = renderModalContent();
  attachModalBodyEvents();
}

// â”€â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function attachEvents() {
  const c = state.container;
  if (!c) return;

  // Tabs
  c.querySelectorAll('[data-svm-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.svmTab;
      renderAll();
    });
  });

  // Create service
  const createBtn = c.querySelector('#svm-create-service');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      state.form = getDefaultForm();
      state.modalMode = 'create';
      state.modalTab = 'general';
      state.editingId = null;
      state.modalOpen = true;
      renderAll();
    });
  }

  // Edit service cards
  c.querySelectorAll('[data-svm-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.svmEdit));
  });

  // Kebab menus
  c.querySelectorAll('[data-svm-kebab]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.svmKebab;
      const menu = document.getElementById(`kebab-${id}`);
      if (menu) {
        const open = menu.classList.contains('svm-kebab-menu--open');
        closeAllKebabs();
        if (!open) menu.classList.add('svm-kebab-menu--open');
      }
    });
  });

  document.addEventListener('click', closeAllKebabs, { once: true });

  c.querySelectorAll('[data-svm-toggle-active]').forEach(btn => {
    btn.addEventListener('click', () => toggleServiceActive(btn.dataset.svmToggleActive, btn.dataset.active === 'true'));
  });

  c.querySelectorAll('[data-svm-toggle-boost]').forEach(btn => {
    btn.addEventListener('click', () => toggleServiceBoost(btn.dataset.svmToggleBoost, btn.dataset.boost === 'true'));
  });

  c.querySelectorAll('[data-svm-promo]').forEach(btn => {
    btn.addEventListener('click', () => openPromoModal(btn.dataset.svmPromo));
  });

  c.querySelectorAll('[data-svm-duplicate]').forEach(btn => {
    btn.addEventListener('click', () => duplicateService(btn.dataset.svmDuplicate));
  });

  c.querySelectorAll('[data-svm-delete]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteService(btn.dataset.svmDelete));
  });

  c.querySelectorAll('[data-svm-pract-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.practitionersSubTab = btn.dataset.svmPractTab === 'me' ? 'me' : 'list';
      renderAll();
    });
  });

  c.querySelector('#svm-pract-activate')?.addEventListener('click', activateMyPractitioner);
  c.querySelector('#svm-pract-save')?.addEventListener('click', saveMyPractitionerProfile);
  c.querySelector('#svm-pract-deactivate')?.addEventListener('click', deactivateMyPractitioner);

  c.querySelectorAll('[data-svm-me-field]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.dataset.svmMeField;
      if (!key) return;
      state.myPractForm[key] = el.value;
    });
  });

  c.querySelectorAll('[data-svm-me-granularity]').forEach(el => {
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.myPractForm.slotGranularity = Number(el.value) || 30;
      renderAll();
    });
  });

  c.querySelectorAll('[data-svm-me-service]').forEach(el => {
    el.addEventListener('change', () => {
      const serviceId = String(el.dataset.svmMeService || '').trim();
      if (!serviceId) return;
      const selected = new Set(state.myPractForm.serviceIds || []);
      if (el.checked) selected.add(serviceId);
      else selected.delete(serviceId);
      state.myPractForm.serviceIds = [...selected];
    });
  });

  // Settings tab
  c.querySelector('#svm-save-settings')?.addEventListener('click', saveServiceSettings);

  // No-show toggle → enable/disable threshold row
  const noshowEnabledCb = c.querySelector('#svm-noshow-enabled');
  if (noshowEnabledCb) {
    noshowEnabledCb.addEventListener('change', () => {
      if (!state.serviceSettings) state.serviceSettings = {};
      const enabled = noshowEnabledCb.checked;
      state.serviceSettings.noShowSystemEnabled = enabled;
      const label = noshowEnabledCb.closest('.svm-toggle-wrap')?.querySelector('.svm-toggle-label');
      if (label) label.textContent = enabled ? 'Actif' : 'Inactif';
      const thresholdRow = c.querySelector('#svm-threshold-row');
      if (thresholdRow) thresholdRow.classList.toggle('svm-settings-row--disabled', !enabled);
      c.querySelectorAll('[data-svm-stepper]').forEach(btn => { btn.disabled = !enabled; });
    });
  }

  // Stepper for threshold
  c.querySelectorAll('[data-svm-stepper]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.serviceSettings) state.serviceSettings = {};
      let val = Math.min(10, Math.max(1, Number(state.serviceSettings.noShowSuspensionThreshold) || 3));
      if (btn.dataset.svmStepper === 'plus') val = Math.min(10, val + 1);
      else val = Math.max(1, val - 1);
      state.serviceSettings.noShowSuspensionThreshold = val;
      const display = c.querySelector('#svm-threshold-val');
      if (display) display.textContent = val;
      c.querySelector('[data-svm-stepper="minus"]').disabled = val <= 1;
      c.querySelector('[data-svm-stepper="plus"]').disabled = val >= 10;
    });
  });

  // Add reminder — show inline form
  const addReminderBtn = c.querySelector('#svm-add-reminder');
  const addReminderForm = c.querySelector('#svm-add-reminder-form');
  if (addReminderBtn && addReminderForm) {
    addReminderBtn.addEventListener('click', () => {
      addReminderForm.hidden = false;
      addReminderBtn.hidden = true;
      c.querySelector('#svm-new-reminder-hours')?.focus();
    });
    c.querySelector('#svm-add-reminder-cancel')?.addEventListener('click', () => {
      addReminderForm.hidden = true;
      addReminderBtn.hidden = false;
    });
    c.querySelector('#svm-add-reminder-confirm')?.addEventListener('click', () => {
      const hoursInput = c.querySelector('#svm-new-reminder-hours');
      const hours = Math.min(720, Math.max(1, Number(hoursInput?.value) || 24));
      if (!state.serviceSettings) state.serviceSettings = {};
      if (!Array.isArray(state.serviceSettings.reminders)) state.serviceSettings.reminders = [];
      state.serviceSettings.reminders.push({ hoursBeforeAppointment: hours, isActive: true });
      renderAll();
    });
  }

  // Remove reminder
  c.querySelectorAll('[data-reminder-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.reminderRemove);
      if (state.serviceSettings?.reminders) {
        state.serviceSettings.reminders.splice(idx, 1);
        renderAll();
      }
    });
  });

  // Toggle reminder active/inactive
  c.querySelectorAll('[data-reminder-active]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.reminderActive);
      if (state.serviceSettings?.reminders?.[idx] !== undefined) {
        state.serviceSettings.reminders[idx].isActive = cb.checked;
        const label = cb.closest('.svm-toggle-wrap')?.querySelector('.svm-toggle-label');
        if (label) label.textContent = cb.checked ? 'Actif' : 'Inactif';
      }
    });
  });

  // Allow choose practitioner toggle
  const allowChooseCb = c.querySelector('#svm-allow-choose-pract');
  if (allowChooseCb) {
    allowChooseCb.addEventListener('change', () => {
      if (!state.serviceSettings) state.serviceSettings = {};
      state.serviceSettings.allowClientChoosePractitioner = allowChooseCb.checked;
      const label = allowChooseCb.closest('.svm-toggle-wrap')?.querySelector('.svm-toggle-label');
      if (label) label.textContent = allowChooseCb.checked ? 'Oui' : 'Non';
    });
  }

  attachModalEvents();
}

function closeAllKebabs() {
  document.querySelectorAll('.svm-kebab-menu--open').forEach(m => m.classList.remove('svm-kebab-menu--open'));
}

function attachModalTabEvents() {
  const c = state.container;
  if (!c) return;
  c.querySelectorAll('[data-svm-modal-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.modalTab = btn.dataset.svmModalTab;
      // Re-render tab bar active state
      c.querySelectorAll('[data-svm-modal-tab]').forEach(b =>
        b.classList.toggle('svm-modal-tab--active', b.dataset.svmModalTab === state.modalTab)
      );
      rerenderModalBody();
    });
  });
}

function attachModalEvents() {
  const c = state.container;
  if (!c) return;

  c.querySelector('#svm-modal-close')?.addEventListener('click', closeServiceModal);
  c.querySelector('#svm-modal-cancel')?.addEventListener('click', closeServiceModal);
  c.querySelector('#svm-modal-overlay')?.addEventListener('click', e => {
    if (e.target === c.querySelector('#svm-modal-overlay')) closeServiceModal();
  });
  c.querySelector('#svm-modal-save')?.addEventListener('click', saveService);

  attachModalTabEvents();
  attachModalBodyEvents();
}

function attachModalBodyEvents() {
  const c = state.container;
  if (!c) return;

  // Text/number fields
  c.querySelectorAll('[data-svm-field]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.dataset.svmField;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      setNestedField(state.form, key, val);
      // Re-render duration hint
      if (key === 'duration') {
        const hint = el.closest('.svm-field')?.querySelector('.svm-hint');
        if (hint) hint.textContent = formatDuration(val);
      }
      // Re-render payment type section if paymentType changes
      if (key === 'paymentType' || key === 'promotion.isActive' || key === 'boost.isActive') {
        rerenderModalBody();
      }
    });
  });

  // Payment type buttons
  c.querySelectorAll('[data-svm-pt]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.form.paymentType = btn.dataset.svmPt;
      rerenderModalBody();
    });
  });

  // Deposit type buttons
  c.querySelectorAll('[data-svm-dt]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.form.depositType = btn.dataset.svmDt;
      rerenderModalBody();
    });
  });

  // Duration increment
  c.querySelectorAll('[data-svm-dur]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.dataset.svmDur, 10);
      state.form.duration = Math.max(5, (Number(state.form.duration) || 60) + delta);
      rerenderModalBody();
    });
  });

  // Capacity increment
  c.querySelectorAll('[data-svm-cap]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = parseInt(btn.dataset.svmCap, 10);
      state.form.capacity = Math.max(1, (Number(state.form.capacity) || 1) + delta);
      rerenderModalBody();
    });
  });

  // bookingLeadDays stepper
  c.querySelectorAll('[data-svm-dec="bookingLeadDays"], [data-svm-inc="bookingLeadDays"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.svmInc !== undefined ? 1 : -1;
      state.form.bookingLeadDays = Math.max(0, (Number(state.form.bookingLeadDays) || 0) + delta);
      rerenderModalBody();
    });
  });

  // Options: add
  c.querySelector('#svm-add-option')?.addEventListener('click', () => {
    if (!state.form.options) state.form.options = [];
    state.form.options.push({ name: '', description: '', price: 0, isActive: true });
    rerenderModalBody();
  });

  // Options: remove
  c.querySelectorAll('[data-opt-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.optRemove, 10);
      state.form.options.splice(idx, 1);
      rerenderModalBody();
    });
  });

  // Options: field changes
  c.querySelectorAll('[data-opt-name]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = parseInt(el.dataset.optName, 10);
      if (state.form.options[idx]) state.form.options[idx].name = el.value;
    });
  });
  c.querySelectorAll('[data-opt-price]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = parseInt(el.dataset.optPrice, 10);
      if (state.form.options[idx]) state.form.options[idx].price = parseFloat(el.value) || 0;
    });
  });
  c.querySelectorAll('[data-opt-active]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.optActive, 10);
      if (state.form.options[idx]) state.form.options[idx].isActive = el.checked;
    });
  });

  // Photo upload
  const photoInput = c.querySelector('#svm-photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', () => {
      if (photoInput.files[0]) handlePhotoUpload(photoInput.files[0]);
    });
  }

  // Photo remove
  c.querySelectorAll('[data-photo-idx]').forEach(btn => {
    btn.addEventListener('click', () => handlePhotoRemove(parseInt(btn.dataset.photoIdx, 10)));
  });
}

// â”€â”€â”€ Nested field setter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function setNestedField(obj, key, value) {
  const parts = key.split('.');
  if (parts.length === 1) {
    if (typeof value === 'string' && (value === 'true' || value === 'false')) {
      obj[key] = value === 'true';
    } else {
      obj[key] = value;
    }
    return;
  }
  const [head, ...rest] = parts;
  if (!obj[head] || typeof obj[head] !== 'object') obj[head] = {};
  setNestedField(obj[head], rest.join('.'), value);
}

// â”€â”€â”€ Modal open/close â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function closeServiceModal() {
  state.modalOpen = false;
  renderAll();
}

async function openEditModal(id) {
  const service = state.services.find(s => s.id === id);
  if (!service) return;
  state.form = {
    name: service.name || '',
    description: service.description || '',
    shortDescription: service.shortDescription || '',
    duration: service.duration || 60,
    price: service.price ?? '',
    isActive: service.isActive !== false,
    isBookable: service.isBookable !== false,
    paymentType: service.paymentType || 'full',
    depositType: service.depositType || 'percentage',
    depositValue: service.depositValue || 0,
    capacity: service.capacity || 1,
    bufferTime: service.bufferTime || 0,
    cancellationDays: service.cancellationDays ?? 7,
    bookingLeadDays: service.bookingLeadDays ?? 0,
    options: (service.options || []).map(o => ({ ...o })),
    photos: [...(service.photos || [])],
    promotion: { ...(service.promotion || {}) },
    boost: { ...(service.boost || {}) }
  };
  state.modalMode = 'edit';
  state.modalTab = 'general';
  state.editingId = id;
  state.modalOpen = true;
  renderAll();
}

// â”€â”€â”€ Save handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function saveService() {
  if (state.saving) return;
  const f = state.form;
  if (!f.name?.trim()) {
    showToast({ type: 'error', message: 'Le nom est obligatoire.', durationMs: 1000 });
    state.modalTab = 'general';
    renderAll();
    return;
  }
  if (!f.duration || Number(f.duration) < 1) {
    showToast({ type: 'error', message: 'La duree est obligatoire.', durationMs: 1000 });
    state.modalTab = 'general';
    renderAll();
    return;
  }

  state.saving = true;
  const saveBtn = state.container?.querySelector('#svm-modal-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="bi bi-arrow-repeat svm-spin"></i> Enregistrementâ€¦';
  }

  try {
    const body = {
      name: f.name.trim(),
      description: f.description || '',
      shortDescription: f.shortDescription || '',
      duration: Number(f.duration),
      price: parseFloat(f.price) || 0,
      isActive: f.isActive !== false,
      isBookable: f.isBookable !== false,
      paymentType: f.paymentType || 'full',
      depositType: f.depositType || 'percentage',
      depositValue: parseFloat(f.depositValue) || 0,
      capacity: Math.max(1, parseInt(f.capacity, 10) || 1),
      bufferTime: parseInt(f.bufferTime, 10) || 0,
      cancellationDays: parseInt(f.cancellationDays, 10) ?? 7,
      bookingLeadDays: Math.max(0, parseInt(f.bookingLeadDays, 10) || 0),
      options: (f.options || []).filter(o => o.name?.trim()),
      promotion: f.promotion || {},
      boost: f.boost || {}
    };

    if (state.modalMode === 'create') {
      const data = await apiFetch(API.services, { method: 'POST', body: JSON.stringify(body) });
      state.services.unshift(data.service);
      showToast({ type: 'success', message: 'Prestation creee.', durationMs: 1000 });
    } else {
      const data = await apiFetch(API.service(state.editingId), { method: 'PUT', body: JSON.stringify(body) });
      const idx = state.services.findIndex(s => s.id === state.editingId);
      if (idx >= 0) state.services[idx] = data.service;
      showToast({ type: 'success', message: 'Prestation mise a jour.', durationMs: 1000 });
    }
    state.modalOpen = false;
    renderAll();
  } catch (err) {
    logUiError('serviceModule.saveService', err);
    showToast({ type: 'error', message: err.message || 'Erreur lors de la sauvegarde.', durationMs: 1000 });
  } finally {
    state.saving = false;
  }
}

async function activateMyPractitioner() {
  if (state.myPractToggling) return;
  state.myPractToggling = true;
  renderAll();
  try {
    await apiFetch(API.practitionerActivate, { method: 'POST' });
    await Promise.all([loadPractitioners(), loadMyPractitionerProfile()]);
    state.practitionersSubTab = 'me';
    showToast({ type: 'success', message: 'Statut praticienne active.', durationMs: 1000 });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.activateMyPractitioner', err);
    showToast({ type: 'error', message: err.message || 'Erreur activation.', durationMs: 1000 });
  } finally {
    state.myPractToggling = false;
    renderAll();
  }
}

async function deactivateMyPractitioner() {
  if (state.myPractToggling) return;
  state.myPractToggling = true;
  renderAll();
  try {
    await apiFetch(API.practitionerDeactivate, { method: 'POST' });
    await Promise.all([loadPractitioners(), loadMyPractitionerProfile()]);
    showToast({ type: 'success', message: 'Statut praticienne desactive.', durationMs: 1000 });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.deactivateMyPractitioner', err);
    showToast({ type: 'error', message: err.message || 'Erreur desactivation.', durationMs: 1000 });
  } finally {
    state.myPractToggling = false;
    renderAll();
  }
}

async function saveMyPractitionerProfile() {
  if (state.myPractSaving) return;
  const form = state.myPractForm || {};
  state.myPractSaving = true;
  renderAll();

  try {
    const body = {
      displayName: String(form.displayName || '').trim(),
      bio: String(form.bio || '').trim(),
      slotGranularity: Number(form.slotGranularity) || 30,
      serviceIds: Array.isArray(form.serviceIds) ? form.serviceIds : []
    };

    const data = await apiFetch(API.practitionerUpdate, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    state.myPractitioner = data.practitioner || state.myPractitioner;
    state.myPractForm = getDefaultPractitionerForm(state.myPractitioner);
    await loadPractitioners();
    showToast({ type: 'success', message: 'Profil praticienne enregistre.', durationMs: 1000 });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.saveMyPractitionerProfile', err);
    showToast({ type: 'error', message: err.message || 'Erreur lors de la sauvegarde.', durationMs: 1000 });
  } finally {
    state.myPractSaving = false;
    renderAll();
  }
}

// â”€â”€â”€ Service actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function toggleServiceActive(id, currentActive) {
  try {
    const body = { isActive: !currentActive };
    const data = await apiFetch(API.service(id), { method: 'PUT', body: JSON.stringify(body) });
    const idx = state.services.findIndex(s => s.id === id);
    if (idx >= 0) state.services[idx] = { ...state.services[idx], ...data.service };
    showToast({
      type: 'success',
      message: data.service.isActive ? 'Prestation activee.' : 'Prestation desactivee.',
      durationMs: 1000
    });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.toggleServiceActive', err);
    showToast({ type: 'error', message: err.message || 'Erreur.', durationMs: 1000 });
  }
}

async function toggleServiceBoost(id, currentBoost) {
  try {
    const data = await apiFetch(API.boost(id), {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !currentBoost })
    });
    const idx = state.services.findIndex(s => s.id === id);
    if (idx >= 0) state.services[idx].boost = data.boost;
    showToast({
      type: 'success',
      message: data.boost.isActive ? 'Boost active.' : 'Boost desactive.',
      durationMs: 1000
    });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.toggleServiceBoost', err);
    showToast({ type: 'error', message: err.message || 'Erreur.', durationMs: 1000 });
  }
}

async function openPromoModal(id) {
  const service = state.services.find(s => s.id === id);
  if (!service) return;
  await openEditModal(id);
  state.modalTab = 'avance';
  renderAll();
}

async function duplicateService(id) {
  const service = state.services.find(s => s.id === id);
  if (!service) return;
  state.form = {
    name: `${service.name} (copie)`,
    description: service.description || '',
    shortDescription: service.shortDescription || '',
    duration: service.duration,
    price: service.price,
    isActive: false,
    isBookable: service.isBookable,
    paymentType: service.paymentType,
    depositType: service.depositType,
    depositValue: service.depositValue,
    capacity: service.capacity,
    bufferTime: service.bufferTime,
    cancellationDays: service.cancellationDays,
    options: (service.options || []).map(o => ({ ...o })),
    photos: [],
    promotion: { isActive: false, type: 'percentage', value: 0 },
    boost: { isActive: false, order: 0 }
  };
  state.modalMode = 'create';
  state.modalTab = 'general';
  state.editingId = null;
  state.modalOpen = true;
  renderAll();
}

async function confirmDeleteService(id) {
  const service = state.services.find(s => s.id === id);
  if (!service) return;
  if (!window.confirm(`DÃ©sactiver "${service.name}" ?`)) return;
  try {
    await apiFetch(API.service(id), { method: 'DELETE' });
    const idx = state.services.findIndex(s => s.id === id);
    if (idx >= 0) state.services[idx].isActive = false;
    showToast({ type: 'success', message: 'Prestation desactivee.', durationMs: 1000 });
    renderAll();
  } catch (err) {
    logUiError('serviceModule.confirmDeleteService', err);
    showToast({ type: 'error', message: err.message || 'Erreur.', durationMs: 1000 });
  }
}

// â”€â”€â”€ Photo handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handlePhotoUpload(file) {
  if (!state.editingId) return;
  const formData = new FormData();
  formData.append('photo', file);
  try {
    const res = await fetch(API.uploadPhoto(state.editingId), {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.form.photos = data.photos || [];
    const idx = state.services.findIndex(s => s.id === state.editingId);
    if (idx >= 0) state.services[idx].photos = data.photos;
    showToast({ type: 'success', message: 'Photo ajoutee.', durationMs: 1000 });
    rerenderModalBody();
  } catch (err) {
    logUiError('serviceModule.handlePhotoUpload', err);
    showToast({ type: 'error', message: err.message || 'Erreur upload.', durationMs: 1000 });
  }
}

async function handlePhotoRemove(photoIdx) {
  if (!state.editingId) return;
  try {
    const data = await apiFetch(API.deletePhoto(state.editingId, photoIdx), { method: 'DELETE' });
    state.form.photos = data.photos || [];
    const idx = state.services.findIndex(s => s.id === state.editingId);
    if (idx >= 0) state.services[idx].photos = data.photos;
    showToast({ type: 'success', message: 'Photo supprimee.', durationMs: 1000 });
    rerenderModalBody();
  } catch (err) {
    logUiError('serviceModule.handlePhotoRemove', err);
    showToast({ type: 'error', message: err.message || 'Erreur suppression photo.', durationMs: 1000 });
  }
}

// â”€â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function saveServiceSettings() {
  if (state.serviceSettingsSaving) return;
  const c = state.container;
  state.serviceSettingsSaving = true;
  renderAll();
  try {
    const res = await fetch(API.serviceSettings, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.serviceSettings || {})
    });
    const data = await res.json();
    if (data.ok) {
      state.serviceSettings = data.settings || state.serviceSettings;
      showToast({ type: 'success', message: 'Paramètres enregistrés.' });
    } else {
      showToast({ type: 'error', message: data.error || 'Erreur.' });
    }
  } catch (_) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  } finally {
    state.serviceSettingsSaving = false;
    renderAll();
  }
}

export async function renderModule(container) {
  state.container = container;
  state.loading = true;
  injectCss();

  container.innerHTML = `<div class="svm-root"><div class="svm-loader"><i class="bi bi-arrow-repeat svm-spin"></i> Chargementâ€¦</div></div>`;

  await Promise.all([loadServices(), loadPractitioners(), loadMyPractitionerProfile(), loadServiceSettings()]);

  state.loading = false;
  renderAll();
}
