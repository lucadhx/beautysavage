import { showToast } from '../helpers/toastService.js';
import {
  readCheckoutStateToken
} from './purchaseFlowService.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';

const FINALIZE_MIN_MS = 1000;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0,00 €';
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function waitMin(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= minMs) return;
  await wait(minMs - elapsed);
}

function buildLoaderMarkup(label) {
  return `
    <div class="gcg-inline-loader checkoutp-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function renderMissingState(container) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel payment-sim__panel--error">
        <h2>Paiement</h2>
        <p>Session de paiement introuvable. Revenez au checkout pour recommencer.</p>
      </article>
    </section>
  `;
}

function renderErrorState(container, message) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel payment-sim__panel--error">
        <h2>Paiement</h2>
        <p>${escapeHtml(message || 'Une erreur est survenue. Veuillez reessayer.')}</p>
      </article>
    </section>
  `;
}

function renderAlreadyPurchasedState(container) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel payment-sim__panel--error">
        <h2>Paiement</h2>
        <p>Vous etes deja inscrit a cette formation.</p>
        <div class="payment-sim__actions">
          <a href="vitrine.html?slug=myformations" class="primary-button">Mes formations</a>
        </div>
      </article>
    </section>
  `;
}

function renderSuccessState(container) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel">
        <div class="psm-result__panel">
          <div class="psm-result__icon-wrap" aria-hidden="true">
            <i class="bi bi-check-circle-fill psm-result__icon psm-result__icon--success psm-pop-in"></i>
          </div>
          <h2 class="psm-result__title">Paiement confirmé !</h2>
          <p class="psm-result__text">Vous allez recevoir un email de confirmation</p>
          <div class="psm-result__actions">
            <button type="button" class="primary-button" data-psm-myformations>
              Accéder à mes formations
            </button>
          </div>
        </div>
      </article>
    </section>
  `;
  container.querySelector('[data-psm-myformations]')?.addEventListener('click', () => {
    requestVitrineNavigation('myformations', { source: 'payment-success', skipThrottle: true });
  });
}

function renderFailureState(container, origin, errorMessage) {
  const retryHref = origin
    ? `vitrine.html?slug=${encodeURIComponent(origin.slug)}${
        origin.query
          ? '&' +
            Object.entries(origin.query)
              .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
              .join('&')
          : ''
      }`
    : 'vitrine.html';
  const message = errorMessage || 'Le paiement n\'a pas pu être finalisé. Aucun débit n\'a été effectué.';

  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel payment-sim__panel--error">
        <div class="psm-result__panel psm-shake">
          <div class="psm-result__icon-wrap" aria-hidden="true">
            <i class="bi bi-x-circle-fill psm-result__icon psm-result__icon--failed"></i>
          </div>
          <h2 class="psm-result__title">Paiement échoué</h2>
          <p class="psm-result__text">${escapeHtml(message)}</p>
          <div class="psm-result__actions">
            <a href="${escapeHtml(retryHref)}" class="psm-pay-btn psm-pay-btn--outline">Réessayer</a>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderPendingConfirmationState(container) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel">
        <header class="payment-sim__header">
          <h2>Confirmation en attente</h2>
          <p>La confirmation de votre paiement prend plus de temps que prevu.</p>
        </header>
        <p>
          Verifiez dans quelques minutes dans 'Mes formations' si votre achat apparait.
          Si vous avez ete debite sans recevoir votre formation, contactez le support.
        </p>
        <div class="payment-sim__actions">
          <a href="vitrine.html?slug=myformations" class="primary-button">Mes formations</a>
          <a href="mailto:support@beautysavage.fr?subject=Assistance%20paiement" class="secondary-button">Contacter le support</a>
        </div>
      </article>
    </section>
  `;
}

// ── Stripe.js helpers ──────────────────────────────────────────────────────

async function loadStripeJs() {
  if (window.Stripe) return window.Stripe;
  return new Promise((resolve, reject) => {
    const STRIPE_URL = 'https://js.stripe.com/v3/';
    const existing = document.querySelector(`script[src="${STRIPE_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Stripe));
      existing.addEventListener('error', () => reject(new Error('Impossible de charger Stripe')));
      return;
    }
    const script = document.createElement('script');
    script.src = STRIPE_URL;
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Impossible de charger Stripe'));
    document.head.appendChild(script);
  });
}

async function fetchStripeConfig() {
  const res = await fetch('/api/stripe/config', { credentials: 'include' });
  if (!res.ok) throw new Error('Impossible de recuperer la configuration Stripe');
  const data = await res.json();
  return data.publishableKey;
}

async function createStripePaymentIntent(checkoutState) {
  const res = await fetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ checkoutState })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data?.code || data?.error || '').trim();
    const err = new Error(
      code === 'ALREADY_PURCHASED'
        ? 'Vous etes deja inscrit a cette formation.'
        : data?.error || 'Impossible de creer la session de paiement.'
    );
    err.code = code;
    throw err;
  }
  // { clientSecret, returnUrl }
  return data;
}

async function fetchPaymentStatus(paymentIntentId) {
  const res = await fetch(
    `/api/stripe/session-status?payment_intent_id=${encodeURIComponent(paymentIntentId)}`,
    { credentials: 'include' }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Impossible de recuperer le statut du paiement.');
  return data;
}

// ── Service booking: inline result helpers ─────────────────────────────────

async function pollBookingByPaymentIntent(paymentIntentId, maxAttempts = 12, intervalMs = 1500) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const res = await fetch(`/api/client/bookings/by-payment-intent/${encodeURIComponent(paymentIntentId)}`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (data.booking?.status === 'confirmed') return true;
    } catch (_) { /* réseau — on réessaie */ }
  }
  return false;
}

function showInlineServiceResult(panel, type, message, onRetry) {
  const iconMap = {
    success: 'bi-check-circle-fill psm-pop-in',
    failed: 'bi-x-circle-fill',
    pending: 'bi-clock'
  };
  const colorMap = {
    success: 'var(--color-success, #1f7a3a)',
    failed: 'var(--color-danger, #dc2626)',
    pending: '#d97706'
  };
  const titleMap = {
    success: 'Réservation confirmée !',
    failed: 'Paiement échoué',
    pending: 'Confirmation en cours…'
  };
  const defaultMsg = {
    success: 'Vous recevrez un email de confirmation dans quelques instants.',
    failed: 'Le paiement n\'a pas abouti. Aucun débit n\'a été effectué.',
    pending: 'Votre réservation est en cours de confirmation. Vous recevrez un email de confirmation dans quelques instants.'
  };

  panel.innerHTML = `
    <div class="psm-result__panel${type === 'failed' ? ' psm-shake' : ''}">
      <div class="psm-result__icon-wrap" aria-hidden="true">
        <i class="bi ${iconMap[type]} psm-result__icon" style="color:${colorMap[type]}"></i>
      </div>
      <h2 class="psm-result__title">${titleMap[type]}</h2>
      <p class="psm-result__text">${escapeHtml(message || defaultMsg[type])}</p>
      <div class="psm-result__actions">
        ${type === 'success'
          ? '<button type="button" class="primary-button" data-psm-myservices>Voir mes réservations</button>'
          : type === 'failed'
            ? '<button type="button" class="psm-pay-btn psm-pay-btn--outline" data-psm-retry>Réessayer</button>'
            : ''
        }
      </div>
    </div>
  `;
  panel.querySelector('[data-psm-myservices]')?.addEventListener('click', () => {
    requestVitrineNavigation('mes-prestations', { skipThrottle: true });
  });
  panel.querySelector('[data-psm-retry]')?.addEventListener('click', () => {
    if (typeof onRetry === 'function') onRetry();
  });
}

// ── Order summary helpers ──────────────────────────────────────────────────

function buildItemsMarkup(items, totals) {
  if (!items.length) return '';
  const rows = items.map(item => {
    const name = String(item?.name || 'Article').trim();
    const price = Number(item?.finalPrice ?? item?.price ?? 0);
    const options = Array.isArray(item?.options) ? item.options : [];
    const hasSession = item?.sessionDate || (item?.sessionStartTime && item?.sessionEndTime);

    let subRows = '';
    if (hasSession) {
      const d = item.sessionDate ? new Date(item.sessionDate) : null;
      const dateStr = d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        : '';
      const timeStr = item.sessionStartTime && item.sessionEndTime
        ? `${item.sessionStartTime}–${item.sessionEndTime}`
        : '';
      const sessionLabel = [dateStr, timeStr].filter(Boolean).join(' · ');
      if (sessionLabel) {
        subRows += `<li class="psm-item-sub">└ Session ${escapeHtml(sessionLabel)}</li>`;
      }
    }
    options.forEach(opt => {
      const optName = String(opt?.name || '').trim();
      const optPrice = Number(opt?.price ?? 0);
      if (optName) {
        subRows += `<li class="psm-item-sub">└ ${escapeHtml(optName)}<span style="float:right;font-family:monospace">+${formatPrice(optPrice)}</span></li>`;
      }
    });

    return `
      <li>
        <div class="psm-item-row">
          <span class="psm-item-name">${escapeHtml(name)}</span>
          <span class="psm-item-price">${formatPrice(price)}</span>
        </div>
        ${subRows ? `<ul style="list-style:none;margin:0;padding:0">${subRows}</ul>` : ''}
      </li>
    `;
  }).join('');

  const giftCardTotal = Number(totals?.giftCardTotal ?? 0);
  const total = Number(totals?.amountToPay ?? totals?.remainingToPay ?? 0);
  const subtotal = Number(totals?.subtotal ?? total);

  const giftRow = giftCardTotal > 0
    ? `<hr class="psm-order-divider"><div class="psm-gift-row"><span>Carte cadeau</span><span class="psm-gift-price">−${formatPrice(giftCardTotal)}</span></div>`
    : '';

  return `
    <ul class="psm-items-list">${rows}</ul>
    ${giftRow}
    <hr class="psm-order-divider">
    <div class="psm-total-row">
      <span>Total</span>
      <span class="psm-total-amount">${formatPrice(total)}</span>
    </div>
  `;
}

// ── Payment form rendering ─────────────────────────────────────────────────

function renderPaymentForm(container, checkoutState) {
  const total = Number(checkoutState?.totals?.amountToPay ?? checkoutState?.totals?.remainingToPay ?? 0);
  const items = Array.isArray(checkoutState?.items) ? checkoutState.items : [];
  const totals = checkoutState?.totals || {};
  const itemsMarkup = buildItemsMarkup(items, totals);
  const formattedTotal = formatPrice(total);

  container.innerHTML = `
    <section class="payment-sim psm-new">
      <article class="payment-sim__panel" data-payment-panel style="padding:0;overflow:hidden;">
        <div class="psm-secure-header">
          <i class="bi bi-lock-fill" aria-hidden="true"></i>
          <span>Paiement sécurisé</span>
          <span class="psm-powered-stripe">Propulsé par Stripe</span>
        </div>

        ${itemsMarkup ? `
        <details class="psm-order-summary" open>
          <summary>
            <span class="psm-summary-title">Votre commande</span>
            <i class="bi bi-chevron-down psm-summary-toggle-icon" aria-hidden="true"></i>
            <span class="psm-summary-total-inline">${formattedTotal}</span>
          </summary>
          <div class="psm-order-summary__body">
            ${itemsMarkup}
          </div>
        </details>
        ` : ''}

        <div class="psm-stripe-zone">
          <div data-stripe-loader>
            ${buildLoaderMarkup('Initialisation du paiement...')}
          </div>
          <div id="payment-element-container" style="display:none;"></div>
          <div data-stripe-error style="display:none;" class="psm-error-msg" role="alert"></div>
          <div data-stripe-actions style="display:none;">
            <button type="button" class="psm-pay-btn" data-pay-button>
              <i class="bi bi-lock-fill" aria-hidden="true"></i>
              Payer ${formattedTotal}
            </button>
            <p class="psm-security-note">
              <i class="bi bi-lock-fill" aria-hidden="true"></i>
              Paiement 100% sécurisé via Stripe — vos coordonnées bancaires ne nous sont jamais communiquées
            </p>
          </div>
        </div>
      </article>
    </section>
  `;
}

// ── Return flow (after Stripe redirect) ───────────────────────────────────

async function handleReturnFromStripe(container, paymentIntentId, redirectStatus) {
  container.innerHTML = `
    <section class="payment-sim">
      <article class="payment-sim__panel" data-payment-panel>
        <div>${buildLoaderMarkup('Vérification du paiement...')}</div>
      </article>
    </section>
  `;

  // Fast-path failure only when Stripe explicitly redirects with failed status
  if (String(redirectStatus || '').trim().toLowerCase() === 'failed') {
    if (!container.isConnected) return;
    let origin = null;
    try {
      const statusData = await fetchPaymentStatus(paymentIntentId);
      origin = statusData.origin || null;
    } catch (_) { /* ignore */ }
    renderFailureState(container, origin);
    showToast({ type: 'info', message: 'Paiement non abouti', durationMs: 1000 });
    return;
  }

  try {
    const startedAt = Date.now();
    const statusData = await fetchPaymentStatus(paymentIntentId);
    await waitMin(startedAt, FINALIZE_MIN_MS);

    if (!container.isConnected) return;

    if (statusData.status === 'complete') {
      renderSuccessState(container);
      showToast({ type: 'success', message: 'Paiement validé', durationMs: 1000 });
    } else {
      renderPendingConfirmationState(container);
      showToast({ type: 'info', message: 'Confirmation en attente', durationMs: 1000 });
    }
  } catch (error) {
    console.error('[PaymentModule] Erreur verification statut Stripe', error);
    if (container.isConnected) {
      renderPendingConfirmationState(container);
      showToast({ type: 'info', message: 'Confirmation en attente', durationMs: 1000 });
    }
  }
}

// ── Module entry point ─────────────────────────────────────────────────────

export async function renderPage(container, context = {}) {
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const contextQuery = context?.query || {};

  // ── Return flow: Stripe redirected back with payment_intent + redirect_status
  const paymentIntentId = String(
    contextQuery.payment_intent || params.get('payment_intent') || ''
  ).trim();
  const redirectStatus = String(
    contextQuery.redirect_status || params.get('redirect_status') || ''
  ).trim();

  if (paymentIntentId) {
    await handleReturnFromStripe(container, paymentIntentId, redirectStatus);
    return;
  }

  // ── Normal flow: initialize payment form
  const token = String(contextQuery.checkoutToken || params.get('checkoutToken') || '').trim();
  const checkoutState = readCheckoutStateToken(token);
  if (!checkoutState) {
    renderMissingState(container);
    return;
  }

  renderPaymentForm(container, checkoutState);

  const loaderEl = container.querySelector('[data-stripe-loader]');
  const paymentContainer = container.querySelector('#payment-element-container');
  const actionsEl = container.querySelector('[data-stripe-actions]');
  const payButton = container.querySelector('[data-pay-button]');
  const errorEl = container.querySelector('[data-stripe-error]');
  const panel = container.querySelector('[data-payment-panel]');

  try {
    const [StripeConstructor, publishableKey, piData] = await Promise.all([
      loadStripeJs(),
      fetchStripeConfig(),
      createStripePaymentIntent(checkoutState)
    ]);

    if (!container.isConnected) return;

    const { clientSecret, returnUrl } = piData;
    const stripe = StripeConstructor(publishableKey);

    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create('payment');

    if (loaderEl) loaderEl.style.display = 'none';
    if (paymentContainer) paymentContainer.style.display = '';
    paymentElement.mount('#payment-element-container');
    if (actionsEl) actionsEl.style.display = '';

    const isServiceBooking = String(checkoutState?.item?.type || '').trim().toLowerCase() === 'service';
    const total = Number(checkoutState?.totals?.amountToPay ?? checkoutState?.totals?.remainingToPay ?? 0);

    payButton?.addEventListener('click', async () => {
      if (!payButton) return;
      payButton.disabled = true;
      payButton.innerHTML = `
        <span class="psm-pay-spinner" style="width:1em;height:1em;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:psm-spin 0.7s linear infinite" aria-hidden="true"></span>
        Traitement...
      `;
      if (errorEl) errorEl.style.display = 'none';
      if (panel) panel.classList.add('is-loading');

      if (isServiceBooking) {
        // ── Service : rester sur la page, résultat inline ───────────────────
        const { error, paymentIntent } = await stripe.confirmPayment({
          elements,
          redirect: 'if_required'
        });

        if (!container.isConnected) return;

        if (error) {
          // Échec : restaurer le bouton + afficher le résultat inline
          if (panel) panel.classList.remove('is-loading');
          payButton.disabled = false;
          payButton.innerHTML = `<i class="bi bi-lock-fill" aria-hidden="true"></i> Payer ${formatPrice(total)}`;
          if (errorEl) {
            errorEl.textContent = error.message || 'Le paiement a échoué. Veuillez réessayer.';
            errorEl.style.display = '';
          }
          showToast({ type: 'error', message: 'Paiement refusé', durationMs: 1500 });
          if (panel) showInlineServiceResult(panel, 'failed', error.message);
        } else if (paymentIntent?.status === 'succeeded') {
          // Succès Stripe — attendre confirmation webhook via polling
          if (panel) {
            panel.classList.remove('is-loading');
            panel.innerHTML = `
              <div class="psm-result__panel">
                ${buildLoaderMarkup('Vérification de votre réservation…')}
              </div>
            `;
          }
          const confirmed = await pollBookingByPaymentIntent(paymentIntent.id);
          if (!container.isConnected) return;
          if (confirmed) {
            if (panel) showInlineServiceResult(panel, 'success');
            showToast({ type: 'success', message: 'Réservation confirmée !', durationMs: 2000 });
          } else {
            if (panel) showInlineServiceResult(panel, 'pending');
            showToast({ type: 'info', message: 'Confirmation en cours…', durationMs: 2000 });
          }
        } else {
          // Statut inattendu
          if (panel) panel.classList.remove('is-loading');
          payButton.disabled = false;
          payButton.innerHTML = `<i class="bi bi-lock-fill" aria-hidden="true"></i> Payer ${formatPrice(total)}`;
          if (panel) showInlineServiceResult(panel, 'pending');
        }
      } else {
        // ── Formation / autre : flow redirect Stripe existant ───────────────
        const { error } = await stripe.confirmPayment({
          elements,
          confirmParams: { return_url: returnUrl }
        });

        // Only reached on error (success redirects automatically)
        if (!container.isConnected) return;
        payButton.disabled = false;
        payButton.innerHTML = `<i class="bi bi-lock-fill" aria-hidden="true"></i> Payer ${formatPrice(total)}`;
        if (panel) panel.classList.remove('is-loading');
        if (errorEl && error) {
          errorEl.textContent = error.message || 'Le paiement a échoué. Veuillez réessayer.';
          errorEl.style.display = '';
        }
        showToast({ type: 'error', message: 'Paiement refusé', durationMs: 1500 });
      }
    });

    // Inject spinner keyframe if not present
    if (!document.getElementById('psm-spin-style')) {
      const style = document.createElement('style');
      style.id = 'psm-spin-style';
      style.textContent = '@keyframes psm-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  } catch (error) {
    console.error('[PaymentModule] Erreur initialisation Stripe', error);
    if (!container.isConnected) return;
    if (loaderEl) loaderEl.style.display = 'none';
    if (String(error?.code || '').trim() === 'ALREADY_PURCHASED') {
      renderAlreadyPurchasedState(container);
      return;
    }
    renderErrorState(
      container,
      error?.message || "Impossible d'initialiser le formulaire de paiement. Veuillez réessayer."
    );
  }
}
