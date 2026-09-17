import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 10000;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0,00 EUR';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function renderShell(container) {
  container.innerHTML = `
    <section class="invoice-module">
      <article class="invoice-module__card" data-invoice-card>
        <header class="invoice-module__header">
          <p class="invoice-module__eyebrow">Facture</p>
          <h1>Suivi de votre facture</h1>
        </header>
        <div class="invoice-module__body" data-invoice-body></div>
      </article>
    </section>
  `;
}

function renderMissingToken(container) {
  container.innerHTML = `
    <section class="invoice-module">
      <article class="invoice-module__card">
        <h1>Lien de facture invalide</h1>
        <p>Le token de facture est manquant ou invalide.</p>
      </article>
    </section>
  `;
}

function renderPending(body, data = {}, attempt = 1) {
  body.innerHTML = `
    <div class="invoice-module__status invoice-module__status--pending">
      <div class="invoice-module__loader" aria-hidden="true">
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
      </div>
      <h2>Votre facture est en cours de generation</h2>
      <p>Nouvelle verification dans 10 secondes.</p>
      <p class="invoice-module__attempt">Tentative ${attempt}/${MAX_ATTEMPTS}</p>
    </div>
    <div class="invoice-module__summary">
      <p><strong>Formation</strong> : ${escapeHtml(data?.formationTitle || 'Formation')}</p>
      <p><strong>Montant</strong> : ${escapeHtml(formatAmount(data?.amount))}</p>
      <p><strong>Date d'achat</strong> : ${escapeHtml(formatDate(data?.date))}</p>
    </div>
  `;
}

function renderReady(body, data = {}) {
  body.innerHTML = `
    <div class="invoice-module__status invoice-module__status--ready">
      <h2>Facture disponible</h2>
      <p>Votre document est pret.</p>
    </div>
    <div class="invoice-module__summary">
      <p><strong>Formation</strong> : ${escapeHtml(data?.formationTitle || 'Formation')}</p>
      <p><strong>Montant</strong> : ${escapeHtml(formatAmount(data?.amount))}</p>
      <p><strong>Date d'achat</strong> : ${escapeHtml(formatDate(data?.date))}</p>
    </div>
    <a class="primary-button invoice-module__download" href="${escapeHtml(data?.invoiceUrl || '#')}" target="_blank" rel="noreferrer noopener">
      Telecharger ma facture
    </a>
  `;
}

function renderPendingTimeout(body, data = {}) {
  body.innerHTML = `
    <div class="invoice-module__status invoice-module__status--warning">
      <h2>Facture en cours</h2>
      <p>Si votre facture n'apparait pas, contactez le support.</p>
    </div>
    <div class="invoice-module__summary">
      <p><strong>Formation</strong> : ${escapeHtml(data?.formationTitle || 'Formation')}</p>
      <p><strong>Montant</strong> : ${escapeHtml(formatAmount(data?.amount))}</p>
      <p><strong>Date d'achat</strong> : ${escapeHtml(formatDate(data?.date))}</p>
    </div>
  `;
}

function renderError(body, message) {
  body.innerHTML = `
    <div class="invoice-module__status invoice-module__status--error">
      <h2>Impossible de charger la facture</h2>
      <p>${escapeHtml(message || 'Une erreur est survenue.')}</p>
    </div>
  `;
}

async function fetchInvoiceStatus(token) {
  const response = await fetch(`/api/invoice/${encodeURIComponent(token)}`, {
    credentials: 'include'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Facture introuvable.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  const params = new URLSearchParams(window.location.search);
  const query = context?.query || {};
  const token = String(query.token || params.get('token') || '').trim();
  if (!token) {
    renderMissingToken(container);
    return;
  }

  renderShell(container);
  const body = container.querySelector('[data-invoice-body]');
  if (!body) return;

  let lastPayload = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = await fetchInvoiceStatus(token);
      lastPayload = payload;
      if (payload.ready && payload.invoiceUrl) {
        renderReady(body, payload);
        return;
      }
      if (attempt < MAX_ATTEMPTS) {
        renderPending(body, payload, attempt);
        await wait(POLL_INTERVAL_MS);
        continue;
      }
      renderPendingTimeout(body, payload);
      return;
    } catch (error) {
      if (error?.status === 404) {
        renderError(body, "Facture introuvable pour ce lien.");
        return;
      }
      renderError(body, error?.message || 'Erreur temporaire.');
      return;
    }
  }

  renderPendingTimeout(body, lastPayload || {});
}

