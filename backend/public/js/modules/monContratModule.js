// monContratModule.js — Vue "Mon contrat" pour l'admin (v1.0)
// Préfixe CSS : mc-*
// Nécessite une entrée Page en base : type='gestion', moduleFile='monContrat', allowedRolesGestion=['admin','dev']

const API = {
  current: '/api/contract/current',
  cancel: '/api/contract/cancel'
};

// ─── Helpers ──────────────────────────────────────────────

function formatEurTtc(amount, taxRate) {
  const ttc = Number(amount || 0) * (1 + Number(taxRate || 0));
  return ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ─── Rendu ────────────────────────────────────────────────

function renderError(container, message) {
  container.innerHTML = `
    <div class="mc-module">
      <h2 class="mc-title">Mon contrat</h2>
      <div class="mc-error-state">
        <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
        <p>${message}</p>
      </div>
    </div>
  `;
}

function commissionLabel(commissions) {
  if (!commissions?.type) return null;
  const v = Number(commissions.value ?? 0);
  if (commissions.type === 'percentage') {
    return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}% par vente`;
  }
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € par vente`;
}

function renderContract(container, contract) {
  const {
    status,
    startDate,
    launchFee,
    monthlyFee,
    cancelAtPeriodEnd,
    commissions
  } = contract;

  const hasLaunch = Number(launchFee?.amount || 0) > 0;
  const hasMonthly = Number(monthlyFee?.amount || 0) > 0;

  const statusLabels = { active: 'Actif', pending: 'En attente', cancelled: 'Résilié' };
  const statusLabel = statusLabels[status] || status;

  const cancelBanner = cancelAtPeriodEnd
    ? `<div class="mc-cancel-banner">
        <i class="bi bi-clock-history" aria-hidden="true"></i>
        <span>Résiliation programmée — accès jusqu'au <strong>${formatDate(monthlyFee?.currentPeriodEnd)}</strong></span>
      </div>`
    : '';

  const launchRow = hasLaunch
    ? `<div class="mc-info-row">
        <span class="mc-info-label">Frais de lancement</span>
        <span class="mc-info-value">
          ${formatEurTtc(launchFee.amount, launchFee.taxRate)}
          <span class="mc-badge ${launchFee.paid ? 'mc-badge--success' : 'mc-badge--warning'}">
            ${launchFee.paid ? 'Réglé' : 'En attente'}
          </span>
        </span>
      </div>`
    : '';

  let monthlyPeriodLine = '';
  if (hasMonthly && monthlyFee.active && monthlyFee.currentPeriodEnd) {
    const label = cancelAtPeriodEnd ? 'Dernier accès' : 'Prochain débit';
    monthlyPeriodLine = `<p class="mc-period-line">${label} : <strong>${formatDate(monthlyFee.currentPeriodEnd)}</strong></p>`;
  }

  const monthlyRow = hasMonthly
    ? `<div class="mc-info-row">
        <span class="mc-info-label">Maintenance mensuelle</span>
        <span class="mc-info-value">
          ${formatEurTtc(monthlyFee.amount, monthlyFee.taxRate)}/mois
          <span class="mc-badge ${monthlyFee.active ? 'mc-badge--success' : 'mc-badge--muted'}">
            ${monthlyFee.active ? 'Active' : 'Inactive'}
          </span>
        </span>
      </div>
      ${monthlyPeriodLine}`
    : '';

  const cancelBtn = status === 'active' && !cancelAtPeriodEnd
    ? `<button type="button" class="mc-cancel-btn" id="mc-cancel-btn">
        <i class="bi bi-x-circle" aria-hidden="true"></i>
        Résilier le contrat
      </button>`
    : '';

  container.innerHTML = `
    <div class="mc-module">
      <h2 class="mc-title">Mon contrat</h2>
      ${cancelBanner}
      <div class="mc-card">
        <div class="mc-info-row">
          <span class="mc-info-label">Statut</span>
          <span class="mc-info-value">
            <span class="mc-badge mc-badge--status mc-badge--${status}">${statusLabel}</span>
          </span>
        </div>
        <div class="mc-info-row">
          <span class="mc-info-label">Date d'activation</span>
          <span class="mc-info-value">${formatDate(startDate)}</span>
        </div>
        ${commissionLabel(commissions)
          ? `<div class="mc-info-row">
              <span class="mc-info-label">Commission</span>
              <span class="mc-info-value">${commissionLabel(commissions)}</span>
            </div>`
          : ''}
        ${launchRow}
        ${monthlyRow}
        
      </div>
      <div class="mc-actions">
        ${cancelBtn}
      </div>
    </div>

    <!-- Modal résiliation -->
    <div class="mc-overlay" id="mc-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="mc-modal-title">
      <div class="mc-modal">
        <h3 class="mc-modal-title" id="mc-modal-title">Confirmer la résiliation</h3>
        <p class="mc-modal-body" id="mc-modal-body"></p>
        <div class="mc-modal-error" id="mc-modal-error" hidden></div>
        <div class="mc-modal-actions">
          <button type="button" class="mc-modal-cancel" id="mc-modal-cancel">Annuler</button>
          <button type="button" class="mc-modal-confirm" id="mc-modal-confirm">
            <span id="mc-confirm-label">Confirmer la résiliation</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Texte modal
  const modalBody = document.getElementById('mc-modal-body');
  if (hasMonthly && monthlyFee?.currentPeriodEnd) {
    modalBody.textContent = `Votre contrat restera actif jusqu'au ${formatDate(monthlyFee.currentPeriodEnd)}. Aucun nouveau débit ne sera effectué.`;
  } else {
    modalBody.textContent = 'Votre contrat sera résilié immédiatement.';
  }

  // Interactions
  const cancelBtnEl = document.getElementById('mc-cancel-btn');
  const overlay = document.getElementById('mc-overlay');
  const modalCancel = document.getElementById('mc-modal-cancel');
  const modalConfirm = document.getElementById('mc-modal-confirm');
  const modalError = document.getElementById('mc-modal-error');
  const confirmLabel = document.getElementById('mc-confirm-label');

  if (cancelBtnEl) {
    cancelBtnEl.addEventListener('click', () => {
      overlay.hidden = false;
      modalError.hidden = true;
      modalConfirm.disabled = false;
      confirmLabel.textContent = 'Confirmer la résiliation';
    });
  }

  modalCancel?.addEventListener('click', () => {
    overlay.hidden = true;
  });

  overlay?.addEventListener('click', e => {
    if (e.target === overlay) overlay.hidden = true;
  });

  modalConfirm?.addEventListener('click', async () => {
    modalConfirm.disabled = true;
    confirmLabel.textContent = 'Résiliation…';
    modalError.hidden = true;

    try {
      const r = await fetch(API.cancel, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      const d = await r.json();

      if (!r.ok) {
        modalError.textContent = d.error || 'Erreur lors de la résiliation.';
        modalError.hidden = false;
        modalConfirm.disabled = false;
        confirmLabel.textContent = 'Confirmer la résiliation';
        return;
      }

      overlay.hidden = true;

      if (d.immediate) {
        // Résiliation immédiate (pas d'abonnement Stripe) — recharger pour afficher badge "Annulé"
        await loadAndRender(container);
      } else {
        // Résiliation programmée — afficher le bandeau avec la date du POST avant le re-fetch
        const periodEnd = d.currentPeriodEnd
          ? new Date(d.currentPeriodEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
          : null;
        const banner = container.querySelector('.mc-cancel-banner');
        if (banner && periodEnd) {
          banner.querySelector('span').innerHTML = `Résiliation programmée — accès jusqu'au <strong>${periodEnd}</strong>`;
        }
        await loadAndRender(container);
      }
    } catch (_) {
      modalError.textContent = 'Erreur réseau. Veuillez réessayer.';
      modalError.hidden = false;
      modalConfirm.disabled = false;
      confirmLabel.textContent = 'Confirmer la résiliation';
    }
  });
}

// ─── Chargement ───────────────────────────────────────────

async function loadAndRender(container) {
  container.innerHTML = `
    <div class="mc-module">
      <h2 class="mc-title">Mon contrat</h2>
      <div class="mc-loading">
        <i class="bi bi-hourglass-split mc-spin" aria-hidden="true"></i>
        <span>Chargement…</span>
      </div>
    </div>
  `;

  try {
    const r = await fetch(API.current, { credentials: 'include' });
    const d = await r.json();

    if (!r.ok || !d.ok) {
      renderError(container, d.error || 'Impossible de charger les informations du contrat.');
      return;
    }

    renderContract(container, d.contract);
  } catch (_) {
    renderError(container, 'Erreur réseau. Veuillez réessayer.');
  }
}

// ─── Export ───────────────────────────────────────────────

export async function renderModule(container) {
  await loadAndRender(container);
}
