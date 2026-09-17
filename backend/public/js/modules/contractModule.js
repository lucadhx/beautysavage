// contractModule.js — Gestion du contrat (developer only) v3.0
// UI premium Beauty Savage · classes contract-* · CSS fichier séparé

const API = {
  active: '/api/contract/active',
  history: '/api/contract/history',
  gracePeriod: id => `/api/contract/${id}/grace-period`,
  pendingMessage: id => `/api/contract/${id}/pending-message`,
  deleteContract: id => `/api/contract/${id}`,
  createContract: '/api/contract',
  checkPaymentStatus: '/api/contract/check-payment-status',
  activate: '/api/contract/activate',
  cancelImmediate: '/api/contract/cancel-immediate'
};

// ─── Helpers ──────────────────────────────────────────────

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatEur(n) {
  return Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function activeSince(activatedAt) {
  if (!activatedAt) return '—';
  const ms = Date.now() - new Date(activatedAt).getTime();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days === 0) return hours <= 1 ? 'Moins d\'une heure' : `${hours} heures`;
  if (days === 1) return '1 jour';
  if (days < 30) return `${days} jours`;
  return `${Math.floor(days / 30)} mois`;
}

function fileIcon(mimeType, originalName) {
  const n = String(originalName || '').toLowerCase();
  return (n.endsWith('.pdf') || String(mimeType || '').includes('pdf'))
    ? 'bi-file-earmark-pdf'
    : 'bi-file-earmark-word';
}

function stripeSvg() {
  return `<svg width="38" height="16" viewBox="0 0 60 25" fill="currentColor" aria-hidden="true" style="display:inline-block;vertical-align:middle;opacity:0.75">
    <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a14.05 14.05 0 01-4.83.86c-4.21 0-6.83-2.67-6.83-7.51 0-4.55 2.55-7.64 6.37-7.64 3.96 0 6.1 2.93 6.1 7.36v1.01zm-4.35-2.54c0-1.6-.57-2.7-1.7-2.7-1.05 0-1.77.9-1.9 2.7h3.6zm-10.5-8.46l.18-1.27H40.5V24.5h4.8V17.1c.65.58 1.6.92 2.7.92 3.4 0 5.8-3.14 5.8-7.84 0-4.41-2.36-7.35-5.7-7.35-1.2 0-2.15.4-2.81 1.01v-.55zM45.3 14.9V8.5c.4-.3.83-.5 1.33-.5 1.63 0 2.48 1.4 2.48 4.1 0 2.77-.9 4.22-2.48 4.22-.5 0-.93-.2-1.33-.42zM32.6 2.13c-1.64 0-2.96.55-3.9 1.74l-.18-1.5h-4.38v22.1h4.8V16.8c.65.57 1.6.92 2.7.92 3.4 0 5.8-3.13 5.8-7.84 0-4.4-2.36-7.75-4.84-7.75zm-.9 12.78c-.5 0-.93-.2-1.33-.42V8.5c.4-.3.83-.5 1.33-.5 1.63 0 2.48 1.4 2.48 4.1 0 2.77-.9 4.81-2.48 4.81zm-11.04 5.59h4.8V2.37h-4.8v18.13zM18.15.5c-1.54 0-2.48.93-2.48 2.4 0 1.43.94 2.36 2.48 2.36S20.63 4.33 20.63 2.9C20.63 1.43 19.69.5 18.15.5zM11.7 19.13c0 3.27-1.9 5.13-5.55 5.13-1.5 0-3.18-.4-4.24-.87v-3.7a9.78 9.78 0 004.12.97c1.3 0 2.22-.5 2.22-1.7 0-1.1-.94-1.57-2.68-2.18C2.87 16 .47 14.5.47 11.2c0-3.22 2.22-5.5 5.95-5.5 1.36 0 2.82.35 3.9.81v3.7a9.37 9.37 0 00-3.77-.83c-1.27 0-1.94.55-1.94 1.5 0 1.04.86 1.5 2.7 2.15 2.56.9 4.39 2.37 4.39 5.1z"/>
  </svg>`;
}

// ─── Copy to clipboard ────────────────────────────────────

function attachCopyBtn(btn, value) {
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      btn.classList.add('contract-copy-btn--copied');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'bi bi-check2';
      setTimeout(() => {
        btn.classList.remove('contract-copy-btn--copied');
        if (icon) icon.className = 'bi bi-clipboard';
      }, 1800);
    } catch (_) {}
  });
}

// ─── Modal de suivi ───────────────────────────────────────

let trackingPollingTimer = null;
let lastCheckTime = null;

function openTrackingModal() {
  if (document.getElementById('contract-tracking-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'contract-tracking-modal';
  overlay.className = 'contract-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Suivi d\'activation');
  overlay.innerHTML = `
    <div class="contract-modal-backdrop"></div>
    <div class="contract-modal-panel">
      <div class="contract-modal-header">
        <span class="contract-modal-title">
          <i class="bi bi-list-check" aria-hidden="true"></i>
          Suivi d'activation
        </span>
        <button class="contract-modal-close" id="ctm-close" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="contract-modal-body" id="ctm-body">
        <div class="contract-loader">
          <span class="contract-spinner">
            <i class="bi bi-arrow-clockwise contract-spinner-icon" aria-hidden="true"></i>
          </span>
        </div>
      </div>
      <div class="contract-modal-footer">
        <span class="contract-modal-last-check" id="ctm-last-check"></span>
        <button class="contract-btn-outline contract-btn-outline--sm" id="ctm-refresh-btn">
          <i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Vérifier maintenant
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function closeModal() {
    stopTrackingPolling();
    overlay.classList.remove('contract-modal-overlay--visible');
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 280);
  }

  overlay.querySelector('.contract-modal-backdrop').addEventListener('click', closeModal);
  overlay.querySelector('#ctm-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
  });

  overlay.querySelector('#ctm-refresh-btn').addEventListener('click', () => {
    loadTrackingSteps(overlay.querySelector('#ctm-body'));
  });

  requestAnimationFrame(() => overlay.classList.add('contract-modal-overlay--visible'));
  loadTrackingSteps(overlay.querySelector('#ctm-body'));
}

function openCancelImmediateModal(container) {
  if (document.getElementById('contract-cancel-immediate-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'contract-cancel-immediate-modal';
  overlay.className = 'contract-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Résiliation immédiate');
  overlay.innerHTML = `
    <div class="contract-modal-backdrop"></div>
    <div class="contract-modal-panel" style="max-width:420px;">
      <div class="contract-modal-header">
        <span class="contract-modal-title">
          <i class="bi bi-x-circle" aria-hidden="true" style="color:#dc2626"></i>
          Résilier immédiatement
          <span style="font-size:0.65rem;font-weight:700;background:rgba(220,38,38,0.12);
            color:#dc2626;border-radius:3px;padding:0 0.35rem;letter-spacing:0.04em;
            margin-left:0.4rem;vertical-align:middle;">DEV ONLY</span>
        </span>
        <button class="contract-modal-close" id="ccim-close" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="contract-modal-body">
        <p style="margin:0 0 1rem;">Cette action résilie immédiatement le contrat et annule l'abonnement Stripe. <strong>Action irréversible en dev.</strong></p>
        <p id="ccim-error" class="contract-feedback contract-feedback--error" style="display:none;margin-bottom:0.5rem;"></p>
      </div>
      <div class="contract-modal-footer" style="justify-content:flex-end;gap:0.5rem;">
        <button class="contract-btn-outline" id="ccim-cancel">Annuler</button>
        <button class="contract-btn-danger" id="ccim-confirm">
          <i class="bi bi-x-circle" aria-hidden="true"></i> Confirmer
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function closeModal() {
    overlay.classList.remove('contract-modal-overlay--visible');
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 280);
  }

  overlay.querySelector('.contract-modal-backdrop').addEventListener('click', closeModal);
  overlay.querySelector('#ccim-close').addEventListener('click', closeModal);
  overlay.querySelector('#ccim-cancel').addEventListener('click', closeModal);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); }
  });

  overlay.querySelector('#ccim-confirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#ccim-confirm');
    const errorEl = overlay.querySelector('#ccim-error');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="bi bi-arrow-clockwise contract-spinner-icon" aria-hidden="true"></i> Résiliation…';
    errorEl.style.display = 'none';
    try {
      const r = await fetch(API.cancelImmediate, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (r.ok && d.ok) {
        closeModal();
        await loadCurrentTab(container);
      } else {
        errorEl.textContent = d.error || 'Erreur lors de la résiliation.';
        errorEl.style.display = '';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="bi bi-x-circle" aria-hidden="true"></i> Confirmer';
      }
    } catch (_) {
      errorEl.textContent = 'Erreur réseau.';
      errorEl.style.display = '';
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="bi bi-x-circle" aria-hidden="true"></i> Confirmer';
    }
  });

  requestAnimationFrame(() => overlay.classList.add('contract-modal-overlay--visible'));
}

function stopTrackingPolling() {
  if (trackingPollingTimer) {
    clearInterval(trackingPollingTimer);
    trackingPollingTimer = null;
  }
}

function updateLastCheckDisplay() {
  const el = document.getElementById('ctm-last-check');
  if (!el || !lastCheckTime) return;
  const s = Math.floor((Date.now() - lastCheckTime) / 1000);
  el.textContent = s < 5 ? 'Vérification à l\'instant' : `Dernière vérif. : il y a ${s}s`;
}

async function loadTrackingSteps(bodyEl) {
  try {
    const r = await fetch(API.checkPaymentStatus, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur');
    lastCheckTime = Date.now();
    renderTrackingSteps(bodyEl, d.steps, d.contractStatus);
    updateLastCheckDisplay();

    const isPending = d.contractStatus === 'pending' && !d.steps?.contractActive;
    if (isPending && !trackingPollingTimer) {
      trackingPollingTimer = setInterval(async () => {
        if (!document.getElementById('contract-tracking-modal')) { stopTrackingPolling(); return; }
        try {
          const r2 = await fetch(API.checkPaymentStatus, { credentials: 'include' });
          const d2 = await r2.json();
          if (r2.ok) {
            lastCheckTime = Date.now();
            updateLastCheckDisplay();
            renderTrackingSteps(bodyEl, d2.steps, d2.contractStatus);
            if (d2.steps?.contractActive || d2.contractStatus === 'active') stopTrackingPolling();
          }
        } catch (_) {}
      }, 10000);
    }
  } catch (err) {
    bodyEl.innerHTML = `<p class="contract-modal-error"><i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}</p>`;
  }
}

function renderTrackingSteps(bodyEl, steps, contractStatus) {
  const def = [
    { key: 'adminConnected',   icon: 'bi-person-check',        label: 'Connexion administrateur',      alwaysShow: true },
    { key: 'fileDownloaded',   icon: 'bi-file-earmark-check',  label: 'Téléchargement du contrat',     alwaysShow: true },
    { key: 'contractAccepted', icon: 'bi-pen-check',           label: 'Contrat accepté',               alwaysShow: true },
    { key: 'launchFeePaid',    icon: 'bi-credit-card',         label: 'Frais de lancement payés',      condition: () => steps?.launchFeeRequired },
    { key: 'monthlyActive',    icon: 'bi-calendar2-check',     label: 'Souscription à la maintenance', condition: () => steps?.monthlyRequired },
    { key: 'contractActive',   icon: 'bi-check-circle-fill',   label: 'Contrat activé',                alwaysShow: true }
  ];

  const visible = def.filter(s => s.alwaysShow || (s.condition && s.condition()));

  bodyEl.innerHTML = visible.map(s => {
    const done = steps?.[s.key] === true;
    const isLast = s.key === 'contractActive';
    const isWaiting = !done && !isLast;
    const cls = done ? 'contract-step--done' : isWaiting ? 'contract-step--waiting' : 'contract-step--pending';
    return `
      <div class="contract-step ${cls}" data-key="${esc(s.key)}">
        <span class="contract-step__icon-wrap">
          <i class="bi ${esc(s.icon)}" aria-hidden="true"></i>
        </span>
        <span class="contract-step__label">${esc(s.label)}</span>
        ${isWaiting ? `<span class="contract-step__spinner"><i class="bi bi-arrow-clockwise contract-step-spin" aria-hidden="true"></i></span>` : ''}
      </div>
    `;
  }).join('') + `
    <p class="contract-modal-status-note">
      ${contractStatus === 'active'
        ? `<i class="bi bi-check-circle-fill" style="color:var(--color-success,#1f7a3a)"></i> Contrat actif — tout est en place.`
        : `<i class="bi bi-clock"></i> Vérification automatique toutes les 10 secondes…`}
    </p>
  `;
}

// ─── Main init ────────────────────────────────────────────

export async function init(container) {
  container.innerHTML = `
    <div class="contract-module">
      <div class="contract-tabs" id="contract-tabs">
        <button class="contract-tab contract-tab--active" data-tab="current">Contrat en cours</button>
        <button class="contract-tab" data-tab="history">Historique</button>
      </div>
      <div id="contract-tab-current" class="contract-tab-content"></div>
      <div id="contract-tab-history" class="contract-tab-content" hidden></div>
    </div>
  `;
  setupTabs(container);
  await loadCurrentTab(container);
}

function setupTabs(container) {
  container.querySelectorAll('.contract-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.contract-tab').forEach(b => b.classList.remove('contract-tab--active'));
      btn.classList.add('contract-tab--active');
      const tab = btn.dataset.tab;
      container.querySelectorAll('.contract-tab-content').forEach(el => { el.hidden = true; });
      const target = container.querySelector(`#contract-tab-${tab}`);
      if (target) target.hidden = false;
      if (tab === 'history') await loadHistoryTab(container);
    });
  });
}

// ─── Onglet courant ───────────────────────────────────────

async function loadCurrentTab(container) {
  const el = container.querySelector('#contract-tab-current');
  el.innerHTML = `
    <div class="contract-loader" style="min-height:200px">
      <span class="contract-spinner"><i class="bi bi-arrow-clockwise contract-spinner-icon"></i></span>
    </div>`;
  try {
    const r = await fetch(API.active, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur de chargement');
    if (!d.contract) {
      await renderCreationForm(el, container);
    } else {
      renderCurrentContract(el, d.contract, container);
    }
  } catch (err) {
    el.innerHTML = `<p class="contract-error-msg"><i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}</p>`;
  }
}

// ─── Vue contrat existant — 5 cards ──────────────────────

function renderCurrentContract(el, contract, container) {
  const iconClass = fileIcon(contract.fileMimeType, contract.fileOriginalName);
  const hasStripe = contract.monthlyFee?.stripeSubscriptionId || contract.launchFee?.stripePaymentIntentId || contract.monthlyFee?.stripeCustomerId;
  const fileDownloaded = Boolean(contract.fileDownloadedAt);
  const isLocked = Boolean(contract.lockedAt);
  const id = String(contract._id || '');
  const statusMap = {
    active:    { cls: 'active',    icon: 'bi-check-circle-fill', label: 'Actif' },
    pending:   { cls: 'pending',   icon: 'bi-hourglass-split',   label: 'En attente' },
    cancelled: { cls: 'cancelled', icon: 'bi-x-circle-fill',     label: 'Résilié' }
  };
  const st = statusMap[contract.status] || statusMap.cancelled;

  el.innerHTML = `
    <div class="contract-cards">

      <!-- Card 1 · Statut général -->
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            <i class="bi bi-shield-check" aria-hidden="true"></i> Statut général
          </span>
        </div>
        <div class="contract-card__body">
          <div class="contract-status-row">
            <span class="contract-badge contract-badge--${esc(st.cls)}">
              <i class="bi ${esc(st.icon)}" aria-hidden="true"></i> ${esc(st.label)}
            </span>
            ${contract.activatedAt
              ? `<span class="contract-since"><i class="bi bi-calendar3" aria-hidden="true"></i> Actif depuis ${esc(activeSince(contract.activatedAt))}</span>`
              : ''}
          </div>
          <div class="contract-id-row">
            <code class="contract-mono">${esc(id)}</code>
            <button class="contract-copy-btn" id="contract-copy-id" title="Copier l'ID">
              <i class="bi bi-clipboard" aria-hidden="true"></i>
            </button>
          </div>
          ${contract.activatedBy?.email
            ? `<p class="contract-muted"><i class="bi bi-person-check" aria-hidden="true"></i> Activé par ${esc(contract.activatedBy.email)}</p>`
            : ''}
          <div>
            <button class="contract-btn-outline" id="contract-tracking-btn">
              <i class="bi bi-list-check" aria-hidden="true"></i> Afficher le suivi
            </button>
          </div>
          ${contract.isDev ? `
          <div style="margin-top:0.75rem;">
            <button class="contract-btn-danger contract-btn-danger--sm" id="contract-cancel-immediate-btn"
              style="font-size:0.78rem;padding:0.3rem 0.75rem;opacity:0.75;">
              <i class="bi bi-x-circle" aria-hidden="true"></i> Résilier immédiatement
              <span style="display:inline-block;margin-left:0.4rem;font-size:0.65rem;font-weight:700;
                background:rgba(220,38,38,0.15);color:#dc2626;border-radius:3px;
                padding:0 0.3rem;letter-spacing:0.04em;vertical-align:middle;">DEV ONLY</span>
            </button>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Card 2 · Fichier contractuel -->
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            <i class="bi bi-file-earmark" aria-hidden="true"></i> Fichier contractuel
          </span>
          ${isLocked
            ? `<span class="contract-badge contract-badge--locked"><i class="bi bi-lock-fill" aria-hidden="true"></i> Verrouillé</span>`
            : ''}
        </div>
        <div class="contract-card__body">
          <div class="contract-file-row">
            <i class="bi ${esc(iconClass)} contract-file-icon" aria-hidden="true"></i>
            <div class="contract-file-info">
              <strong>${esc(contract.fileOriginalName || 'contrat.pdf')}</strong>
              <span class="contract-muted">Ajouté le ${formatDate(contract.createdAt)}</span>
              ${fileDownloaded
                ? `<span class="contract-muted"><i class="bi bi-download" aria-hidden="true"></i> Téléchargé le ${formatDateTime(contract.fileDownloadedAt)}</span>`
                : ''}
            </div>
          </div>
          <div>
            <a class="contract-btn-primary" href="#" id="contract-download-link">
              <i class="bi bi-download" aria-hidden="true"></i> Télécharger
            </a>
          </div>
        </div>
      </div>

      <!-- Card 3 · Facturation -->
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            <i class="bi bi-receipt" aria-hidden="true"></i> Facturation
          </span>
        </div>
        <div class="contract-card__body">
          <div class="contract-billing-row">
            <span class="contract-billing-label">Frais de lancement HT</span>
            <span class="contract-billing-value">
              ${esc(formatEur(contract.launchFee?.amount || 0))}
              <button class="contract-tooltip-btn"
                data-tooltip="TVA ${((contract.launchFee?.taxRate || 0) * 100).toFixed(0)}% — TTC : ${formatEur((contract.launchFee?.amount || 0) * (1 + (contract.launchFee?.taxRate || 0)))}"
                aria-label="Info TVA frais de lancement">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
              </button>
            </span>
          </div>
          <div class="contract-billing-row">
            <span class="contract-billing-label">Mensualité HT</span>
            <span class="contract-billing-value">
              ${esc(formatEur(contract.monthlyFee?.amount || 0))}
              <span class="contract-billing-unit">/ mois</span>
              <button class="contract-tooltip-btn"
                data-tooltip="TVA ${((contract.monthlyFee?.taxRate || 0) * 100).toFixed(0)}% — TTC : ${formatEur((contract.monthlyFee?.amount || 0) * (1 + (contract.monthlyFee?.taxRate || 0)))}"
                aria-label="Info TVA mensualité">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
              </button>
            </span>
          </div>
          <div class="contract-billing-row">
            <span class="contract-billing-label">Politique résiliation</span>
            <span class="contract-billing-value">
              ${contract.cancellationPolicy?.type === 'locked'
                ? `<span class="contract-badge contract-badge--pending">Engagé ${contract.cancellationPolicy.lockedMonths || 0} mois</span>`
                : '<span class="contract-badge contract-badge--active">Anytime</span>'}
            </span>
          </div>
          <div class="contract-grace-row">
            <label class="contract-billing-label" for="contract-grace-input">Délai de grâce</label>
            <div class="contract-stepper">
              <button class="contract-stepper__btn" id="contract-grace-minus" type="button" aria-label="Diminuer">
                <i class="bi bi-dash" aria-hidden="true"></i>
              </button>
              <input type="number" id="contract-grace-input" class="contract-stepper__input"
                min="0" max="30" value="${Number(contract.monthlyFee?.gracePeriodDays ?? 3)}">
              <button class="contract-stepper__btn" id="contract-grace-plus" type="button" aria-label="Augmenter">
                <i class="bi bi-plus" aria-hidden="true"></i>
              </button>
            </div>
            <span class="contract-billing-unit">jours</span>
            <button class="contract-btn-outline contract-btn-outline--sm" id="contract-save-grace"
              data-id="${esc(id)}">Enregistrer</button>
            <span class="contract-feedback" id="contract-grace-feedback"></span>
          </div>
        </div>
      </div>

      <!-- Card 4 · Commissions -->
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            <i class="bi bi-percent" aria-hidden="true"></i> Commissions
          </span>
          <span class="contract-badge contract-badge--locked" style="font-size:0.72rem">
            <i class="bi bi-lock-fill" aria-hidden="true"></i> Lecture seule
          </span>
        </div>
        <div class="contract-card__body">
          <div class="contract-billing-row">
            <span class="contract-billing-label">Type</span>
            <span class="contract-billing-value">
              ${!contract.commissions?.type ? '—'
                : contract.commissions.type === 'percentage' ? 'Pourcentage'
                : 'Fixe'}
            </span>
          </div>
          <div class="contract-billing-row">
            <span class="contract-billing-label">Valeur</span>
            <span class="contract-billing-value">${esc(commissionLabel(contract.commissions))}</span>
          </div>
          <p class="contract-muted" style="font-size:0.78rem;margin-top:0.5rem">
            <i class="bi bi-info-circle" aria-hidden="true"></i>
            Défini à la création du contrat — non modifiable.
          </p>
        </div>
      </div>

      <!-- Card 6 · Message page d'attente -->
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            <i class="bi bi-chat-text" aria-hidden="true"></i> Message page d'attente
          </span>
        </div>
        <div class="contract-card__body">
          <textarea id="contract-pending-msg" class="contract-textarea" rows="3"
            placeholder="Message affiché sur la vitrine pendant la phase d'attente…"
          >${esc(contract.pendingMessage || '')}</textarea>
          <div class="contract-message-preview" id="contract-msg-preview">${esc(contract.pendingMessage || '')}</div>
          <div class="contract-card__actions">
            <button class="contract-btn-outline" id="contract-save-msg" data-id="${esc(id)}">
              <i class="bi bi-floppy" aria-hidden="true"></i> Enregistrer le message
            </button>
            <span class="contract-feedback" id="contract-msg-feedback"></span>
          </div>
        </div>
      </div>

      <!-- Card 7 · Stripe Developer (collapsible) -->
      ${hasStripe ? `
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title">
            ${stripeSvg()} Données Stripe Developer
          </span>
          <button class="contract-btn-outline contract-btn-outline--sm" id="contract-stripe-toggle" aria-expanded="false">
            Consulter
          </button>
        </div>
        <div class="contract-stripe-collapse" id="contract-stripe-panel" hidden>
          <div class="contract-stripe-panel">
            ${contract.launchFee?.stripePaymentIntentId ? renderStripeRow('PaymentIntent (lancement)', contract.launchFee.stripePaymentIntentId) : ''}
            ${contract.monthlyFee?.stripeSubscriptionId ? renderStripeRow('Subscription', contract.monthlyFee.stripeSubscriptionId) : ''}
            ${contract.monthlyFee?.stripeCustomerId ? renderStripeRow('Customer', contract.monthlyFee.stripeCustomerId) : ''}
          </div>
        </div>
      </div>` : ''}

      <!-- Zone suppression (non-active uniquement) -->
      ${contract.status !== 'active' ? `
      <div class="contract-card contract-card--danger">
        <div class="contract-card__header">
          <span class="contract-card__title contract-card__title--danger">
            <i class="bi bi-trash3" aria-hidden="true"></i> Zone de suppression
          </span>
        </div>
        <div class="contract-card__body">
          ${fileDownloaded || isLocked
            ? `<p class="contract-warning"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> Contrat consulté ou verrouillé — double confirmation requise.</p>`
            : ''}
          <div>
            <button class="contract-btn-danger" id="contract-delete-btn"
              data-id="${esc(id)}"
              data-file-downloaded="${fileDownloaded}"
              data-locked="${isLocked}">
              <i class="bi bi-trash3" aria-hidden="true"></i> Supprimer le contrat
            </button>
          </div>
          <span class="contract-feedback" id="contract-delete-feedback"></span>
        </div>
      </div>` : ''}

    </div>
  `;

  // — Copie ID
  attachCopyBtn(el.querySelector('#contract-copy-id'), id);

  // — Bouton suivi
  el.querySelector('#contract-tracking-btn')?.addEventListener('click', openTrackingModal);

  // — Résiliation immédiate (dev only)
  el.querySelector('#contract-cancel-immediate-btn')?.addEventListener('click', () => {
    openCancelImmediateModal(container);
  });

  // — Téléchargement fichier
  el.querySelector('#contract-download-link')?.addEventListener('click', async e => {
    e.preventDefault();
    try {
      const r = await fetch('/api/contract/download-file', { method: 'POST', credentials: 'include' });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('content-disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      a.download = m ? m[1] : (contract.fileOriginalName || 'contrat.pdf');
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (_) {}
  });

  // — Tooltips TVA
  el.querySelectorAll('.contract-tooltip-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const existing = btn.querySelector('.contract-tooltip-popup');
      if (existing) { existing.remove(); return; }
      const popup = document.createElement('span');
      popup.className = 'contract-tooltip-popup';
      popup.textContent = btn.dataset.tooltip || '';
      btn.appendChild(popup);
      setTimeout(() => popup.remove(), 3200);
    });
  });

  // — Stripe panel toggle
  const stripeToggle = el.querySelector('#contract-stripe-toggle');
  const stripePanel = el.querySelector('#contract-stripe-panel');
  if (stripeToggle && stripePanel) {
    stripeToggle.addEventListener('click', () => {
      const wasHidden = stripePanel.hidden;
      stripePanel.hidden = !wasHidden;
      stripeToggle.setAttribute('aria-expanded', String(wasHidden));
      stripeToggle.textContent = wasHidden ? 'Masquer' : 'Consulter';
    });
    stripePanel.querySelectorAll('.contract-copy-btn[data-value]').forEach(btn => {
      attachCopyBtn(btn, btn.dataset.value);
    });
  }

  // — Grace period stepper
  const graceInput = el.querySelector('#contract-grace-input');
  el.querySelector('#contract-grace-minus')?.addEventListener('click', () => {
    if (Number(graceInput.value) > 0) graceInput.value = Number(graceInput.value) - 1;
  });
  el.querySelector('#contract-grace-plus')?.addEventListener('click', () => {
    if (Number(graceInput.value) < 30) graceInput.value = Number(graceInput.value) + 1;
  });

  el.querySelector('#contract-save-grace')?.addEventListener('click', async () => {
    const btn = el.querySelector('#contract-save-grace');
    const fb = el.querySelector('#contract-grace-feedback');
    btn.disabled = true;
    fb.textContent = 'Enregistrement…';
    fb.className = 'contract-feedback';
    try {
      const r = await fetch(API.gracePeriod(btn.dataset.id), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gracePeriodDays: Number(graceInput.value) })
      });
      const d = await r.json();
      fb.textContent = r.ok ? 'Enregistré !' : (d.error || 'Erreur.');
      fb.className = `contract-feedback ${r.ok ? 'contract-feedback--success' : 'contract-feedback--error'}`;
    } catch (_) {
      fb.textContent = 'Erreur réseau.';
      fb.className = 'contract-feedback contract-feedback--error';
    } finally {
      btn.disabled = false;
      setTimeout(() => { fb.textContent = ''; fb.className = 'contract-feedback'; }, 3000);
    }
  });

  // — Message preview + save
  const msgInput = el.querySelector('#contract-pending-msg');
  const msgPreview = el.querySelector('#contract-msg-preview');
  msgInput?.addEventListener('input', () => {
    if (msgPreview) msgPreview.textContent = msgInput.value;
  });

  el.querySelector('#contract-save-msg')?.addEventListener('click', async () => {
    const btn = el.querySelector('#contract-save-msg');
    const fb = el.querySelector('#contract-msg-feedback');
    btn.disabled = true;
    fb.textContent = 'Enregistrement…';
    fb.className = 'contract-feedback';
    try {
      const r = await fetch(API.pendingMessage(btn.dataset.id), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingMessage: msgInput?.value ?? '' })
      });
      const d = await r.json();
      fb.textContent = r.ok ? 'Enregistré !' : (d.error || 'Erreur.');
      fb.className = `contract-feedback ${r.ok ? 'contract-feedback--success' : 'contract-feedback--error'}`;
    } catch (_) {
      fb.textContent = 'Erreur réseau.';
      fb.className = 'contract-feedback contract-feedback--error';
    } finally {
      btn.disabled = false;
      setTimeout(() => { fb.textContent = ''; fb.className = 'contract-feedback'; }, 3000);
    }
  });

  // — Suppression
  el.querySelector('#contract-delete-btn')?.addEventListener('click', async () => {
    const btn = el.querySelector('#contract-delete-btn');
    const fb = el.querySelector('#contract-delete-feedback');
    const requiresDouble = btn.dataset.fileDownloaded === 'true' || btn.dataset.locked === 'true';
    if (!confirm('Supprimer définitivement ce contrat ?')) return;
    if (requiresDouble && !confirm('Ce contrat a été consulté ou verrouillé. Confirmer une seconde fois ?')) return;
    btn.disabled = true;
    fb.textContent = 'Suppression…';
    fb.className = 'contract-feedback';
    try {
      const r = await fetch(API.deleteContract(btn.dataset.id), {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: requiresDouble })
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        await loadCurrentTab(container);
      } else {
        fb.textContent = d.error || 'Erreur lors de la suppression.';
        fb.className = 'contract-feedback contract-feedback--error';
        btn.disabled = false;
      }
    } catch (_) {
      fb.textContent = 'Erreur réseau.';
      fb.className = 'contract-feedback contract-feedback--error';
      btn.disabled = false;
    }
  });
}

function commissionLabel(commissions) {
  if (!commissions?.type) return 'Non renseigné';
  const v = Number(commissions.value ?? 0);
  if (commissions.type === 'percentage') {
    return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}% par vente`;
  }
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € par vente`;
}

function renderStripeRow(label, value) {
  return `
    <div class="contract-stripe-id-row">
      <span class="contract-stripe-id-label">${esc(label)}</span>
      <div class="contract-stripe-id-value">
        <code class="contract-mono contract-mono--sm">${esc(value)}</code>
        <button class="contract-copy-btn" data-value="${esc(value)}" title="Copier">
          <i class="bi bi-clipboard" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

// ─── Formulaire de création ───────────────────────────────

async function renderCreationForm(el, container) {
  // Tenter de récupérer la config de commission active
  let activeCommissionConfig = null;
  try {
    const rc = await fetch('/api/gestion/commissions/config/history', { credentials: 'include' });
    const dc = await rc.json();
    if (rc.ok && dc.configs?.length) activeCommissionConfig = dc.configs[0];
  } catch (_) {}

  // Pré-remplir si config disponible
  const commTypeReadonly = activeCommissionConfig?.type || null;
  const commValueReadonly = activeCommissionConfig != null ? activeCommissionConfig.value : null;
  const commissionBlockHtml = commTypeReadonly
    ? `
        <div class="contract-form-group">
          <label class="contract-form-label">
            <i class="bi bi-percent" aria-hidden="true"></i> Commission prestataire
            <span class="contract-badge contract-badge--info" style="margin-left:.4rem;font-size:.72rem;vertical-align:middle">À titre informatif</span>
          </label>
          <div class="contract-commission-readonly">
            <i class="bi bi-lock" aria-hidden="true" style="color:var(--color-muted)"></i>
            <span style="color:var(--color-muted);font-size:.85rem">
              ${commTypeReadonly === 'percentage'
                ? `${commValueReadonly}% (pourcentage)`
                : `${Number(commValueReadonly).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} fixe`}
            </span>
            <span style="font-size:.75rem;color:var(--color-muted)">(repris depuis la configuration active)</span>
          </div>
          <input type="hidden" id="contract-comm-type" value="${esc(commTypeReadonly)}">
          <input type="hidden" id="contract-comm-value" value="${esc(String(commValueReadonly ?? '0'))}">
        </div>`
    : `
        <div class="contract-form-group">
          <label class="contract-form-label">
            <i class="bi bi-percent" aria-hidden="true"></i> Commission prestataire
            <span class="contract-badge contract-badge--info" style="margin-left:.4rem;font-size:.72rem;vertical-align:middle">À titre informatif</span>
          </label>
          <div class="contract-commission-switch" id="contract-comm-switch">
            <button type="button" class="contract-policy-switch__option contract-policy-switch__option--active"
              data-comm-type="percentage" aria-pressed="true">Pourcentage</button>
            <button type="button" class="contract-policy-switch__option"
              data-comm-type="fixed" aria-pressed="false">Fixe</button>
          </div>
          <div class="contract-stepper" style="margin-top:.5rem">
            <button class="contract-stepper__btn" id="contract-comm-minus" type="button">
              <i class="bi bi-dash"></i>
            </button>
            <input type="number" id="contract-comm-value" class="contract-stepper__input"
              min="0" step="0.01" value="0">
            <button class="contract-stepper__btn" id="contract-comm-plus" type="button">
              <i class="bi bi-plus"></i>
            </button>
            <span class="contract-muted" id="contract-comm-unit">%</span>
          </div>
          <input type="hidden" id="contract-comm-type" value="percentage">
        </div>`;

  // Injection dans la variable 'el' après la section dropzone + montants
  el.innerHTML = `
    <div class="contract-cards">
      <div class="contract-card">
        <div class="contract-card__header">
          <span class="contract-card__title contract-card__title--lg">
            <i class="bi bi-file-earmark-plus" aria-hidden="true"></i> Nouveau contrat
          </span>
        </div>
        <div class="contract-card__body">
          <p class="contract-muted">Aucun contrat actif ou en attente. Configurez un nouveau contrat ci-dessous.</p>

          <!-- Dropzone -->
          <div class="contract-dropzone" id="contract-dz" role="button" tabindex="0"
            aria-label="Zone de dépôt de fichier contrat">
            <i class="bi bi-cloud-upload" aria-hidden="true"
              style="font-size:3rem;color:var(--theme-accent,var(--color-primary,#5f4ff7));opacity:0.35"></i>
            <p class="contract-dropzone__text">Déposez votre fichier contrat ici — PDF ou Word</p>
            <p class="contract-dropzone__sub">Max 12 Mo</p>
            <input type="file" id="contract-file-input" accept=".pdf,.doc,.docx" hidden aria-hidden="true">
          </div>
          <div class="contract-file-status" id="contract-file-status"></div>

          <!-- Montants (grille 2 colonnes) -->
          <div class="contract-form-grid">
            <div class="contract-form-group">
              <label class="contract-form-label" for="contract-launch-amount">Frais de lancement HT (€)</label>
              <div class="contract-stepper">
                <button class="contract-stepper__btn" id="contract-launch-minus" type="button">
                  <i class="bi bi-dash"></i>
                </button>
                <input type="number" id="contract-launch-amount" class="contract-stepper__input"
                  min="0" step="1" value="0">
                <button class="contract-stepper__btn" id="contract-launch-plus" type="button">
                  <i class="bi bi-plus"></i>
                </button>
              </div>
            </div>
            <div class="contract-form-group">
              <label class="contract-form-label" for="contract-launch-tax">TVA lancement (%)</label>
              <input type="number" id="contract-launch-tax" class="contract-form-input"
                min="0" max="100" step="1" value="20">
            </div>
            <div class="contract-form-group">
              <label class="contract-form-label" for="contract-monthly-amount">Mensualité HT (€)</label>
              <div class="contract-stepper">
                <button class="contract-stepper__btn" id="contract-monthly-minus" type="button">
                  <i class="bi bi-dash"></i>
                </button>
                <input type="number" id="contract-monthly-amount" class="contract-stepper__input"
                  min="0" step="1" value="0">
                <button class="contract-stepper__btn" id="contract-monthly-plus" type="button">
                  <i class="bi bi-plus"></i>
                </button>
              </div>
            </div>
            <div class="contract-form-group">
              <label class="contract-form-label" for="contract-monthly-tax">TVA mensualité (%)</label>
              <input type="number" id="contract-monthly-tax" class="contract-form-input"
                min="0" max="100" step="1" value="20">
            </div>
          </div>

          <!-- Délai de grâce + Politique résiliation -->
          <div class="contract-form-grid">
            <div class="contract-form-group">
              <label class="contract-form-label" for="contract-grace-create">Délai de grâce (jours)</label>
              <div class="contract-stepper">
                <button class="contract-stepper__btn" id="contract-grace-c-minus" type="button">
                  <i class="bi bi-dash"></i>
                </button>
                <input type="number" id="contract-grace-create" class="contract-stepper__input"
                  min="0" max="30" value="3">
                <button class="contract-stepper__btn" id="contract-grace-c-plus" type="button">
                  <i class="bi bi-plus"></i>
                </button>
              </div>
            </div>
            <div class="contract-form-group">
              <label class="contract-form-label">Politique de résiliation</label>
              <!-- Switch custom JS -->
              <div class="contract-policy-switch" id="contract-policy-switch"
                role="group" aria-label="Politique de résiliation">
                <div class="contract-policy-switch__thumb" aria-hidden="true"></div>
                <button type="button" class="contract-policy-switch__option contract-policy-switch__option--active"
                  data-policy="anytime" aria-pressed="true">
                  Résiliable à tout moment
                </button>
                <button type="button" class="contract-policy-switch__option"
                  data-policy="locked" aria-pressed="false">
                  Engagement minimum
                </button>
              </div>
              <!-- Compteur durée engagement (animé) -->
              <div class="contract-locked-counter" id="contract-locked-wrap">
                <div class="contract-stepper" style="max-width:130px">
                  <button class="contract-stepper__btn" id="contract-locked-minus" type="button">
                    <i class="bi bi-dash"></i>
                  </button>
                  <input type="number" id="contract-locked-months" class="contract-stepper__input"
                    min="1" max="60" value="12">
                  <button class="contract-stepper__btn" id="contract-locked-plus" type="button">
                    <i class="bi bi-plus"></i>
                  </button>
                </div>
                <span class="contract-muted">mois</span>
              </div>
            </div>
          </div>

          <!-- Commission prestataire -->
          <div id="contract-comm-block"></div>

          <!-- Message d'attente -->
          <div class="contract-form-group">
            <label class="contract-form-label" for="contract-msg-create">Message page d'attente</label>
            <textarea id="contract-msg-create" class="contract-textarea" rows="2"
            >Site en cours de configuration. Revenez bientôt.</textarea>
          </div>

          <div class="contract-error-msg" id="contract-create-error"></div>

          <div>
            <button class="contract-btn-primary" id="contract-create-btn" disabled>
              <i class="bi bi-plus-circle" aria-hidden="true"></i> Créer le contrat
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Injection du bloc commission ──────────────────────
  el.querySelector('#contract-comm-block').innerHTML = commissionBlockHtml;

  // Wiring du switch de type commission (si éditable)
  let selectedCommType = commTypeReadonly || 'percentage';
  const commSwitch = el.querySelector('#contract-comm-switch');
  if (commSwitch) {
    commSwitch.querySelectorAll('.contract-policy-switch__option').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCommType = btn.dataset.commType;
        commSwitch.querySelectorAll('.contract-policy-switch__option').forEach(b => {
          b.classList.toggle('contract-policy-switch__option--active', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        el.querySelector('#contract-comm-type').value = selectedCommType;
        const unit = el.querySelector('#contract-comm-unit');
        if (unit) unit.textContent = selectedCommType === 'percentage' ? '%' : '€';
      });
    });
    stepper('contract-comm-minus', 'contract-comm-plus', 'contract-comm-value', 0, 99999);
  }

  const dropzone   = el.querySelector('#contract-dz');
  const fileStatus = el.querySelector('#contract-file-status');
  const createBtn  = el.querySelector('#contract-create-btn');
  const errorEl    = el.querySelector('#contract-create-error');

  // ── Dropzone state machine ─────────────────────────────
  let tempFileId = null;
  let tempOriginalName = null;

  function setDzEmpty() {
    tempFileId = null;
    tempOriginalName = null;
    dropzone.className = 'contract-dropzone';
    dropzone.innerHTML = `
      <i class="bi bi-cloud-upload" aria-hidden="true"
        style="font-size:3rem;color:var(--theme-accent,var(--color-primary,#5f4ff7));opacity:0.35"></i>
      <p class="contract-dropzone__text">Déposez votre fichier contrat ici — PDF ou Word</p>
      <p class="contract-dropzone__sub">Max 12 Mo</p>
      <input type="file" id="contract-file-input" accept=".pdf,.doc,.docx" hidden aria-hidden="true">
    `;
    createBtn.disabled = true;
    el.querySelector('#contract-file-input')?.addEventListener('change', function () {
      if (this.files?.[0]) handleFile(this.files[0]);
    });
  }

  function setDzUploading() {
    dropzone.className = 'contract-dropzone contract-dropzone--uploading';
    dropzone.innerHTML = `
      <div class="contract-dz-upload-wrap" aria-hidden="true">
        <i class="bi bi-file-earmark contract-dz-upload-icon"></i>
        <div class="contract-dz-spinner-ring"></div>
      </div>
      <p class="contract-dropzone__text">Upload en cours…</p>
    `;
    createBtn.disabled = true;
  }

  function setDzReady(file, id) {
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    const icon = ext === 'pdf' ? 'bi-file-earmark-pdf' : 'bi-file-earmark-word';
    tempFileId = id;
    tempOriginalName = file.name;

    dropzone.className = 'contract-dropzone contract-dropzone--ready';
    dropzone.innerHTML = `
      <i class="bi ${icon} contract-dz-ready-icon" aria-hidden="true"></i>
      <p class="contract-dropzone__filename">${esc(file.name)}</p>
      <div class="contract-dz-actions">
        <button type="button" class="contract-btn-outline contract-btn-outline--sm" id="contract-dz-replace">
          <i class="bi bi-arrow-repeat" aria-hidden="true"></i> Remplacer
        </button>
        <button type="button" class="contract-btn-danger" id="contract-dz-delete"
          style="padding:0.28rem 0.7rem;font-size:0.78rem">
          <i class="bi bi-trash" aria-hidden="true"></i> Supprimer
        </button>
      </div>
      <input type="file" id="contract-file-input" accept=".pdf,.doc,.docx" hidden aria-hidden="true">
    `;
    createBtn.disabled = false;

    dropzone.querySelector('#contract-dz-replace').addEventListener('click', e => {
      e.stopPropagation();
      dropzone.querySelector('#contract-file-input').click();
    });

    dropzone.querySelector('#contract-dz-delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (tempFileId) {
        await fetch(`/api/contract/upload-temp/${encodeURIComponent(tempFileId)}`, {
          method: 'DELETE', credentials: 'include'
        }).catch(() => {});
      }
      fileStatus.textContent = '';
      fileStatus.className = 'contract-file-status';
      setDzEmpty();
    });

    dropzone.querySelector('#contract-file-input').addEventListener('change', async function () {
      const newFile = this.files?.[0];
      if (!newFile) return;
      const oldId = tempFileId;
      if (!validateFileType(newFile)) return;
      setDzUploading();
      try {
        const id = await uploadTemp(newFile);
        if (oldId) fetch(`/api/contract/upload-temp/${encodeURIComponent(oldId)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
        fileStatus.textContent = '';
        setDzReady(newFile, id);
      } catch (err) {
        fileStatus.textContent = err.message || 'Erreur d\'upload.';
        fileStatus.className = 'contract-file-status contract-file-status--error';
        setDzEmpty();
      }
    });
  }

  function validateFileType(file) {
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !['pdf', 'doc', 'docx'].includes(ext)) {
      fileStatus.textContent = 'Seuls les fichiers PDF et Word sont acceptés.';
      fileStatus.className = 'contract-file-status contract-file-status--error';
      return false;
    }
    return true;
  }

  async function uploadTemp(file) {
    const fd = new FormData();
    fd.append('contractFile', file);
    const r = await fetch('/api/contract/upload-temp', { method: 'POST', credentials: 'include', body: fd });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'Erreur d\'upload.');
    return d.tempFileId;
  }

  async function handleFile(file) {
    if (!validateFileType(file)) return;
    fileStatus.textContent = '';
    fileStatus.className = 'contract-file-status';
    setDzUploading();
    try {
      const id = await uploadTemp(file);
      setDzReady(file, id);
    } catch (err) {
      fileStatus.textContent = err.message || 'Erreur lors de l\'upload.';
      fileStatus.className = 'contract-file-status contract-file-status--error';
      setDzEmpty();
    }
  }

  // Persistent drag/drop/click listeners (survivent aux innerHTML replacements)
  dropzone.addEventListener('click', () => {
    if (dropzone.classList.contains('contract-dropzone--ready') ||
        dropzone.classList.contains('contract-dropzone--uploading')) return;
    el.querySelector('#contract-file-input')?.click();
  });
  dropzone.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') &&
        !dropzone.classList.contains('contract-dropzone--ready') &&
        !dropzone.classList.contains('contract-dropzone--uploading')) {
      el.querySelector('#contract-file-input')?.click();
    }
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dropzone.classList.contains('contract-dropzone--ready') &&
        !dropzone.classList.contains('contract-dropzone--uploading')) {
      dropzone.classList.add('contract-dropzone--dragover');
    }
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('contract-dropzone--dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('contract-dropzone--dragover');
    if (dropzone.classList.contains('contract-dropzone--ready') ||
        dropzone.classList.contains('contract-dropzone--uploading')) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  // Initial file input listener
  el.querySelector('#contract-file-input')?.addEventListener('change', function () {
    if (this.files?.[0]) handleFile(this.files[0]);
  });

  // ── Steppers génériques ────────────────────────────────
  function stepper(minusId, plusId, inputId, min, max) {
    const input = el.querySelector(`#${inputId}`);
    if (!input) return;
    el.querySelector(`#${minusId}`)?.addEventListener('click', () => {
      if (Number(input.value) > min) input.value = Number(input.value) - 1;
    });
    el.querySelector(`#${plusId}`)?.addEventListener('click', () => {
      if (Number(input.value) < max) input.value = Number(input.value) + 1;
    });
  }
  stepper('contract-launch-minus',  'contract-launch-plus',  'contract-launch-amount',  0, 99999);
  stepper('contract-monthly-minus', 'contract-monthly-plus', 'contract-monthly-amount', 0, 99999);
  stepper('contract-grace-c-minus', 'contract-grace-c-plus', 'contract-grace-create',   0, 30);
  stepper('contract-locked-minus',  'contract-locked-plus',  'contract-locked-months',  1, 60);

  // ── Switch politique résiliation ───────────────────────
  let selectedPolicy = 'anytime';
  const policySwitch = el.querySelector('#contract-policy-switch');
  const lockedWrap = el.querySelector('#contract-locked-wrap');

  policySwitch.querySelectorAll('.contract-policy-switch__option').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPolicy = btn.dataset.policy;
      policySwitch.querySelectorAll('.contract-policy-switch__option').forEach(b => {
        b.classList.toggle('contract-policy-switch__option--active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      policySwitch.classList.toggle('contract-policy-switch--locked', selectedPolicy === 'locked');
      lockedWrap.classList.toggle('contract-locked-counter--visible', selectedPolicy === 'locked');
    });
  });

  // ── Création ───────────────────────────────────────────
  createBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    if (!tempFileId) { errorEl.textContent = 'Veuillez sélectionner un fichier contrat.'; return; }

    const fd = new FormData();
    fd.append('tempFileId', tempFileId);
    fd.append('originalName', tempOriginalName || '');
    fd.append('launchFeeAmount', el.querySelector('#contract-launch-amount').value);
    fd.append('launchFeeTaxRate', (Number(el.querySelector('#contract-launch-tax').value) / 100).toFixed(4));
    fd.append('monthlyFeeAmount', el.querySelector('#contract-monthly-amount').value);
    fd.append('monthlyFeeTaxRate', (Number(el.querySelector('#contract-monthly-tax').value) / 100).toFixed(4));
    fd.append('gracePeriodDays', el.querySelector('#contract-grace-create').value);
    fd.append('cancellationPolicyType', selectedPolicy);
    if (selectedPolicy === 'locked') {
      fd.append('cancellationPolicyLockedMonths', el.querySelector('#contract-locked-months').value);
    }
    fd.append('pendingMessage', el.querySelector('#contract-msg-create').value);
    const commType = el.querySelector('#contract-comm-type')?.value || null;
    const commValue = el.querySelector('#contract-comm-value')?.value || null;
    if (commType) fd.append('commissionsType', commType);
    if (commValue != null) fd.append('commissionsValue', commValue);

    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i> Création…';

    try {
      const r = await fetch(API.createContract, { method: 'POST', credentials: 'include', body: fd });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || 'Erreur lors de la création.';
        createBtn.disabled = false;
        createBtn.innerHTML = '<i class="bi bi-plus-circle" aria-hidden="true"></i> Créer le contrat';
        return;
      }
      await loadCurrentTab(container);
    } catch (_) {
      errorEl.textContent = 'Erreur réseau.';
      createBtn.disabled = false;
      createBtn.innerHTML = '<i class="bi bi-plus-circle" aria-hidden="true"></i> Créer le contrat';
    }
  });
}

// ─── Onglet Historique ────────────────────────────────────

async function loadHistoryTab(container) {
  const el = container.querySelector('#contract-tab-history');
  el.innerHTML = `
    <div class="contract-loader" style="min-height:140px">
      <span class="contract-spinner"><i class="bi bi-arrow-clockwise contract-spinner-icon"></i></span>
    </div>`;

  try {
    const r = await fetch(API.history, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur de chargement');

    if (!d.contracts?.length) {
      el.innerHTML = `<p class="contract-muted" style="padding:1rem 0">
        <i class="bi bi-archive" aria-hidden="true"></i> Aucun contrat archivé.</p>`;
      return;
    }

    el.innerHTML = '<div class="contract-cards" id="contract-history-list"></div>';
    const list = el.querySelector('#contract-history-list');

    d.contracts.forEach(c => {
      const card = document.createElement('div');
      card.className = 'contract-card';
      const cId = String(c._id || '');
      card.innerHTML = `
        <div class="contract-card__header">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
            <span class="contract-badge contract-badge--cancelled">
              <i class="bi bi-x-circle-fill" aria-hidden="true"></i> Résilié
            </span>
            <span class="contract-muted" style="font-size:0.77rem">
              Créé ${formatDate(c.createdAt)} · Annulé ${formatDateTime(c.cancelledAt)}
            </span>
          </div>
          <button class="contract-btn-outline contract-btn-outline--sm contract-history-detail-btn"
            data-id="${esc(cId)}">
            <i class="bi bi-eye" aria-hidden="true"></i> Détails
          </button>
        </div>
        <div class="contract-card__body">
          <div class="contract-billing-row">
            <span class="contract-billing-label">Lancement</span>
            <span>${esc(formatEur(c.launchFee?.amount || 0))} HT</span>
          </div>
          <div class="contract-billing-row">
            <span class="contract-billing-label">Mensualité</span>
            <span>${esc(formatEur(c.monthlyFee?.amount || 0))} HT / mois</span>
          </div>
        </div>
        <div class="contract-history-detail" id="contract-hist-${esc(cId)}" hidden>
          ${renderStripeRow('ID Contrat', cId)}
          ${c.monthlyFee?.stripeSubscriptionId ? renderStripeRow('Subscription', c.monthlyFee.stripeSubscriptionId) : ''}
          ${c.monthlyFee?.stripeCustomerId ? renderStripeRow('Customer', c.monthlyFee.stripeCustomerId) : ''}
          ${c.launchFee?.stripePaymentIntentId ? renderStripeRow('PaymentIntent', c.launchFee.stripePaymentIntentId) : ''}
          ${c.activatedAt ? `<div class="contract-billing-row"><span class="contract-billing-label">Activé le</span><span>${formatDateTime(c.activatedAt)}</span></div>` : ''}
          ${c.activatedBy?.email ? `<div class="contract-billing-row"><span class="contract-billing-label">Admin</span><span>${esc(c.activatedBy.email)}</span></div>` : ''}
        </div>
      `;

      card.querySelector('.contract-history-detail-btn').addEventListener('click', () => {
        const detail = card.querySelector(`#contract-hist-${cId}`);
        if (detail) detail.hidden = !detail.hidden;
      });
      card.querySelectorAll('.contract-copy-btn[data-value]').forEach(btn => attachCopyBtn(btn, btn.dataset.value));
      list.appendChild(card);
    });
  } catch (err) {
    el.innerHTML = `<p class="contract-error-msg"><i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}</p>`;
  }
}

export async function renderModule(container) {
  return init(container);
}
