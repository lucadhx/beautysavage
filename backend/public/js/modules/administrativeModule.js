import { showToast } from '../helpers/toastService.js';
import { setActionButtonState } from '../helpers/actionButtonState.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const AUTH_ME_ENDPOINT = '/auth/me';
const CONTRACT_ACTIVE_ENDPOINT = '/api/gestion/contract/active';
const CONTRACT_ARCHIVES_ENDPOINT = '/api/gestion/contract/archives';
const CONTRACT_CREATE_ENDPOINT = '/api/gestion/contract';
const CONTRACT_TERMINATE_ENDPOINT = '/api/gestion/contract/terminate';
const MIN_LOADER_MS = 1000;

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const state = {
  container: null,
  boundClickHandler: null,
  role: null,
  loading: true,
  loadingLabel: 'Chargement du contrat...',
  activeContract: null,
  archives: []
};

const nodes = {
  moduleContent: null
};

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  const numeric = Number(value);
  return euroFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

function formatDate(value) {
  if (!value) return 'Date indisponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date indisponible';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateShort(value) {
  if (!value) return 'Date indisponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date indisponible';
  return date.toLocaleDateString('fr-FR');
}

function getDurationLabel(duration = {}) {
  const years = Number(duration?.years || 0);
  const months = Number(duration?.months || 0);
  const days = Number(duration?.days || 0);
  return `${years} annee(s), ${months} mois, ${days} jour(s)`;
}

function getRemainingTimerLabel(endAt) {
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return 'Fin indisponible';
  const now = new Date();
  if (end <= now) return 'Contrat arrive a terme';

  const cursor = new Date(now);
  let years = 0;
  while (true) {
    const next = new Date(cursor);
    next.setFullYear(next.getFullYear() + 1);
    if (next > end) break;
    years += 1;
    cursor.setFullYear(cursor.getFullYear() + 1);
  }

  let months = 0;
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next > end) break;
    months += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const remainingMs = end.getTime() - cursor.getTime();
  const days = Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));

  return `Fin dans ${years} annee(s) ${months} mois ${days} jour(s)`;
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

function createHttpError(message, response, payload, endpoint) {
  const error = new Error(message || 'Operation impossible.');
  error.status = response?.status || null;
  error.payload = payload || null;
  error.endpoint = endpoint || null;
  return error;
}

function parseDownloadFilename(contentDisposition, fallbackName) {
  const fallback = String(fallbackName || 'contrat.pdf');
  const raw = String(contentDisposition || '');
  const utf8 = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch (_error) {
      return fallback;
    }
  }
  const simple = raw.match(/filename="?([^"]+)"?/i);
  return simple?.[1] ? simple[1] : fallback;
}

function logModuleError(context, error, extra = {}) {
  logUiError(`AdministrativeModule:${context}`, error, {
    status: error?.status || null,
    endpoint: error?.endpoint || null,
    payload: error?.payload || null,
    message: error?.message || null,
    ...extra
  });
}

function loaderMarkup(label = 'Chargement...') {
  return `
    <div class="gcg-inline-loader ctm-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

async function fetchRole() {
  const response = await fetch(AUTH_ME_ENDPOINT, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    throw createHttpError(payload?.error || 'Impossible de v?rifier la session.', response, payload, AUTH_ME_ENDPOINT);
  }
  return String(payload?.user?.role || '').trim().toLowerCase();
}

async function fetchActiveContract() {
  const endpoint = CONTRACT_ACTIVE_ENDPOINT;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    throw createHttpError(payload?.error || 'Impossible de lire le contrat actif.', response, payload, endpoint);
  }
  return payload?.contract || null;
}

async function fetchArchivedContracts() {
  const endpoint = CONTRACT_ARCHIVES_ENDPOINT;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    throw createHttpError(payload?.error || 'Impossible de lire les archives contrats.', response, payload, endpoint);
  }
  return Array.isArray(payload?.contracts) ? payload.contracts : [];
}

function getContractById(contractId) {
  const active = state.activeContract;
  if (active && String(active.contractId) === String(contractId)) return active;
  return state.archives.find(contract => String(contract.contractId) === String(contractId)) || null;
}

function getContractFileEndpoint(contractId, { download = false } = {}) {
  const suffix = download ? '?download=1' : '';
  return `${CONTRACT_CREATE_ENDPOINT}/${encodeURIComponent(String(contractId || ''))}/file${suffix}`;
}

function renderForbiddenState() {
  if (!nodes.moduleContent) return;
  nodes.moduleContent.innerHTML = `
    <article class="ctm-empty-state">
      <span class="ctm-empty-state__icon" aria-hidden="true"><i class="bi bi-shield-lock"></i></span>
      <h3>Acces reserve au role DEV</h3>
      <p>Cette page administrative n est disponible que pour les developpeurs.</p>
    </article>
  `;
}

function renderActiveContractSection() {
  const contract = state.activeContract;
  if (!contract) {
    return `
      <article class="ctm-card ctm-card--empty">
        <div class="ctm-empty-state">
          <span class="ctm-empty-state__icon" aria-hidden="true"><i class="bi bi-file-earmark-x"></i></span>
          <h3>Aucun contrat actuel</h3>
          <p>Aucun contrat actif n est enregistre pour le moment.</p>
          <button type="button" class="ctm-button ctm-button--primary" data-action="open-new-contract">
            <i class="bi bi-plus-circle" aria-hidden="true"></i>
            <span>Nouveau contrat</span>
          </button>
        </div>
      </article>
    `;
  }

  return `
    <article class="ctm-card">
      <header class="ctm-card__header">
        <div>
          <h3>Contrat actif</h3>
          <p>Identifiant: <strong>${escapeHtml(contract.contractId)}</strong></p>
        </div>
        <span class="ctm-status-badge">${escapeHtml(String(contract.status || 'active').toUpperCase())}</span>
      </header>
      <div class="ctm-metrics">
        <p><span>Mensualité maintenance</span><strong>${escapeHtml(formatCurrency(contract.maintenanceMonthlyAmount))}/mois</strong></p>
        <p><span>Commission</span><strong>${escapeHtml(String(contract.commissionPercent ?? 0))}%</strong></p>
        <p><span>Durée</span><strong>${escapeHtml(getDurationLabel(contract.duration))}</strong></p>
        <p><span>Période</span><strong>${escapeHtml(formatDateShort(contract.startAt))} -> ${escapeHtml(formatDateShort(contract.endAt))}</strong></p>
      </div>
      <p class="ctm-timer">${escapeHtml(getRemainingTimerLabel(contract.endAt))}</p>
      <div class="ctm-file-actions">
        <button type="button" class="ctm-icon-button" data-action="view-file" data-contract-id="${escapeHtml(contract.contractId)}" aria-label="Voir le contrat">
          <i class="bi bi-eye" aria-hidden="true"></i>
          <span>Voir</span>
        </button>
        <button type="button" class="ctm-icon-button" data-action="download-file" data-contract-id="${escapeHtml(contract.contractId)}" aria-label="Télécharger le contrat">
          <i class="bi bi-download" aria-hidden="true"></i>
          <span>Télécharger</span>
        </button>
      </div>
      <div class="ctm-card__footer">
        <button type="button" class="ctm-button ctm-button--secondary" data-action="open-new-contract">
          <i class="bi bi-plus-circle" aria-hidden="true"></i>
          <span>Nouveau contrat</span>
        </button>
        <button type="button" class="ctm-button ctm-button--danger" data-action="open-terminate-contract" data-contract-id="${escapeHtml(contract.contractId)}">
          <span>Résilier</span>
        </button>
      </div>
    </article>
  `;
}

function renderArchivesSection() {
  const contracts = Array.isArray(state.archives) ? state.archives : [];
  if (!contracts.length) {
    return `
      <article class="ctm-card ctm-card--empty">
        <div class="ctm-empty-state ctm-empty-state--compact">
          <span class="ctm-empty-state__icon" aria-hidden="true"><i class="bi bi-clock-history"></i></span>
          <h3>Aucune archive</h3>
          <p>Les contrats résiliés apparaîtront ici.</p>
        </div>
      </article>
    `;
  }
  return `
    <div class="ctm-archive-grid">
      ${contracts
        .map(
          contract => `
            <article class="ctm-archive-card">
              <header class="ctm-archive-card__header">
                <strong>${escapeHtml(contract.contractId)}</strong>
                <small>Résilié le ${escapeHtml(formatDateShort(contract.terminatedAt))}</small>
              </header>
              <p>Période: <strong>${escapeHtml(formatDateShort(contract.startAt))} -> ${escapeHtml(formatDateShort(contract.endAt))}</strong></p>
              <p>Maintenance: <strong>${escapeHtml(formatCurrency(contract.maintenanceMonthlyAmount))}/mois</strong></p>
              <p>Commission: <strong>${escapeHtml(String(contract.commissionPercent ?? 0))}%</strong></p>
              <button type="button" class="ctm-icon-button ctm-icon-button--compact" data-action="open-archive-detail" data-contract-id="${escapeHtml(contract.contractId)}" aria-label="Voir les détails du contrat archivé">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
                <span>Détails</span>
              </button>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderModuleContent() {
  if (!nodes.moduleContent) return;
  if (state.loading) {
    nodes.moduleContent.innerHTML = loaderMarkup(state.loadingLabel);
    return;
  }

  if (state.role !== 'dev' && state.role !== 'admin') {
    renderForbiddenState();
    return;
  }

  nodes.moduleContent.innerHTML = `
    <section class="ctm-layout">
      <section class="ctm-section">
        <header class="ctm-section__header">
          <h3>Statut du contrat</h3>
          <p>Suivi du contrat actif, vision PDF et résiliation contrôlée.</p>
        </header>
        ${renderActiveContractSection()}
      </section>
      <section class="ctm-section">
        <header class="ctm-section__header">
          <h3>Archives contrats</h3>
          <p>Historique des contrats résiliés consultable à tout moment.</p>
        </header>
        ${renderArchivesSection()}
      </section>
    </section>
  `;
}

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel ctm-module">
      <header class="ctm-header">
        <div>
          <h2>Administrative - Contrat</h2>
          <p>Gestion admin/dev du contrat actif, des archives, du fichier signe et des mises a jour commission.</p>
        </div>
      </header>
      <div data-contract-module-content></div>
    </section>
  `;
  nodes.moduleContent = container.querySelector('[data-contract-module-content]');
}

function openModal({ title, subtitle = '', bodyHtml = '', modalClass = '', bodyClass = '', onClose = null }) {
  const overlay = document.createElement('div');
  overlay.className = 'module-modal-overlay module-modal-overlay--visible ctm-modal-overlay';
  overlay.innerHTML = `
    <div class="module-modal ctm-modal ${escapeHtml(modalClass)}" role="dialog" aria-modal="true">
      <header class="module-modal__header ctm-modal__header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <button type="button" class="module-modal__close" data-contract-modal-close aria-label="Fermer">&times;</button>
      </header>
      <div class="ctm-modal__body ${escapeHtml(bodyClass)}" data-contract-modal-body>
        ${bodyHtml}
      </div>
    </div>
  `;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onEscape);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const onEscape = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };

  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-contract-modal-close]')?.addEventListener('click', close);
  window.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
  return { overlay, close };
}

async function loadContracts({ showLoader = true, loadingLabel = 'Chargement du contrat...' } = {}) {
  const startedAt = Date.now();
  if (showLoader) {
    state.loading = true;
    state.loadingLabel = loadingLabel;
    renderModuleContent();
  }
  try {
    const [activeContract, archives] = await Promise.all([fetchActiveContract(), fetchArchivedContracts()]);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (showLoader && remaining > 0) {
      await wait(remaining);
    }
    state.activeContract = activeContract;
    state.archives = archives;
    state.loading = false;
    renderModuleContent();
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (showLoader && remaining > 0) {
      await wait(remaining);
    }
    state.activeContract = null;
    state.archives = [];
    state.loading = false;
    renderModuleContent();
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('LoadContracts', error);
  }
}

async function downloadContractFile(contractId, button = null) {
  const endpoint = getContractFileEndpoint(contractId, { download: true });
  const startedAt = Date.now();
  if (button) {
    setActionButtonState(button, 'loading', { loadingLabel: 'Telechargement...' });
  }
  try {
    const response = await fetch(endpoint, { credentials: 'include' });
    if (!response.ok) {
      const payload = await getJson(response);
      throw createHttpError(payload?.error || 'Telechargement impossible.', response, payload, endpoint);
    }
    const blob = await response.blob();
    const filename = parseDownloadFilename(
      response.headers.get('content-disposition'),
      `contrat-${contractId}.pdf`
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    if (button) {
      setActionButtonState(button, 'success', { successLabel: 'Telecharge' });
    }
    showToast({ type: 'success', message: 'Action effectuee', durationMs: 1000 });
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    if (button) {
      setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    }
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('DownloadContractFile', error, { contractId });
  }
}

function openContractViewer(contractId) {
  const endpoint = getContractFileEndpoint(contractId, { download: false });
  openModal({
    title: 'Apercu du contrat',
    subtitle: `Contrat ${contractId}`,
    modalClass: 'ctm-modal--viewer',
    bodyClass: 'ctm-modal__body--viewer',
    bodyHtml: `
      <div class="ctm-pdf-viewer">
        <iframe src="${escapeHtml(endpoint)}" title="Visualisation du contrat ${escapeHtml(contractId)}"></iframe>
      </div>
    `
  });
}

function openArchiveDetailModal(contract) {
  if (!contract) return;
  const { overlay } = openModal({
    title: `Archive ${contract.contractId}`,
    subtitle: 'Détails du contrat résilié',
    modalClass: 'ctm-modal--detail',
    bodyClass: 'ctm-modal__body--detail',
    bodyHtml: `
      <div class="ctm-detail-grid">
        <p><span>Identifiant</span><strong>${escapeHtml(contract.contractId)}</strong></p>
        <p><span>Statut</span><strong>${escapeHtml(String(contract.status || 'terminated'))}</strong></p>
        <p><span>Mensualité maintenance</span><strong>${escapeHtml(formatCurrency(contract.maintenanceMonthlyAmount))}/mois</strong></p>
        <p><span>Commission</span><strong>${escapeHtml(String(contract.commissionPercent ?? 0))}%</strong></p>
        <p><span>Période</span><strong>${escapeHtml(formatDateShort(contract.startAt))} -> ${escapeHtml(formatDateShort(contract.endAt))}</strong></p>
        <p><span>Durée</span><strong>${escapeHtml(getDurationLabel(contract.duration))}</strong></p>
        <p><span>Date résiliation</span><strong>${escapeHtml(formatDate(contract.terminatedAt))}</strong></p>
        <p><span>Motif résiliation</span><strong>${escapeHtml(contract.terminationReason || 'Non renseigné')}</strong></p>
      </div>
      <div class="ctm-file-actions ctm-file-actions--modal">
        <button type="button" class="ctm-icon-button" data-contract-modal-action="view-file" data-contract-id="${escapeHtml(contract.contractId)}" aria-label="Voir le contrat archive">
          <i class="bi bi-eye" aria-hidden="true"></i>
          <span>Voir</span>
        </button>
        <button type="button" class="ctm-icon-button" data-contract-modal-action="download-file" data-contract-id="${escapeHtml(contract.contractId)}" aria-label="Télécharger le contrat archivé">
          <i class="bi bi-download" aria-hidden="true"></i>
          <span>Télécharger</span>
        </button>
      </div>
    `
  });

  overlay.addEventListener('click', event => {
    const button = event.target.closest('[data-contract-modal-action]');
    if (!button) return;
    const action = String(button.dataset.contractModalAction || '');
    const contractId = String(button.dataset.contractId || '');
    if (!contractId) return;
    if (action === 'view-file') {
      openContractViewer(contractId);
      return;
    }
    if (action === 'download-file') {
      downloadContractFile(contractId, button);
    }
  });
}

function openTerminateModal(contractId = '') {
  const activeContract =
    getContractById(contractId) ||
    state.activeContract ||
    null;
  if (!activeContract) {
    showToast({ type: 'error', message: 'Contrat introuvable', durationMs: 1000 });
    loadContracts({ showLoader: false }).catch(error => {
      logModuleError('ReloadAfterMissingTerminateContract', error);
    });
    return;
  }

  const { overlay, close } = openModal({
    title: 'Résilier le contrat actif',
    subtitle: 'Cette action déplace le contrat dans les archives.',
    bodyHtml: `
      <div class="ctm-confirm-content">
        <p>Confirmez la résiliation du contrat <strong>${escapeHtml(activeContract.contractId)}</strong>.</p>
        <label class="form-label">
          Motif (optionnel)
          <textarea class="gcg-minimal-input gcg-minimal-input--textarea" rows="3" data-termination-reason placeholder="Motif interne de résiliation"></textarea>
        </label>
        <div data-termination-feedback></div>
        <div class="form-actions">
          <button type="button" class="secondary-button" data-terminate-cancel>Annuler</button>
          <button type="button" class="ctm-button ctm-button--danger" data-terminate-confirm>Confirmer la résiliation</button>
        </div>
      </div>
    `
  });

  overlay.querySelector('[data-terminate-cancel]')?.addEventListener('click', close);

  overlay.querySelector('[data-terminate-confirm]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const feedback = overlay.querySelector('[data-termination-feedback]');
    const reason = overlay.querySelector('[data-termination-reason]')?.value || '';
    const startedAt = Date.now();
    setActionButtonState(button, 'loading', { loadingLabel: 'Résiliation...' });
    if (feedback) feedback.innerHTML = loaderMarkup('Résiliation en cours...');
    try {
      const response = await fetch(CONTRACT_TERMINATE_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminationReason: reason })
      });
      const payload = await getJson(response);
      if (!response.ok) {
        throw createHttpError(payload?.error || 'Résiliation impossible.', response, payload, CONTRACT_TERMINATE_ENDPOINT);
      }
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      setActionButtonState(button, 'success', { successLabel: 'Résilié' });
      showToast({ type: 'success', message: 'Contrat résilié', durationMs: 1000 });
      close();
      await loadContracts({ showLoader: true, loadingLabel: 'Actualisation des contrats...' });
    } catch (error) {
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      if (feedback) {
        feedback.innerHTML = `<p class="form-message form-message--error">${escapeHtml(error?.message || 'Résiliation impossible.')}</p>`;
      }
      logModuleError('TerminateContract', error, {
        contractId: activeContract.contractId,
        terminationReason: reason
      });
    }
  });
}

function openCreateContractModal() {
  const { overlay, close } = openModal({
    title: 'Nouveau contrat',
    subtitle: 'Saisissez les paramètres et uploadez le PDF signé.',
    modalClass: 'ctm-modal--create',
    bodyClass: 'ctm-modal__body--create',
    bodyHtml: `
      <form class="ctm-create-form" data-create-contract-form novalidate>
        <label class="form-label">
          Mensualité de maintenance (EUR/mois)
          <input type="number" class="gcg-minimal-input" name="maintenanceMonthlyAmount" min="0" step="0.01" required />
        </label>
        <label class="form-label">
          Pourcentage de commission (%)
          <input type="number" class="gcg-minimal-input" name="commissionPercent" min="0" step="0.01" required />
        </label>
        <fieldset class="ctm-duration-picker">
          <legend>Durée du contrat</legend>
          <div class="ctm-duration-grid">
            <label class="form-label">
              Annees
              <input type="number" class="gcg-minimal-input" name="durationYears" min="0" step="1" value="1" required />
            </label>
            <label class="form-label">
              Mois
              <input type="number" class="gcg-minimal-input" name="durationMonths" min="0" step="1" value="0" required />
            </label>
            <label class="form-label">
              Jours
              <input type="number" class="gcg-minimal-input" name="durationDays" min="0" step="1" value="0" required />
            </label>
          </div>
        </fieldset>
        <div class="ctm-upload-block">
          <input type="file" id="ctm-contract-file" name="contractFile" accept="application/pdf,.pdf" hidden required />
          <button type="button" class="ctm-button ctm-button--upload" data-action="pick-contract-file">
            <i class="bi bi-file-earmark-arrow-up" aria-hidden="true"></i>
            <span>Uploader le contrat</span>
          </button>
          <p class="ctm-file-preview" data-contract-file-preview>Aucun fichier selectionne.</p>
        </div>
        <div data-create-feedback></div>
        <div class="form-actions">
          <button type="button" class="secondary-button" data-create-cancel>Annuler</button>
          <button type="submit" class="ctm-button ctm-button--primary" data-create-submit>Valider</button>
        </div>
      </form>
    `
  });

  const form = overlay.querySelector('[data-create-contract-form]');
  const fileInput = overlay.querySelector('#ctm-contract-file');
  const filePreview = overlay.querySelector('[data-contract-file-preview]');
  const feedback = overlay.querySelector('[data-create-feedback]');
  const submitButton = overlay.querySelector('[data-create-submit]');

  overlay.querySelector('[data-create-cancel]')?.addEventListener('click', close);
  overlay.querySelector('[data-action="pick-contract-file"]')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0] || null;
    if (!filePreview) return;
    if (!file) {
      filePreview.textContent = 'Aucun fichier selectionne.';
      return;
    }
    const sizeKb = Math.max(1, Math.round((Number(file.size || 0) / 1024) * 10) / 10);
    filePreview.textContent = `${file.name} (${sizeKb} Ko)`;
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const years = Number(formData.get('durationYears') || 0);
    const months = Number(formData.get('durationMonths') || 0);
    const days = Number(formData.get('durationDays') || 0);
    if (years + months + days <= 0) {
      if (feedback) {
        feedback.innerHTML = '<p class="form-message form-message--error">La dur?e du contrat doit ?tre sup?rieure ? z?ro.</p>';
      }
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      return;
    }
    const file = fileInput?.files?.[0] || null;
    if (!file) {
      if (feedback) {
        feedback.innerHTML = '<p class="form-message form-message--error">Le fichier PDF du contrat est requis.</p>';
      }
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      return;
    }

    const startedAt = Date.now();
    setActionButtonState(submitButton, 'loading', { loadingLabel: 'Creation...' });
    if (feedback) feedback.innerHTML = loaderMarkup('Creation du contrat...');
    try {
      const response = await fetch(CONTRACT_CREATE_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const payload = await getJson(response);
      if (!response.ok) {
        throw createHttpError(payload?.error || 'Creation du contrat impossible.', response, payload, CONTRACT_CREATE_ENDPOINT);
      }
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      setActionButtonState(submitButton, 'success', { successLabel: 'Cree' });
      showToast({ type: 'success', message: 'Contrat cree', durationMs: 1000 });
      close();
      await loadContracts({ showLoader: true, loadingLabel: 'Actualisation des contrats...' });
    } catch (error) {
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
      setActionButtonState(submitButton, 'error', { errorLabel: '\u00c9chec' });
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      if (feedback) {
        feedback.innerHTML = `<p class="form-message form-message--error">${escapeHtml(error?.message || 'Creation impossible.')}</p>`;
      }
      logModuleError('CreateContract', error, {
        payload: {
          maintenanceMonthlyAmount: formData.get('maintenanceMonthlyAmount'),
          commissionPercent: formData.get('commissionPercent'),
          durationYears: formData.get('durationYears'),
          durationMonths: formData.get('durationMonths'),
          durationDays: formData.get('durationDays'),
          file: file?.name || null
        }
      });
    }
  });
}

function bindEvents() {
  if (!state.container) return;
  if (state.boundClickHandler) {
    state.container.removeEventListener('click', state.boundClickHandler);
  }
  state.boundClickHandler = event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = String(button.dataset.action || '').trim();
    const contractId = String(button.dataset.contractId || '').trim();

    if (action === 'open-new-contract') {
      openCreateContractModal();
      return;
    }

    if (action === 'open-terminate-contract') {
      openTerminateModal(contractId);
      return;
    }

    if (action === 'view-file' && contractId) {
      openContractViewer(contractId);
      return;
    }

    if (action === 'download-file' && contractId) {
      downloadContractFile(contractId, button);
      return;
    }

    if (action === 'open-archive-detail' && contractId) {
      const contract = getContractById(contractId);
      if (contract) {
        openArchiveDetailModal(contract);
      }
    }
  };
  state.container.addEventListener('click', state.boundClickHandler);
}

export async function renderModule(container) {
  if (!container) return;
  state.container = container;
  state.role = null;
  state.loading = true;
  state.loadingLabel = 'Chargement du contrat...';
  state.activeContract = null;
  state.archives = [];

  renderShell(container);
  renderModuleContent();
  bindEvents();

  const startedAt = Date.now();
  try {
    state.role = await fetchRole();
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    state.loading = false;
    renderModuleContent();
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('FetchRole', error);
    return;
  }

  if (state.role !== 'dev' && state.role !== 'admin') {
    state.loading = false;
    renderModuleContent();
    return;
  }

  await loadContracts({ showLoader: true, loadingLabel: 'Chargement des contrats...' });
}

export default { renderModule };
