// commissionPaymentModule.js — Paiement des commissions mensuelles
// Beauty Savage · classes cpm-* · Bootstrap Icons exclusivement

const API = {
  payments: '/api/commissions/payments',
  createIntent: id => `/api/commissions/payments/${id}/create-intent`,
  checkStatus: id => `/api/commissions/payments/${id}/check-status`,
  reset: id => `/api/commissions/payments/${id}/reset`,
  settings: '/api/commissions/settings',
  reminders: '/api/commissions/settings/reminders',
  deleteReminder: days => `/api/commissions/settings/reminders/${days}`,
  simulatedDate: '/api/commissions/settings/simulated-date',
  stripeDevConfig: '/api/contract/stripe-dev-config',
  me: '/auth/me'
};

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function formatDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── État global du module ─────────────────────────────────────────────────

let _container = null;
let _pollingTimer = null;
let _simulatedDate = null;
let _stripeInstance = null;
let _paymentModal = null;
let _latePaymentDays = 15;
let _isDev = false;

// ─── Simulateur de date (DEV uniquement) ──────────────────────────────────

function getEffectiveNow() {
  if (_simulatedDate) return new Date(_simulatedDate);
  return new Date();
}

// ─── Calcul d'état d'une card ─────────────────────────────────────────────

function computeCardState(payment) {
  const now = getEffectiveNow();
  const { month, year, status } = payment;

  if (status === 'succeeded') return 'paid';

  const periodEnd = new Date(year, month + 1, 1); // 1er du mois suivant = disponible
  const availableFrom = periodEnd;
  const lateFrom = new Date(availableFrom);
  lateFrom.setDate(lateFrom.getDate() + _latePaymentDays);
  const warnFrom = new Date(lateFrom);
  warnFrom.setDate(warnFrom.getDate() - 3);

  if (now < availableFrom) return 'unavailable';
  if (now >= lateFrom) return 'late';
  if (now >= warnFrom) return 'warning';
  return 'available';
}

function computeTimings(payment) {
  const now = getEffectiveNow();
  const { month, year } = payment;
  const periodEnd = new Date(year, month + 1, 1);
  const availableFrom = periodEnd;
  const lateFrom = new Date(availableFrom);
  lateFrom.setDate(lateFrom.getDate() + _latePaymentDays);

  return { now, availableFrom, lateFrom };
}

// ─── Countdown HH:MM:SS ───────────────────────────────────────────────────

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// ─── Rendu d'une card de paiement — style comptable ───────────────────────

function renderPaymentCard(payment) {
  const state = computeCardState(payment);
  const monthLabel = `${MONTH_NAMES_FR[payment.month].toUpperCase()} ${payment.year}`;
  const { availableFrom, lateFrom, now } = computeTimings(payment);

  // Période
  const periodStart = new Date(payment.year, payment.month, 1);
  const periodEndDate = new Date(payment.year, payment.month + 1, 0);
  const periodStr = `${formatDateShort(periodStart)} → ${formatDateShort(periodEndDate)}`;

  // Badge état
  const BADGES = {
    unavailable: { text: 'Non disponible', cls: 'cpm-badge--unavailable' },
    available:   { text: 'À régler',        cls: 'cpm-badge--available' },
    warning:     { text: 'Urgent',           cls: 'cpm-badge--warning' },
    late:        { text: 'En retard',        cls: 'cpm-badge--late' },
    paid:        { text: 'Payée',            cls: 'cpm-badge--paid' }
  };
  const badge = BADGES[state] || BADGES.available;

  // Contenu zone état
  let stateHtml = '';
  let payBtnHtml = '';

  switch (state) {
    case 'unavailable': {
      const msLeft = availableFrom.getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / 86400000);
      stateHtml = `
        <i class="bi bi-clock" aria-hidden="true"></i>
        <span>Disponible dans <strong>J-${daysLeft}</strong></span>
        <span class="cpm-countdown" data-target="${availableFrom.toISOString()}">${formatCountdown(msLeft)}</span>`;
      break;
    }
    case 'available': {
      const daysSince = Math.floor((now.getTime() - availableFrom.getTime()) / 86400000);
      stateHtml = `
        <i class="bi bi-clock-fill" aria-hidden="true"></i>
        <span>Disponible depuis <strong>${daysSince}j</strong></span>`;
      payBtnHtml = `<button class="cpm-btn-pay" data-payment-id="${esc(payment._id)}" data-month-label="${esc(monthLabel)}">
        <i class="bi bi-credit-card" aria-hidden="true"></i> Payer
      </button>`;
      break;
    }
    case 'warning': {
      const daysLeft = Math.ceil((lateFrom.getTime() - now.getTime()) / 86400000);
      stateHtml = `
        <i class="bi bi-clock-fill" aria-hidden="true"></i>
        <span>Plus que <strong>${daysLeft}j</strong> avant retard</span>`;
      payBtnHtml = `<button class="cpm-btn-pay cpm-btn-pay--warning" data-payment-id="${esc(payment._id)}" data-month-label="${esc(monthLabel)}">
        <i class="bi bi-credit-card" aria-hidden="true"></i> Payer maintenant
      </button>`;
      break;
    }
    case 'late': {
      const daysLate = Math.floor((now.getTime() - lateFrom.getTime()) / 86400000);
      stateHtml = `
        <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
        <span>+${daysLate}j de retard</span>`;
      payBtnHtml = `<button class="cpm-btn-pay cpm-btn-pay--late" data-payment-id="${esc(payment._id)}" data-month-label="${esc(monthLabel)}">
        <i class="bi bi-credit-card" aria-hidden="true"></i> Régulariser
      </button>`;
      break;
    }
    case 'paid': {
      stateHtml = `
        <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
        <span>Payée le <strong>${formatDateShort(payment.paidAt)}</strong></span>`;
      break;
    }
  }

  const kebabHtml = buildKebab(payment, state === 'paid');

  return `
    <div class="cpm-card cpm-card--${state}" data-payment-id="${esc(payment._id)}">
      <div class="cpm-card__top">
        <span class="cpm-card__month">${esc(monthLabel)}</span>
        <span class="cpm-badge ${esc(badge.cls)}">${badge.text}</span>
      </div>
      <hr class="cpm-divider">
      <div class="cpm-card__meta">
        <div class="cpm-card__meta-row">
          <i class="bi bi-calendar3" aria-hidden="true"></i>
          <span class="cpm-meta-label">Période</span>
          <span class="cpm-meta-value">${esc(periodStr)}</span>
        </div>
        <div class="cpm-card__meta-row">
          <i class="bi bi-receipt" aria-hidden="true"></i>
          <span class="cpm-meta-label">Commissions dues</span>
          <span class="cpm-meta-value cpm-amount">${formatEur(payment.amount)}</span>
        </div>
      </div>
      <hr class="cpm-divider">
      <div class="cpm-card__footer">
        <div class="cpm-card__state cpm-card__state--${state}">
          ${stateHtml}
        </div>
        ${kebabHtml}
      </div>
      ${payBtnHtml ? `<div class="cpm-card__pay-wrap">${payBtnHtml}</div>` : ''}
    </div>`;
}

function buildKebab(payment, paid = false) {
  const hasPdf = Boolean(payment.stripeInvoicePdfUrl);
  const showReset = _isDev && payment.status === 'succeeded';

  if (!paid && !hasPdf && !showReset) return '';

  const items = [];
  if (hasPdf) {
    items.push(`<a class="cpm-kebab__item" href="${esc(payment.stripeInvoicePdfUrl)}" target="_blank" rel="noopener noreferrer">
      <i class="bi bi-file-earmark-pdf" aria-hidden="true"></i> Télécharger la facture
    </a>`);
  }
  if (showReset) {
    items.push(`<button class="cpm-kebab__item cpm-kebab__item--dev" data-action="reset" data-payment-id="${esc(payment._id)}">
      <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Simuler comme impayée
    </button>`);
  }

  if (!items.length) return '';
  return `
    <div class="cpm-kebab" role="menu">
      <button class="cpm-kebab__trigger" aria-haspopup="true" aria-expanded="false" aria-label="Actions">
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
      </button>
      <div class="cpm-kebab__menu" hidden>
        ${items.join('')}
      </div>
    </div>`;
}

// ─── Onglet Règlement ─────────────────────────────────────────────────────

function renderPaymentsTab(el, payments) {
  if (!payments?.length) {
    el.innerHTML = `<p class="cpm-muted">Aucun mois à afficher.</p>`;
    return;
  }

  // Trier : mois le plus récent en premier
  const sorted = [...payments].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return b.month - a.month;
  });

  el.innerHTML = `<div class="cpm-cards">${sorted.map(renderPaymentCard).join('')}</div>`;

  // Événements boutons Payer
  el.querySelectorAll('.cpm-btn-pay').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.paymentId;
      const label = btn.dataset.monthLabel;
      const payment = payments.find(p => String(p._id) === id);
      if (payment) openPaymentModal(payment, label);
    });
  });

  // Kebab menus
  attachKebabListeners(el);

  // Countdowns
  startCountdowns(el);
}

// ─── Onglet Réglages ──────────────────────────────────────────────────────

// ─── Helpers UI rappels ───────────────────────────────────────────────────

function buildReminderOptions(latePaymentDays, existingDays) {
  const options = [];
  for (let d = 1; d < latePaymentDays; d++) {
    if (!existingDays.includes(d)) {
      options.push(`<option value="${d}">${d} jour${d > 1 ? 's' : ''} avant la limite</option>`);
    }
  }
  return options.length
    ? `<option value="">Choisir…</option>${options.join('')}`
    : `<option value="">— Aucun jour disponible —</option>`;
}

function renderRemindersList(el, reminders) {
  const listEl = el.querySelector('#cpm-reminders-list');
  if (!listEl) return;
  if (!reminders.length) {
    listEl.innerHTML = `<p class="cpm-muted" style="font-size:.82rem">Aucun rappel configuré.</p>`;
    return;
  }
  listEl.innerHTML = reminders
    .sort((a, b) => b.daysBeforeDue - a.daysBeforeDue)
    .map(r => `
      <div class="cpm-reminder-chip" data-days="${r.daysBeforeDue}">
        <i class="bi bi-bell" aria-hidden="true"></i>
        <span>${r.daysBeforeDue} jour${r.daysBeforeDue > 1 ? 's' : ''} avant la limite</span>
        <button class="cpm-reminder-chip__del" data-action="delete-reminder" data-days="${r.daysBeforeDue}"
          aria-label="Supprimer ce rappel">
          <i class="bi bi-x" aria-hidden="true"></i>
        </button>
      </div>`).join('');
}

async function loadSettingsTab(el) {
  el.innerHTML = `<div class="cpm-loader"><i class="bi bi-arrow-clockwise cpm-spinner-icon"></i></div>`;

  try {
    const r = await fetch(API.settings, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur chargement.');

    const days = d.settings?.latePaymentDays ?? 15;
    const reminders = Array.isArray(d.settings?.reminders) ? d.settings.reminders : [];

    el.innerHTML = `
      <div class="cpm-settings-card">
        <div class="cpm-settings-card__header">
          <i class="bi bi-gear" aria-hidden="true"></i> Réglages des commissions
        </div>
        <div class="cpm-settings-card__body">

          <div class="cpm-form-group">
            <label class="cpm-form-label" for="cpm-late-days">Délai avant retard de paiement</label>
            <div class="cpm-stepper">
              <button class="cpm-stepper__btn" id="cpm-late-minus" type="button" aria-label="Diminuer">
                <i class="bi bi-dash" aria-hidden="true"></i>
              </button>
              <input type="number" id="cpm-late-days" class="cpm-stepper__input"
                min="2" max="90" step="1" value="${esc(String(days))}">
              <button class="cpm-stepper__btn" id="cpm-late-plus" type="button" aria-label="Augmenter">
                <i class="bi bi-plus" aria-hidden="true"></i>
              </button>
              <span class="cpm-muted">jours après disponibilité</span>
            </div>
            <p class="cpm-muted" style="font-size:.78rem;margin-top:.35rem">
              Si ce délai est réduit, les rappels hors tranche seront supprimés automatiquement.
            </p>
          </div>

          <div class="cpm-error-msg" id="cpm-settings-error"></div>
          <button class="cpm-btn-primary" id="cpm-settings-save">
            <i class="bi bi-check2" aria-hidden="true"></i> Enregistrer le délai
          </button>

          <hr class="cpm-divider" style="margin:1.2rem 0">

          <div class="cpm-form-group">
            <label class="cpm-form-label">Rappels automatiques de paiement</label>
            <p class="cpm-muted" style="font-size:.78rem;margin-bottom:.65rem">
              Un email est envoyé aux administrateurs X jours avant la date limite.
            </p>
            <div id="cpm-reminders-list"></div>
            <div class="cpm-reminder-add" style="display:flex;gap:.5rem;margin-top:.65rem;flex-wrap:wrap">
              <select id="cpm-reminder-select" class="cpm-stepper__input" style="width:auto;min-width:190px">
                ${buildReminderOptions(days, reminders.map(r => r.daysBeforeDue))}
              </select>
              <button class="cpm-btn-primary" id="cpm-reminder-add-btn" style="padding:.4rem .9rem">
                <i class="bi bi-plus" aria-hidden="true"></i> Ajouter
              </button>
            </div>
            <div class="cpm-error-msg" id="cpm-reminder-error" style="margin-top:.4rem"></div>
          </div>

        </div>
      </div>`;

    // Rendu initial des chips de rappels
    renderRemindersList(el, reminders);

    // ── Stepper délai ────────────────────────────────────────────────────
    const input = el.querySelector('#cpm-late-days');
    el.querySelector('#cpm-late-minus')?.addEventListener('click', () => {
      const v = Number(input.value);
      if (v > 2) input.value = v - 1;
    });
    el.querySelector('#cpm-late-plus')?.addEventListener('click', () => {
      const v = Number(input.value);
      if (v < 90) input.value = v + 1;
    });

    // ── Enregistrer le délai ─────────────────────────────────────────────
    el.querySelector('#cpm-settings-save')?.addEventListener('click', async () => {
      const errEl = el.querySelector('#cpm-settings-error');
      errEl.textContent = '';
      const saveBtn = el.querySelector('#cpm-settings-save');
      saveBtn.disabled = true;
      try {
        const res = await fetch(API.settings, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latePaymentDays: Number(input.value) })
        });
        const dres = await res.json();
        if (!res.ok) throw new Error(dres.error || 'Erreur.');
        _latePaymentDays = dres.settings.latePaymentDays;
        const updatedReminders = dres.settings.reminders || [];
        // Mettre à jour l'affichage des chips + select
        renderRemindersList(el, updatedReminders);
        const sel = el.querySelector('#cpm-reminder-select');
        if (sel) sel.innerHTML = buildReminderOptions(_latePaymentDays, updatedReminders.map(r => r.daysBeforeDue));
        // Rafraîchir les cards
        const tabEl = _container?.querySelector('#cpm-tab-payment');
        if (tabEl) refreshCardsDisplay(tabEl);
        showToast('Réglages enregistrés.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Erreur lors de la sauvegarde.';
      } finally {
        saveBtn.disabled = false;
      }
    });

    // ── Ajouter un rappel ────────────────────────────────────────────────
    el.querySelector('#cpm-reminder-add-btn')?.addEventListener('click', async () => {
      const sel = el.querySelector('#cpm-reminder-select');
      const errEl = el.querySelector('#cpm-reminder-error');
      errEl.textContent = '';
      const val = Number(sel?.value);
      if (!val) { errEl.textContent = 'Sélectionnez un nombre de jours.'; return; }
      try {
        const res = await fetch(API.reminders, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daysBeforeDue: val })
        });
        const dres = await res.json();
        if (!res.ok) throw new Error(dres.error || 'Erreur.');
        const updatedReminders = dres.reminders || [];
        renderRemindersList(el, updatedReminders);
        sel.innerHTML = buildReminderOptions(_latePaymentDays, updatedReminders.map(r => r.daysBeforeDue));
        showToast('Rappel ajouté.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Erreur lors de l\'ajout.';
      }
    });

    // ── Supprimer un rappel (délégation sur la liste) ────────────────────
    el.querySelector('#cpm-reminders-list')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="delete-reminder"]');
      if (!btn) return;
      const days = Number(btn.dataset.days);
      const errEl = el.querySelector('#cpm-reminder-error');
      errEl.textContent = '';
      try {
        const res = await fetch(API.deleteReminder(days), {
          method: 'DELETE',
          credentials: 'include'
        });
        const dres = await res.json();
        if (!res.ok) throw new Error(dres.error || 'Erreur.');
        const updatedReminders = dres.reminders || [];
        renderRemindersList(el, updatedReminders);
        const sel = el.querySelector('#cpm-reminder-select');
        if (sel) sel.innerHTML = buildReminderOptions(_latePaymentDays, updatedReminders.map(r => r.daysBeforeDue));
        showToast('Rappel supprimé.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Erreur lors de la suppression.';
      }
    });

  } catch (err) {
    el.innerHTML = `<p class="cpm-error-msg">${esc(err.message)}</p>`;
  }
}

// ─── Modal de paiement ────────────────────────────────────────────────────

async function openPaymentModal(payment, monthLabel) {
  closePaymentModal();

  const overlay = document.createElement('div');
  overlay.id = 'cpm-payment-modal';
  overlay.className = 'cpm-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Paiement commissions ${monthLabel}`);

  overlay.innerHTML = `
    <div class="cpm-modal-backdrop"></div>
    <div class="cpm-modal-panel">
      <div class="cpm-modal-header">
        <span class="cpm-modal-title">
          <i class="bi bi-credit-card" aria-hidden="true"></i>
          Commissions ${esc(monthLabel)}
        </span>
        <button class="cpm-modal-close" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="cpm-modal-body">
        <div class="cpm-modal-amount">
          <i class="bi bi-cash-stack" aria-hidden="true"></i>
          Montant : <strong>${formatEur(payment.amount)}</strong>
        </div>
        <div id="cpm-payment-element-wrap">
          <div class="cpm-loader"><i class="bi bi-arrow-clockwise cpm-spinner-icon"></i> Chargement…</div>
        </div>
        <div class="cpm-error-msg" id="cpm-pay-error"></div>
        <div class="cpm-modal-actions">
          <button class="cpm-btn-primary" id="cpm-pay-submit" disabled>
            <i class="bi bi-lock" aria-hidden="true"></i> Payer
          </button>
          <button class="cpm-btn-ghost" id="cpm-pay-cancel">Annuler</button>
        </div>
        <div id="cpm-pay-result" hidden></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  _paymentModal = overlay;

  overlay.querySelector('.cpm-modal-close')?.addEventListener('click', closePaymentModal);
  overlay.querySelector('#cpm-pay-cancel')?.addEventListener('click', closePaymentModal);
  overlay.querySelector('.cpm-modal-backdrop')?.addEventListener('click', closePaymentModal);

  // Initialiser Stripe + Payment Element
  await initPaymentElement(payment, monthLabel);
}

async function initPaymentElement(payment, monthLabel) {
  const wrap = document.getElementById('cpm-payment-element-wrap');
  const errEl = document.getElementById('cpm-pay-error');
  const submitBtn = document.getElementById('cpm-pay-submit');

  if (!wrap) return;

  try {
    // Charger Stripe JS
    if (!_stripeInstance) {
      const cfgRes = await fetch(API.stripeDevConfig, { credentials: 'include' });
      const cfgData = await cfgRes.json();
      if (!cfgRes.ok || !cfgData.publishableKey) throw new Error('Clé Stripe Developer manquante.');

      if (!window.Stripe) {
        await loadStripeJs();
      }
      _stripeInstance = window.Stripe(cfgData.publishableKey);
    }

    // Créer le PaymentIntent
    const intentRes = await fetch(API.createIntent(payment._id), {
      method: 'POST',
      credentials: 'include'
    });
    const intentData = await intentRes.json();

    if (!intentRes.ok) throw new Error(intentData.error || 'Impossible de créer le paiement.');
    if (intentData.alreadySucceeded) {
      showPayResult('success', monthLabel);
      refreshPayments();
      return;
    }

    const { clientSecret, amountCents } = intentData;

    // Monter le Payment Element
    const elements = _stripeInstance.elements({ clientSecret });
    const paymentEl = elements.create('payment');
    wrap.innerHTML = '<div id="cpm-stripe-element"></div>';
    paymentEl.mount('#cpm-stripe-element');
    paymentEl.on('ready', () => { submitBtn.disabled = false; });

    // Référence aux actions (boutons Payer / Annuler)
    const actionsEl = _paymentModal?.querySelector('.cpm-modal-actions');

    // Bouton Payer
    submitBtn?.addEventListener('click', async () => {
      if (errEl) errEl.textContent = '';
      submitBtn.disabled = true;

      // 1 — Masquer le Payment Element + boutons avec transition
      wrap.style.transition = 'opacity 300ms ease';
      wrap.style.opacity = '0';
      if (actionsEl) {
        actionsEl.style.transition = 'opacity 300ms ease';
        actionsEl.style.opacity = '0';
      }

      await new Promise(r => setTimeout(r, 300));
      wrap.style.display = 'none';
      if (actionsEl) actionsEl.style.display = 'none';

      // 2 — Afficher loader centré animé
      const loader = document.createElement('div');
      loader.className = 'cpm-modal-loader';
      loader.innerHTML = `
        <div class="cpm-loader-spinner"></div>
        <p class="cpm-loader-text">Traitement en cours…</p>`;
      const body = _paymentModal?.querySelector('.cpm-modal-body');
      if (body) body.appendChild(loader);
      resizeModal(_paymentModal);

      const { error } = await _stripeInstance.confirmPayment({
        elements,
        redirect: 'if_required'
      });

      if (error) {
        // Retour arrière : supprimer loader, ré-afficher formulaire
        loader.remove();
        wrap.style.display = '';
        wrap.style.opacity = '0';
        if (actionsEl) { actionsEl.style.display = ''; actionsEl.style.opacity = '0'; }
        resizeModal(_paymentModal);
        requestAnimationFrame(() => {
          wrap.style.opacity = '1';
          if (actionsEl) actionsEl.style.opacity = '1';
        });
        if (errEl) errEl.textContent = error.message || 'Le paiement a échoué.';
        submitBtn.disabled = false;
        return;
      }

      // Vérification côté serveur
      await pollPaymentStatus(payment._id, monthLabel);
    });
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Erreur lors de l\'initialisation du paiement.';
    wrap.innerHTML = '';
  }
}

async function pollPaymentStatus(paymentId, monthLabel, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1500);
    try {
      const res = await fetch(API.checkStatus(paymentId), { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'succeeded') {
        showPayResult('success', monthLabel);
        refreshPayments();
        return;
      }
      if (data.status === 'failed') {
        showPayResult('error', monthLabel);
        return;
      }
    } catch (_) {}
  }
  // Timeout
  const errEl = document.getElementById('cpm-pay-error');
  if (errEl) errEl.textContent = 'Vérification en cours. Le paiement sera confirmé sous peu.';
}

function showPayResult(type, monthLabel) {
  const modal = document.getElementById('cpm-payment-modal');
  if (!modal) return;
  const body = modal.querySelector('.cpm-modal-body');
  if (!body) return;

  const isSuccess = type === 'success';
  body.innerHTML = `
    <div class="cpm-pay-result cpm-pay-result--${type}">
      <i class="bi bi-${isSuccess ? 'check-circle-fill' : 'x-circle-fill'}" aria-hidden="true"></i>
      <p>${isSuccess
        ? `Commissions <strong>${esc(monthLabel)}</strong> réglées avec succès.`
        : 'Le paiement a échoué. Réessayez.'}</p>
      <button class="cpm-btn-ghost" id="cpm-result-close">Fermer</button>
    </div>`;

  resizeModal(modal);
  body.querySelector('#cpm-result-close')?.addEventListener('click', closePaymentModal);

  if (isSuccess) {
    setTimeout(closePaymentModal, 4000);
  }
}

function closePaymentModal() {
  if (_paymentModal) {
    _paymentModal.remove();
    _paymentModal = null;
  }
}

// ─── Resize modal fluide après changement de contenu ──────────────────────

function resizeModal(modal) {
  const panel = modal?.querySelector('.cpm-modal-panel');
  if (!panel) return;
  const header = panel.querySelector('.cpm-modal-header');
  const body = panel.querySelector('.cpm-modal-body');
  if (!header || !body) return;

  panel.style.transition = 'height 350ms cubic-bezier(0.4, 0, 0.2, 1)';
  const targetH = header.offsetHeight + body.scrollHeight + 2;
  panel.style.height = panel.offsetHeight + 'px';
  // force reflow
  panel.offsetHeight; // eslint-disable-line no-unused-expressions
  panel.style.height = targetH + 'px';
  setTimeout(() => {
    panel.style.height = 'auto';
    panel.style.transition = '';
  }, 360);
}

// ─── Kebab listeners ──────────────────────────────────────────────────────

let _kebabDocListenerAttached = false;

function closeAllKebabMenus() {
  document.querySelectorAll('.cpm-kebab__menu').forEach(m => {
    if (m._originalParent) {
      m._originalParent.appendChild(m);
      m._originalParent = null;
    }
    m.hidden = true;
  });
  document.querySelectorAll('.cpm-kebab__trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
}

function attachKebabListeners(el) {
  el.querySelectorAll('.cpm-kebab').forEach(kebab => {
    const trigger = kebab.querySelector('.cpm-kebab__trigger');
    const menu = kebab.querySelector('.cpm-kebab__menu');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = menu.parentElement === document.body && !menu.hidden;
      closeAllKebabMenus();
      if (!isOpen) {
        const rect = trigger.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.style.left = 'auto';
        menu.style.zIndex = '9999';
        menu._originalParent = kebab;
        menu.hidden = false;
        document.body.appendChild(menu);
        trigger.setAttribute('aria-expanded', 'true');
      }
    });

    // Action reset (dev only)
    menu.querySelectorAll('[data-action="reset"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        closeAllKebabMenus();
        const id = btn.dataset.paymentId;
        try {
          const res = await fetch(API.reset(id), { method: 'POST', credentials: 'include' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur reset.');
          await refreshPayments();
        } catch (err) {
          showToast(err.message || 'Erreur lors du reset.', 'error');
        }
      });
    });
  });

  if (!_kebabDocListenerAttached) {
    _kebabDocListenerAttached = true;
    document.addEventListener('click', e => {
      if (!e.target.closest('.cpm-kebab__trigger')) {
        closeAllKebabMenus();
      }
    });
  }
}

// ─── Countdowns ───────────────────────────────────────────────────────────

let _countdownInterval = null;

function startCountdowns(el) {
  stopCountdowns();
  _countdownInterval = setInterval(() => {
    el.querySelectorAll('.cpm-countdown[data-target]').forEach(el => {
      const target = new Date(el.dataset.target).getTime();
      const ms = target - getEffectiveNow().getTime();
      el.textContent = formatCountdown(ms);
    });
  }, 1000);
}

function stopCountdowns() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
}

// ─── Polling statuts pending ──────────────────────────────────────────────

let _paymentsCache = [];

function startPolling(payments) {
  stopPolling();
  _paymentsCache = payments;

  const hasPending = payments.some(p => p.status === 'pending' && p.stripePaymentIntentId);
  if (!hasPending) return;

  _pollingTimer = setInterval(async () => {
    const pending = _paymentsCache.filter(p => p.status === 'pending' && p.stripePaymentIntentId);
    if (!pending.length) { stopPolling(); return; }

    let changed = false;
    for (const p of pending) {
      try {
        const res = await fetch(API.checkStatus(p._id), { credentials: 'include' });
        const data = await res.json();
        if (data.status === 'succeeded') {
          p.status = 'succeeded';
          p.paidAt = data.paidAt;
          changed = true;
        }
      } catch (_) {}
    }
    if (changed) {
      const tabEl = _container?.querySelector('#cpm-tab-payment');
      if (tabEl) renderPaymentsTab(tabEl, _paymentsCache);
    }
  }, 30000);
}

function stopPolling() {
  if (_pollingTimer) { clearInterval(_pollingTimer); _pollingTimer = null; }
}

// ─── Rafraîchissement des cards ───────────────────────────────────────────

function refreshCardsDisplay(tabEl) {
  if (!tabEl || !_paymentsCache.length) return;
  renderPaymentsTab(tabEl, _paymentsCache);
}

async function refreshPayments() {
  try {
    const r = await fetch(API.payments, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) return;
    _paymentsCache = d.payments || [];
    _latePaymentDays = d.settings?.latePaymentDays ?? _latePaymentDays;

    const tabEl = _container?.querySelector('#cpm-tab-payment');
    if (tabEl) renderPaymentsTab(tabEl, _paymentsCache);
  } catch (_) {}
}

// ─── Chargement Stripe JS ─────────────────────────────────────────────────

function loadStripeJs() {
  return new Promise((resolve, reject) => {
    if (document.getElementById('stripe-js-dev')) { resolve(); return; }
    const script = document.createElement('script');
    script.id = 'stripe-js-dev';
    script.src = 'https://js.stripe.com/v3/';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Impossible de charger Stripe.js'));
    document.head.appendChild(script);
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const existing = document.getElementById('cpm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'cpm-toast';
  toast.className = `cpm-toast cpm-toast--${type}`;
  toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle-fill' : 'exclamation-triangle-fill'}" aria-hidden="true"></i> ${esc(message)}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ─── Simulateur de date ───────────────────────────────────────────────────

async function postSimulatedDate(dateValue) {
  await fetch(API.simulatedDate, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: dateValue || null })
  });
}

async function reloadPaymentsTab() {
  const tabEl = _container?.querySelector('#cpm-tab-payment');
  if (!tabEl) return;
  tabEl.innerHTML = `<div class="cpm-loader"><i class="bi bi-arrow-clockwise cpm-spinner-icon"></i> Rechargement…</div>`;
  try {
    const r = await fetch(API.payments, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur.');
    _latePaymentDays = d.settings?.latePaymentDays ?? 15;
    _paymentsCache = d.payments || [];
    renderPaymentsTab(tabEl, _paymentsCache);
    startPolling(_paymentsCache);
  } catch (err) {
    tabEl.innerHTML = `<p class="cpm-error-msg"><i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}</p>`;
  }
}

function renderDateSimulator(container, initialDate) {
  const wrap = container.querySelector('#cpm-date-sim');
  if (!wrap) return;

  _simulatedDate = initialDate || null;

  wrap.innerHTML = `
    <div class="cpm-devbanner">
      <i class="bi bi-bug" aria-hidden="true"></i>
      <strong>DEV</strong> — Simuler une date
      <input type="date" id="cpm-sim-input" value="${esc(_simulatedDate || '')}" style="margin:0 .5rem">
      <button class="cpm-btn-ghost cpm-btn-ghost--sm" id="cpm-sim-reset">Réinitialiser</button>
      <span id="cpm-sim-status" style="font-size:.78rem;margin-left:.5rem"></span>
    </div>`;

  const input = wrap.querySelector('#cpm-sim-input');
  const statusEl = wrap.querySelector('#cpm-sim-status');

  input?.addEventListener('change', async e => {
    const val = e.target.value || null;
    _simulatedDate = val;
    statusEl.textContent = 'Enregistrement…';
    await postSimulatedDate(val);
    statusEl.textContent = val ? `Simulé : ${val}` : '';
    await reloadPaymentsTab();
  });

  wrap.querySelector('#cpm-sim-reset')?.addEventListener('click', async () => {
    _simulatedDate = null;
    if (input) input.value = '';
    statusEl.textContent = 'Réinitialisation…';
    await postSimulatedDate(null);
    statusEl.textContent = '';
    await reloadPaymentsTab();
  });
}

// ─── Utilitaires ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Point d'entrée principal ─────────────────────────────────────────────

export async function init(container) {
  _container = container;
  stopPolling();
  stopCountdowns();

  // Récupérer le rôle réel depuis /auth/me (ne jamais se fier à body.dataset)
  try {
    const meRes = await fetch(API.me, { credentials: 'include' });
    if (meRes.ok) {
      const meData = await meRes.json();
      _isDev = (meData?.user?.role || '') === 'dev';
    }
  } catch (_) {
    _isDev = false;
  }

  container.innerHTML = `
    <div class="cpm-module">
      <div class="cpm-tabs" role="tablist" aria-label="Commissions">
        <button class="cpm-tab cpm-tab--active" role="tab" data-tab="payment"
          aria-selected="true" aria-controls="cpm-tab-payment" id="cpm-tabBtn-payment">
          <i class="bi bi-calendar-check" aria-hidden="true"></i> Règlement
        </button>
        ${_isDev ? `<button class="cpm-tab" role="tab" data-tab="settings"
          aria-selected="false" aria-controls="cpm-tab-settings" id="cpm-tabBtn-settings">
          <i class="bi bi-gear" aria-hidden="true"></i> Réglages
        </button>` : ''}
      </div>

      <div id="cpm-date-sim"></div>

      <div id="cpm-tab-payment" role="tabpanel" aria-labelledby="cpm-tabBtn-payment">
        <div class="cpm-loader"><i class="bi bi-arrow-clockwise cpm-spinner-icon"></i> Chargement…</div>
      </div>
      ${_isDev ? `<div id="cpm-tab-settings" role="tabpanel" aria-labelledby="cpm-tabBtn-settings" hidden></div>` : ''}
    </div>`;

  // Onglets
  container.querySelectorAll('.cpm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.cpm-tab').forEach(t => {
        t.classList.remove('cpm-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('cpm-tab--active');
      tab.setAttribute('aria-selected', 'true');

      container.querySelectorAll('[role="tabpanel"]').forEach(p => { p.hidden = true; });
      const panel = container.querySelector(`#cpm-tab-${tab.dataset.tab}`);
      if (panel) {
        panel.hidden = false;
        if (tab.dataset.tab === 'settings') loadSettingsTab(panel);
      }
    });
  });

  // Simulateur de date (dev uniquement) — lire la date simulée depuis le backend
  if (_isDev) {
    let initialSimDate = null;
    try {
      const sr = await fetch(API.settings, { credentials: 'include' });
      if (sr.ok) {
        const sd = await sr.json();
        initialSimDate = sd.settings?.simulatedDate || null;
      }
    } catch (_) {}
    renderDateSimulator(container, initialSimDate);
  }

  // Charger les paiements
  try {
    const r = await fetch(API.payments, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur de chargement.');

    _latePaymentDays = d.settings?.latePaymentDays ?? 15;
    _paymentsCache = d.payments || [];

    const tabEl = container.querySelector('#cpm-tab-payment');
    renderPaymentsTab(tabEl, _paymentsCache);
    startPolling(_paymentsCache);
  } catch (err) {
    const tabEl = container.querySelector('#cpm-tab-payment');
    if (tabEl) tabEl.innerHTML = `<p class="cpm-error-msg"><i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}</p>`;
  }
}

export async function renderModule(container) {
  return init(container);
}
