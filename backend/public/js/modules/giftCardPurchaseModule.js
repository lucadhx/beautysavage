import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { showToast } from '../helpers/toastService.js';
import { getSiteStatus, isSiteBlockedForUser } from '../helpers/siteStatusClient.js';
import { createCheckoutStateToken } from './purchaseFlowService.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';

const CONFIG_ENDPOINT = '/api/vitrine/gift-cards';
const PAYMENT_MIN_DISPLAY_MS = 500;
const AMOUNT_STEP = 10;
const DEFAULT_MIN_AMOUNT = 50;
const SUSPENDED_PURCHASE_MESSAGE =
  'Nous rencontrons quelques soucis, l achat est temporairement indisponible.';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const hasDecimals = Math.abs(amount % 1) > 0.0001;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  }).format(amount);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureMinimumDisplay(startedAt, minDelay = PAYMENT_MIN_DISPLAY_MS) {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= minDelay) return;
  await wait(minDelay - elapsed);
}

function normalizeMinAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return DEFAULT_MIN_AMOUNT;
  }
  return Math.round(amount * 100) / 100;
}

function parseAmount(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (!normalized) return Number.NaN;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return Number.NaN;
  return Math.round(amount * 100) / 100;
}

function isAmountValid(amount, minAmount) {
  return Number.isFinite(amount) && amount >= minAmount;
}

function coerceAmount(value, minAmount) {
  const parsed = parseAmount(value);
  if (!Number.isFinite(parsed) || parsed < minAmount) {
    return minAmount;
  }
  return Math.round(parsed * 100) / 100;
}

function getSafeAmountForStep(value, minAmount) {
  return isAmountValid(value, minAmount) ? value : minAmount;
}

function buildStandaloneLoader(message = 'Chargement de la carte cadeau...') {
  return `
    <section class="gcpv-shell gcpv-shell--loading" aria-busy="true" aria-live="polite">
      <div class="gcpv-loader">
        <div class="gcpv-loader__paws" aria-hidden="true">
          <span class="gcpv-loader__paw">${PAW_ICON_SVG}</span>
          <span class="gcpv-loader__paw gcpv-loader__paw--delay-1">${PAW_ICON_SVG}</span>
          <span class="gcpv-loader__paw gcpv-loader__paw--delay-2">${PAW_ICON_SVG}</span>
        </div>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  `;
}

function buildOverlayLoader(message = 'Traitement de votre achat...') {
  return `
    <div class="gcpv-overlay-loader__inner" role="status" aria-live="polite" aria-busy="true">
      <div class="gcpv-loader__paws" aria-hidden="true">
        <span class="gcpv-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcpv-loader__paw gcpv-loader__paw--delay-1">${PAW_ICON_SVG}</span>
        <span class="gcpv-loader__paw gcpv-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-forbidden">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildImageMarkup(config) {
  const image = String(config?.image || '').trim();
  if (image) {
    return `
      <div class="gcpv-hero__media-frame">
        <img
          class="gcpv-hero__image"
          src="${escapeHtml(image)}"
          alt="Carte cadeau ${escapeHtml(config?.title || 'Beauty Savage')}"
          loading="lazy"
        >
      </div>
    `;
  }

  return `
    <div class="gcpv-hero__media-frame gcpv-hero__media-frame--fallback" aria-hidden="true">
      <div class="gcpv-hero__fallback">
        <i class="bi bi-gift"></i>
      </div>
    </div>
  `;
}

function buildModuleMarkup(config, amount, siteBlocked) {
  const title = String(config?.title || 'Acheter une carte cadeau').trim() || 'Acheter une carte cadeau';
  const description = String(config?.description || '').trim();
  const minAmount = normalizeMinAmount(config?.minAmount);

  return `
    <section class="gcpv-shell" data-gcpv-root data-acquisition-card>
      <div class="gcpv-surface" data-payment-flow>
        <div class="gcpv-hero">
          <div class="gcpv-hero__content gcpv-reveal">
            <p class="gcpv-hero__eyebrow">Carte cadeau</p>
            <h2 class="gcpv-hero__title">${escapeHtml(title)}</h2>
            <p class="gcpv-hero__lead">
              Offrez un montant libre et laissez la personne choisir sa prochaine formation ou son prochain produit.
            </p>
            <p class="gcpv-hero__price">A partir de ${escapeHtml(formatPrice(minAmount))}</p>
            ${
              description
                ? `<p class="gcpv-hero__description">${escapeHtml(description)}</p>`
                : ''
            }
          </div>
          <div class="gcpv-hero__media gcpv-reveal">
            ${buildImageMarkup(config)}
          </div>
        </div>

        <section class="gcpv-config gcpv-reveal" aria-label="Configurer le montant">
          <div class="gcpv-config__header">
            <div>
              <p class="gcpv-config__eyebrow">Montant personalise</p>
              <h3>Choisissez la valeur de votre carte</h3>
            </div>
            <p class="gcpv-config__minimum">Minimum autorise: ${escapeHtml(formatPrice(minAmount))}</p>
          </div>

          <div class="gcpv-amount" data-gcpv-amount-shell>
            <button
              type="button"
              class="gcpv-amount__step"
              data-amount-step="-${AMOUNT_STEP}"
              aria-label="Retirer ${AMOUNT_STEP} euros"
              ${siteBlocked ? 'disabled' : ''}
            >
              <i class="bi bi-dash-lg" aria-hidden="true"></i>
            </button>
            <label class="gcpv-amount__field">
              <span class="sr-only">Montant de la carte cadeau</span>
              <input
                type="number"
                inputmode="decimal"
                class="gcg-minimal-input gcpv-amount__input"
                name="gift-card-amount"
                value="${escapeHtml(String(amount))}"
                min="${escapeHtml(String(minAmount))}"
                step="${AMOUNT_STEP}"
                ${siteBlocked ? 'disabled' : ''}
              >
              <span class="gcpv-amount__currency">EUR</span>
            </label>
            <button
              type="button"
              class="gcpv-amount__step"
              data-amount-step="${AMOUNT_STEP}"
              aria-label="Ajouter ${AMOUNT_STEP} euros"
              ${siteBlocked ? 'disabled' : ''}
            >
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
            </button>
          </div>

          <div class="gcpv-amount__summary">
            <p class="gcpv-amount__summary-label">Montant selectionne</p>
            <p class="gcpv-amount__summary-value" data-gcpv-amount-preview>${escapeHtml(
              formatPrice(amount)
            )}</p>
          </div>

          <p class="gcpv-feedback" data-gcpv-feedback ${siteBlocked ? 'data-status="error"' : ''}>
            ${
              siteBlocked
                ? escapeHtml(SUSPENDED_PURCHASE_MESSAGE)
                : 'Le montant peut etre ajuste avec les boutons ou saisi manuellement.'
            }
          </p>

          <button
            class="primary-button gcpv-cta"
            type="button"
            data-purchase-button
            ${siteBlocked ? 'disabled' : ''}
          >
            Acheter cette carte cadeau
          </button>
        </section>

        <div class="gcpv-overlay-loader" data-payment-loader hidden>
          ${buildOverlayLoader()}
        </div>
      </div>
    </section>
  `;
}

function setPaymentLoading(container, isLoading) {
  const flow = container?.querySelector('[data-payment-flow]');
  const loader = container?.querySelector('[data-payment-loader]');
  if (!flow || !loader) return;
  flow.classList.toggle('gcpv-surface--loading', Boolean(isLoading));
  loader.hidden = !isLoading;
}

function setFeedback(container, message, status = '') {
  if (!container) return;
  container.textContent = message || '';
  if (status) {
    container.dataset.status = status;
  } else {
    delete container.dataset.status;
  }
}

async function fetchConfig() {
  const response = await fetch(CONFIG_ENDPOINT, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Impossible de charger les informations.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Configuration inaccessible.');
  }
  return payload.config || {};
}

function resolveCurrentSlug(context = {}) {
  const query = context?.query && typeof context.query === 'object' ? context.query : {};
  const params = new URLSearchParams(window.location.search);
  const candidate = String(query?.page || query?.slug || params.get('page') || params.get('slug') || '')
    .trim()
    .toLowerCase();
  return candidate || 'gift-card-purchase';
}

function buildGiftCardCheckoutState(amount, context = {}) {
  const roundedAmount = Math.round(Number(amount || 0) * 100) / 100;
  const item = {
    type: 'gift-card',
    id: 'gift-card',
    name: 'Carte cadeau',
    amount: roundedAmount,
    recipientName: '',
    recipientEmail: '',
    message: ''
  };
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    item,
    items: [item],
    appliedGiftCards: [],
    totals: {
      basePrice: roundedAmount,
      discountAmount: 0,
      subtotal: roundedAmount,
      giftCardUsed: 0,
      remainingToPay: roundedAmount
    },
    legal: {
      acceptedCgv: true,
      waiverRequired: false,
      waiverAccepted: false,
      waiverText: '',
      dateFormation: null
    },
    waiver: {
      required: false,
      accepted: false
    },
    paymentProvider: 'stripe',
    paymentIntentId: null,
    origin: {
      slug: resolveCurrentSlug(context),
      query: {}
    }
  };
}

function startStripeGiftCardCheckout(amount, context = {}) {
  const checkoutState = buildGiftCardCheckoutState(amount, context);
  const token = createCheckoutStateToken(checkoutState);
  if (!token) {
    const error = new Error('Impossible d ouvrir le paiement.');
    error.code = 'CHECKOUT_TOKEN_CREATION_FAILED';
    throw error;
  }
  requestVitrineNavigation('payment', {
    source: 'gift-card-payment',
    skipThrottle: true,
    query: { checkoutToken: token }
  });
}

function syncAmountUi(container, minAmount, { notice = '', preserveValidNotice = false } = {}) {
  const amountInput = container?.querySelector('input[name="gift-card-amount"]');
  const purchaseButton = container?.querySelector('[data-purchase-button]');
  const preview = container?.querySelector('[data-gcpv-amount-preview]');
  const feedback = container?.querySelector('[data-gcpv-feedback]');
  if (!amountInput || !purchaseButton || !preview || !feedback) return { amount: minAmount, valid: true };

  const amount = parseAmount(amountInput.value);
  const valid = isAmountValid(amount, minAmount);
  const previewAmount = valid ? amount : minAmount;
  preview.textContent = formatPrice(previewAmount);
  purchaseButton.disabled = Boolean(purchaseButton.dataset.siteBlocked === 'true') || !valid;

  if (notice) {
    setFeedback(feedback, notice, valid ? 'info' : 'error');
  } else if (!valid) {
    setFeedback(
      feedback,
      `Le montant doit etre superieur ou egal a ${formatPrice(minAmount)}.`,
      'error'
    );
  } else if (!preserveValidNotice) {
    setFeedback(
      feedback,
      'Le montant peut etre ajuste avec les boutons ou saisi manuellement.',
      'info'
    );
  }

  return { amount, valid };
}

function setupInteractions(container, config, context = {}) {
  const minAmount = normalizeMinAmount(config?.minAmount);
  const amountInput = container.querySelector('input[name="gift-card-amount"]');
  const purchaseButton = container.querySelector('[data-purchase-button]');
  const feedback = container.querySelector('[data-gcpv-feedback]');
  const siteBlocked = isSiteBlockedForUser(context.siteStatus, context.user);

  if (!amountInput || !purchaseButton || !feedback) return;

  purchaseButton.dataset.siteBlocked = siteBlocked ? 'true' : 'false';

  const applySoftCorrection = () => {
    const correctedAmount = coerceAmount(amountInput.value, minAmount);
    const currentAmount = parseAmount(amountInput.value);
    amountInput.value = String(correctedAmount);
    const notice =
      !Number.isFinite(currentAmount) || currentAmount < minAmount
        ? `Montant ajuste au minimum autorise (${formatPrice(minAmount)}).`
        : '';
    syncAmountUi(container, minAmount, { notice, preserveValidNotice: false });
  };

  container.querySelectorAll('[data-amount-step]').forEach(button => {
    button.addEventListener('click', () => {
      const delta = Number(button.getAttribute('data-amount-step') || 0);
      const currentAmount = getSafeAmountForStep(parseAmount(amountInput.value), minAmount);
      const nextAmount = Math.max(minAmount, currentAmount + delta);
      amountInput.value = String(Math.round(nextAmount * 100) / 100);
      syncAmountUi(container, minAmount);
    });
  });

  amountInput.addEventListener('input', () => {
    syncAmountUi(container, minAmount);
  });

  amountInput.addEventListener('blur', applySoftCorrection);

  purchaseButton.addEventListener('click', async () => {
    if (siteBlocked) {
      setFeedback(feedback, SUSPENDED_PURCHASE_MESSAGE, 'error');
      showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
      return;
    }

    const { amount, valid } = syncAmountUi(container, minAmount);
    if (!valid) {
      applySoftCorrection();
      return;
    }

    purchaseButton.disabled = true;
    setFeedback(feedback, '', '');
    const paymentStartedAt = Date.now();
    setPaymentLoading(container, true);

    try {
      startStripeGiftCardCheckout(amount, context);
      await ensureMinimumDisplay(paymentStartedAt);
      return;
    } catch (error) {
      if (error?.code === 'SITE_SUSPENDED') {
        showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
      }
      await ensureMinimumDisplay(paymentStartedAt);
      setPaymentLoading(container, false);
      setFeedback(feedback, error?.message || 'Erreur lors de la commande.', 'error');
      purchaseButton.disabled = false;
      return;
    }
  });

  if (siteBlocked) {
    syncAmountUi(container, minAmount, {
      notice: SUSPENDED_PURCHASE_MESSAGE,
      preserveValidNotice: true
    });
    return;
  }

  syncAmountUi(container, minAmount);
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  container.innerHTML = buildStandaloneLoader();

  try {
    const [config, siteStatus] = await Promise.all([fetchConfig(), getSiteStatus()]);
    const normalizedConfig = {
      ...config,
      minAmount: normalizeMinAmount(config?.minAmount)
    };
    container.innerHTML = buildModuleMarkup(
      normalizedConfig,
      normalizedConfig.minAmount,
      isSiteBlockedForUser(siteStatus, context?.user)
    );
    setupInteractions(container, normalizedConfig, {
      ...context,
      siteStatus
    });
  } catch (error) {
    buildStatus(container, error.message || 'Impossible de charger la carte cadeau.');
  }
}
