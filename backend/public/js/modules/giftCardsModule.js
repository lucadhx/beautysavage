import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API = '/api/gestion/gift-cards';
const SEARCH_DEBOUNCE_MS = 300;
const MIN_LOADER_MS = 500;
const MODAL_CLOSE_DELAY_MS = 180;

const state = {
  cards: [],
  sort: 'desc',
  search: '',
  config: null,
  listRequestId: 0,
  listAbortController: null,
  searchTimer: null
};

const escapeHtml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatPrice = value => `${(Number(value) || 0).toFixed(2)} EUR`;
const formatDate = value => {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 'Non defini' : date.toLocaleString();
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : {};
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const payload = await getJson(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Requete impossible.');
  }
  return payload || {};
}

function loaderMarkup(label = 'Chargement...') {
  return `
    <div class="gcg-inline-loader" role="status" aria-live="polite">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function mountModal(markup) {
  const overlay = document.createElement('div');
  overlay.className = 'gcg-modal-overlay';
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), MODAL_CLOSE_DELAY_MS);
}

function bindModalClose(overlay, closeFn) {
  const onEsc = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeFn();
  };
  const onOutside = event => {
    if (event.target === overlay) closeFn();
  };
  window.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', onOutside);
  return () => {
    window.removeEventListener('keydown', onEsc);
    overlay.removeEventListener('click', onOutside);
  };
}

function setSearchSortButtons(container) {
  container.querySelector('[data-action="sort-desc"]')?.classList.toggle('is-active', state.sort === 'desc');
  container.querySelector('[data-action="sort-asc"]')?.classList.toggle('is-active', state.sort === 'asc');
}

function renderCards(container) {
  if (!container) return;
  if (!state.cards.length) {
    container.innerHTML = `
      <div class="gcg-empty-state">
        <i class="bi bi-gift" aria-hidden="true"></i>
        <p>Aucune carte cadeau correspondante.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <div class="gcg-card-grid">
      ${state.cards
        .map(card => {
          const status = String(card.status || '').toLowerCase() === 'redeemed' ? 'redeemed' : 'active';
          return `
            <article class="gcg-card">
              <span class="gcg-card__icon" aria-hidden="true"><i class="bi bi-credit-card-2-front"></i></span>
              <div class="gcg-card__body">
                <div class="gcg-card__topline">
                  <strong>${escapeHtml(card.code || '---')}</strong>
                  <span class="gcg-status-badge gcg-status-badge--${status}">${status === 'active' ? 'Active' : 'Épuisée'}</span>
                </div>
                <p>Montant initial: <strong>${formatPrice(card.amount)}</strong></p>
                <p>Email acheteur: <strong>${escapeHtml(card.ownerEmail || 'Non renseigne')}</strong></p>
              </div>
              <button type="button" class="gcg-info-button" data-action="open-detail" data-card-id="${escapeHtml(
                card.id
              )}" aria-label="Details">
                <i class="bi bi-info-circle" aria-hidden="true"></i>
              </button>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

async function loadCards(container, label = 'Chargement des cartes cadeaux...') {
  const list = container.querySelector('[data-gcg-list]');
  if (!list) return;
  if (state.listAbortController) state.listAbortController.abort();
  const requestId = ++state.listRequestId;
  const controller = new AbortController();
  state.listAbortController = controller;
  const startedAt = Date.now();
  list.innerHTML = loaderMarkup(label);
  try {
    const params = new URLSearchParams({
      sort: state.sort,
      limit: '500'
    });
    if (state.search) params.set('search', state.search);
    const payload = await request(`${API}?${params.toString()}`, { signal: controller.signal });
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    if (requestId !== state.listRequestId) return;
    state.cards = Array.isArray(payload.cards) ? payload.cards : [];
    renderCards(list);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    if (requestId !== state.listRequestId) return;
    list.innerHTML = `<p class="gcg-error">${escapeHtml(error.message || 'Erreur chargement.')}</p>`;
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('GiftCardsModule:LoadCards', error, { search: state.search, sort: state.sort });
  } finally {
    if (state.listAbortController === controller) state.listAbortController = null;
  }
}

function openDetailsModal(cardId) {
  const overlay = mountModal(`
    <div class="gcg-modal-panel gcg-modal-panel--detail" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>Détails carte</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body" data-detail-body>${loaderMarkup('Chargement des détails...')}</div>
    </div>
  `);
  const cleanup = bindModalClose(overlay, () => {
    cleanup();
    closeModal(overlay);
  });
  overlay.querySelector('[data-close]')?.addEventListener('click', () => {
    cleanup();
    closeModal(overlay);
  });
  request(`${API}/${encodeURIComponent(cardId)}`)
    .then(payload => {
      const card = payload.card || {};
      const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
      const body = overlay.querySelector('[data-detail-body]');
      if (!body) return;
      body.innerHTML = `
        <div class="gcg-detail-grid">
          <p>Date d’achat: <strong>${escapeHtml(formatDate(card.purchasedAt || card.createdAt))}</strong></p>
          <p>Acheteur: <strong>${escapeHtml(card.ownerEmail || 'Non renseigné')}</strong></p>
          <p>Solde initial: <strong>${formatPrice(card.amount)}</strong></p>
          <p>Solde restant: <strong>${formatPrice(card.balance)}</strong></p>
        </div>
        <h4>Transactions</h4>
        ${transactions.length ? transactions
          .map(txn => `<article class="gcg-transaction-item"><p><strong>${escapeHtml(
              txn.transactionType === 'manual_debit' ? 'Débit manuel' : 'Utilisation checkout'
            )}</strong> - ${escapeHtml(formatDate(txn.createdAt))}</p><p>Montant: ${formatPrice(txn.amount)}</p><p>Avant: ${formatPrice(
              txn.balanceBefore
            )} | Après: ${formatPrice(txn.balanceAfter)}</p>${txn.note ? `<p>Note: ${escapeHtml(txn.note)}</p>` : ''}</article>`)
          .join('') : '<p class="gcg-empty-transactions">Aucune transaction.</p>'}
      `;
    })
    .catch(error => {
      const body = overlay.querySelector('[data-detail-body]');
      if (body) body.innerHTML = `<p class="gcg-error">${escapeHtml(error.message || 'Erreur détails.')}</p>`;
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      logUiError('GiftCardsModule:Details', error, { cardId });
    });
}

function openConfigModal(container, triggerButton) {
  setActionButtonState(triggerButton, 'loading', { loadingLabel: 'Ouverture...' });
  const load = state.config ? Promise.resolve(state.config) : request(`${API}/config`).then(p => p.config || {});
  load
    .then(config => {
      state.config = config;
      setActionButtonState(triggerButton, 'idle');
      const overlay = mountModal(`
        <div class="gcg-modal-panel gcg-modal-panel--config" role="dialog" aria-modal="true">
          <header class="gcg-modal-panel__header">
            <h3>Configurer la carte cadeau</h3>
            <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
          </header>
          <div class="gcg-modal-panel__body">
            <label class="gcg-field"><span>Montant minimum</span><input class="gcg-minimal-input" type="number" min="0" step="5" name="minAmount" value="${escapeHtml(
              config.minAmount ?? 50
            )}"></label>
            <label class="gcg-field"><span>Description</span><textarea class="gcg-minimal-input gcg-minimal-input--textarea" rows="4" name="description">${escapeHtml(
              config.description || ''
            )}</textarea></label>
            <label class="gcg-field"><span>Image URL</span><input class="gcg-minimal-input" type="url" name="image" value="${escapeHtml(
              config.image || ''
            )}"></label>
          </div>
          <div class="gcg-modal-panel__actions"><button type="button" class="gcg-outline-button" data-cancel>Annuler</button><button type="button" class="gcg-accent-button" data-save>Enregistrer</button></div>
        </div>
      `);
      const cleanup = bindModalClose(overlay, () => {
        cleanup();
        closeModal(overlay);
      });
      const close = () => {
        cleanup();
        closeModal(overlay);
      };
      overlay.querySelector('[data-close]')?.addEventListener('click', close);
      overlay.querySelector('[data-cancel]')?.addEventListener('click', close);
      overlay.querySelector('[data-save]')?.addEventListener('click', async event => {
        const saveBtn = event.currentTarget;
        const payload = {
          minAmount: Number(overlay.querySelector('[name="minAmount"]')?.value || 0),
          description: String(overlay.querySelector('[name="description"]')?.value || '').trim(),
          image: String(overlay.querySelector('[name="image"]')?.value || '').trim()
        };
        setActionButtonState(saveBtn, 'loading', { loadingLabel: 'Enregistrement...' });
        try {
          const nextConfig = await request(`${API}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          state.config = nextConfig.config || payload;
          setActionButtonState(saveBtn, 'success', { successLabel: 'Enregistre' });
          showToast({ type: 'success', message: 'Modification enregistr?e', durationMs: 1000 });
          await loadCards(container, 'Actualisation des cartes cadeaux...');
          close();
        } catch (error) {
          setActionButtonState(saveBtn, 'error', { errorLabel: '\u00c9chec' });
          showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
          logUiError('GiftCardsModule:SaveConfig', error, payload);
        }
      });
    })
    .catch(error => {
      setActionButtonState(triggerButton, 'error', { errorLabel: '\u00c9chec' });
      showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      logUiError('GiftCardsModule:OpenConfig', error);
    });
}

function openDebitModal(container, triggerButton) {
  setActionButtonState(triggerButton, 'idle');
  const local = { step: 1, code: '', password: '', amount: 0, card: null, error: '' };
  const overlay = mountModal(`<div class="gcg-modal-panel gcg-modal-panel--debit" role="dialog" aria-modal="true"><header class="gcg-modal-panel__header"><h3>Debiter une carte</h3><button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button></header><div class="gcg-modal-panel__body" data-body></div></div>`);
  const cleanup = bindModalClose(overlay, () => {
    cleanup();
    closeModal(overlay);
  });
  const close = () => {
    cleanup();
    closeModal(overlay);
  };
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  const body = overlay.querySelector('[data-body]');

  const rerender = () => {
    if (!body) return;
    if (local.step === 1) body.innerHTML = `<label class="gcg-field"><span>Code</span><input class="gcg-minimal-input" name="code" value="${escapeHtml(local.code)}"></label>${local.error ? `<p class="gcg-error">${escapeHtml(local.error)}</p>` : ''}<div class="gcg-modal-panel__actions"><button class="gcg-outline-button" data-cancel>Annuler</button><button class="gcg-accent-button" data-next-code>Valider</button></div>`;
    if (local.step === 2) body.innerHTML = `<article class="gcg-debit-preview-card"><p>Code: <strong>${escapeHtml(local.card?.code)}</strong></p><p>Email: <strong>${escapeHtml(local.card?.ownerEmail || 'Non renseigne')}</strong></p><p>Solde: <strong>${formatPrice(local.card?.balance || 0)}</strong></p></article><div class="gcg-modal-panel__actions"><button class="gcg-outline-button" data-back1>Annuler</button><button class="gcg-accent-button" data-next-pass>Valider</button></div>`;
    if (local.step === 3) body.innerHTML = `<label class="gcg-field"><span>Mot de passe</span><input class="gcg-minimal-input" type="password" name="password" value="${escapeHtml(local.password)}"></label>${local.error ? `<p class="gcg-error">${escapeHtml(local.error)}</p>` : ''}<div class="gcg-modal-panel__actions"><button class="gcg-outline-button" data-back2>Annuler</button><button class="gcg-accent-button" data-verify>Verifier</button></div>`;
    if (local.step === 4) body.innerHTML = `<p>Solde restant: <strong>${formatPrice(local.card?.balance || 0)}</strong></p><div class="gcg-amount-control"><button class="gcg-outline-button" data-minus>-10</button><input class="gcg-minimal-input gcg-minimal-input--amount" type="number" name="amount" min="0" max="${escapeHtml(local.card?.balance || 0)}" value="${escapeHtml(local.amount)}"><button class="gcg-outline-button" data-plus>+10</button></div>${local.error ? `<p class="gcg-error">${escapeHtml(local.error)}</p>` : ''}<div class="gcg-modal-panel__actions"><button class="gcg-outline-button" data-back3>Annuler</button><button class="gcg-accent-button" data-next-confirm>Debiter</button></div>`;
    if (local.step === 5) body.innerHTML = `<p>Etes-vous sur de vouloir debiter <strong>${formatPrice(local.amount)}</strong> sur la carte <strong>${escapeHtml(local.card?.code)}</strong> de <strong>${escapeHtml(local.card?.ownerEmail || 'Client')}</strong> ?</p><div class="gcg-modal-panel__actions"><button class="gcg-outline-button" data-back4>Non</button><button class="gcg-accent-button" data-confirm>Oui</button></div>`;
    bindStepActions();
  };

  const bindStepActions = () => {
    body.querySelector('[data-cancel]')?.addEventListener('click', close);
    body.querySelector('[data-back1]')?.addEventListener('click', close);
    body.querySelector('[data-back2]')?.addEventListener('click', () => {
      local.step = 1; local.error = ''; rerender();
    });
    body.querySelector('[data-back3]')?.addEventListener('click', () => {
      local.step = 2; local.error = ''; rerender();
    });
    body.querySelector('[data-back4]')?.addEventListener('click', () => {
      local.step = 4; local.error = ''; rerender();
    });
    body.querySelector('[name="code"]')?.addEventListener('input', e => {
      local.code = String(e.target?.value || '').trim().toUpperCase();
    });
    body.querySelector('[name="password"]')?.addEventListener('input', e => {
      local.password = String(e.target?.value || '').trim();
    });
    body.querySelector('[name="amount"]')?.addEventListener('input', e => {
      local.amount = Number(e.target?.value || 0);
    });
    body.querySelector('[data-minus]')?.addEventListener('click', () => {
      local.amount = Math.max(0, Number(local.amount || 0) - 10); local.error = ''; rerender();
    });
    body.querySelector('[data-plus]')?.addEventListener('click', () => {
      local.amount = Math.min(Number(local.card?.balance || 0), Number(local.amount || 0) + 10); local.error = ''; rerender();
    });
    body.querySelector('[data-next-code]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      if (!local.code) { local.error = 'Code requis.'; rerender(); return; }
      setActionButtonState(btn, 'loading', { loadingLabel: 'Recherche...' });
      try {
        const payload = await request(`${API}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: local.code }) });
        local.card = payload.card; local.amount = Number(local.card?.balance || 0); local.error = ''; local.step = 2; setActionButtonState(btn, 'success', { successLabel: 'OK' }); rerender();
      } catch (error) {
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
        setActionButtonState(btn, 'error', { errorLabel: '\u00c9chec' }); local.error = error.message || 'Aucune carte trouv?e.'; rerender(); logUiError('GiftCardsModule:Lookup', error, { code: local.code });
      }
    });
    body.querySelector('[data-next-pass]')?.addEventListener('click', () => { local.step = 3; local.error = ''; rerender(); });
    body.querySelector('[data-verify]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      if (!local.password) { local.error = 'Mot de passe requis.'; rerender(); return; }
      setActionButtonState(btn, 'loading', { loadingLabel: 'Verification...' });
      try {
        await request(`${API}/verify-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: local.code, password: local.password }) });
        local.step = 4; local.error = ''; setActionButtonState(btn, 'success', { successLabel: 'Valide' }); rerender();
      } catch (error) {
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
        setActionButtonState(btn, 'error', { errorLabel: '\u00c9chec' }); local.error = error.message || 'Mot de passe incorrect.'; rerender(); logUiError('GiftCardsModule:VerifyPassword', error, { code: local.code });
      }
    });
    body.querySelector('[data-next-confirm]')?.addEventListener('click', () => {
      const amount = Number(local.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) { local.error = 'Montant invalide.'; rerender(); return; }
      if (amount > Number(local.card?.balance || 0)) { local.error = 'Montant superieur au solde restant.'; rerender(); return; }
      local.step = 5; local.error = ''; rerender();
    });
    body.querySelector('[data-confirm]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      setActionButtonState(btn, 'loading', { loadingLabel: 'Debit...' });
      try {
        await request(`${API}/manual-debit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: local.code, password: local.password, amount: Number(local.amount || 0), note: '' }) });
        setActionButtonState(btn, 'success', { successLabel: 'Debite' });
        showToast({ type: 'success', message: 'Debit effectue', durationMs: 1000 });
        await loadCards(container, 'Actualisation des cartes cadeaux...');
        close();
      } catch (error) {
        setActionButtonState(btn, 'error', { errorLabel: '\u00c9chec' });
        local.step = 4; local.error = error.message || 'Debit impossible.'; rerender();
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
        logUiError('GiftCardsModule:ManualDebit', error, { code: local.code, amount: local.amount });
      }
    });
  };
  rerender();
}

async function handleGeneratePasswords(container, button) {
  setActionButtonState(button, 'loading', { loadingLabel: 'Analyse...' });
  try {
    const preview = await request(`${API}/generate-missing-passwords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true })
    });
    const missing = Number(preview.totalMissing || 0);
    if (!missing) {
      setActionButtonState(button, 'success', { successLabel: 'A jour' });
      showToast({ type: 'info', message: 'Aucune carte a mettre a jour', durationMs: 1000 });
      return;
    }
    setActionButtonState(button, 'idle');
    const confirm = mountModal(`<div class="gcg-modal-panel gcg-modal-panel--confirm" role="dialog" aria-modal="true"><header class="gcg-modal-panel__header"><h3>Generer les MDP</h3><p>Generer un mot de passe pour ${missing} cartes ?</p></header><div class="gcg-modal-panel__actions gcg-modal-panel__actions--confirm"><button class="gcg-outline-button" data-no>Non</button><button class="gcg-accent-button" data-yes>Oui</button></div></div>`);
    const cleanup = bindModalClose(confirm, () => {
      cleanup();
      closeModal(confirm);
    });
    confirm.querySelector('[data-no]')?.addEventListener('click', () => {
      cleanup();
      closeModal(confirm);
    });
    confirm.querySelector('[data-yes]')?.addEventListener('click', async () => {
      cleanup();
      closeModal(confirm);
      setActionButtonState(button, 'loading', { loadingLabel: 'Generation...' });
      try {
        const payload = await request(`${API}/generate-missing-passwords`, { method: 'POST' });
        const generated = Number(payload.generatedCount || 0);
        setActionButtonState(button, 'success', { successLabel: 'Genere' });
        showToast({
          type: generated > 0 ? 'success' : 'info',
          message: generated > 0 ? `${generated} MDP generes` : 'Aucune carte a mettre a jour',
          durationMs: 1000
        });
        await loadCards(container, 'Actualisation des cartes cadeaux...');
      } catch (error) {
        setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
        logUiError('GiftCardsModule:GeneratePasswords', error);
      }
    });
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('GiftCardsModule:AnalyzeMissingPasswords', error);
  }
}

function bindEvents(container) {
  const searchInput = container.querySelector('[data-gcg-search]');
  searchInput?.addEventListener('input', event => {
    state.search = String(event.target?.value || '').trim();
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadCards(container, 'Recherche des cartes cadeaux...'), SEARCH_DEBOUNCE_MS);
  });
  container.querySelector('[data-action="sort-desc"]')?.addEventListener('click', () => {
    state.sort = 'desc'; setSearchSortButtons(container); loadCards(container, 'Chargement des cartes cadeaux...');
  });
  container.querySelector('[data-action="sort-asc"]')?.addEventListener('click', () => {
    state.sort = 'asc'; setSearchSortButtons(container); loadCards(container, 'Chargement des cartes cadeaux...');
  });
  container.querySelector('[data-action="open-config"]')?.addEventListener('click', event => openConfigModal(container, event.currentTarget));
  container.querySelector('[data-action="open-debit"]')?.addEventListener('click', event => {
    setActionButtonState(event.currentTarget, 'loading', { loadingLabel: 'Ouverture...' });
    openDebitModal(container, event.currentTarget);
  });
  container.querySelector('[data-action="generate-passwords"]')?.addEventListener('click', event => handleGeneratePasswords(container, event.currentTarget));
  container.querySelector('[data-gcg-list]')?.addEventListener('click', event => {
    const detailButton = event.target.closest('[data-action="open-detail"]');
    if (!detailButton) return;
    openDetailsModal(String(detailButton.dataset.cardId || '').trim());
  });
}

function renderLayout(container) {
  container.innerHTML = `
    <section class="gcg-module">
      <header class="gcg-header">
        <div>
          <h2>Gestion cartes cadeaux</h2>
          <p>Configurez, recherchez et debitez les cartes cadeaux.</p>
        </div>
        <div class="gcg-header__actions">
          <button type="button" class="gcg-accent-button" data-action="open-config"><i class="bi bi-gear"></i><span>Configurer la carte cadeau</span></button>
          <button type="button" class="gcg-accent-button" data-action="open-debit"><i class="bi bi-credit-card-2-front"></i><span>Debiter une carte</span></button>
          <button type="button" class="gcg-minimal-action" data-action="generate-passwords"><i class="bi bi-key"></i><span>Generer les MDP</span></button>
        </div>
      </header>
      <section class="gcg-toolbar">
        <label class="gcg-search-field"><span>Recherche code ou email acheteur</span><input type="search" class="gcg-minimal-input" data-gcg-search placeholder="Code ou email"></label>
        <div class="gcg-sort-actions"><button type="button" class="gcg-sort-button is-active" data-action="sort-desc">Recent</button><button type="button" class="gcg-sort-button" data-action="sort-asc">Ancien</button></div>
      </section>
      <section class="gcg-list-wrap"><div data-gcg-list>${loaderMarkup('Chargement des cartes cadeaux...')}</div></section>
    </section>
  `;
}

export async function renderPage(container) {
  if (!container) return;
  if (state.searchTimer) {
    clearTimeout(state.searchTimer);
    state.searchTimer = null;
  }
  if (state.listAbortController) {
    state.listAbortController.abort();
    state.listAbortController = null;
  }
  state.cards = [];
  state.search = '';
  state.sort = 'desc';
  state.config = null;
  state.listRequestId = 0;

  renderLayout(container);
  bindEvents(container);
  setSearchSortButtons(container);
  await loadCards(container, 'Chargement des cartes cadeaux...');
}

export async function renderModule(container) {
  await renderPage(container);
}

export default { renderPage, renderModule };
