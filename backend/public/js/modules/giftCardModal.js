const MY_CARDS_ENDPOINT = '/api/client/gift-cards/my';
const VALIDATE_ENDPOINT = '/api/client/gift-cards/validate';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatPrice(value) {
  const amount = roundToCents(Number(value || 0));
  return `${amount.toFixed(2)} ƒ'ª`;
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function formatCardCode(code) {
  const normalized = String(code || '').trim();
  if (!normalized) return 'Carte';
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function buildItemsMarkup(items) {
  if (!items.length) {
    return '<p class="module-placeholder">Aucun article sélectionné.</p>';
  }
  return `
    <div class="data-list">
      ${items
        .map(
          item => `
            <article class="data-item">
              <div>
                <strong>${escapeHtml(item.name || 'Article')}</strong>
                <p class="muted">Type : ${escapeHtml(item.type || 'Article')}</p>
                <p class="muted">Prix : ${formatPrice(item.price)}</p>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function buildModalMarkup({ totalAmount, items }) {
  return `
    <div class="gift-card-modal">
      <header class="gift-card-modal__header">
        <h2>Souhaitez-vous utiliser une ou plusieurs cartes cadeaux ?</h2>
        <button type="button" class="gift-card-modal__close" aria-label="Fermer">&times;</button>
      </header>
      <p class="muted">Montant initial : <strong>${formatPrice(totalAmount)}</strong></p>
      <div class="gift-card-modal__items" data-gift-card-items>
        ${buildItemsMarkup(items)}
      </div>
      <section class="gift-card-modal__section">
        <div class="gift-card-modal__section-header">
          <h3>Vos cartes cadeaux</h3>
          <button type="button" class="secondary-link" data-gift-card-toggle>
            Voir mes cartes cadeaux
          </button>
        </div>
        <div data-gift-card-list class="gift-card-modal__card-list">
          <p class="module-placeholder">
            Cliquez sur “Voir mes cartes cadeaux” pour afficher la liste.
          </p>
        </div>
      </section>
      <section class="gift-card-modal__section">
        <h3>Entrer un code de carte cadeau</h3>
        <label class="gift-card-modal__field">
          Code
          <input type="text" name="code" autocomplete="off" maxlength="32" placeholder="XXXX-XXXX" data-gift-card-code-input>
        </label>
        <div class="form-actions" style="gap:0.5rem;">
          <button type="button" class="secondary-button" data-gift-card-validate>Valider le code</button>
          <button type="button" class="secondary-link" data-gift-card-add>Ajouter une autre carte cadeau</button>
        </div>
        <p class="muted" data-gift-card-code-feedback></p>
      </section>
      <section class="gift-card-modal__summary">
        <p>Montant couvert : <strong data-gift-card-used>${formatPrice(0)}</strong></p>
        <p>Montant restant : <strong data-gift-card-remaining>${formatPrice(totalAmount)}</strong></p>
        <div data-gift-card-used-list>
          <p class="module-placeholder">Aucune carte utilisée.</p>
        </div>
      </section>
      <p class="form-message" data-gift-card-feedback></p>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-gift-card-pay>Payer le reste par carte bancaire</button>
        <button type="button" class="primary-button" data-gift-card-validate-usage disabled>Valider l'utilisation des cartes</button>
      </div>
    </div>
  `;
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function openGiftCardModal({ items = [], totalAmount: providedTotal }) {
  const computedTotal = Number.isFinite(Number(providedTotal))
    ? Number(providedTotal)
    : items.reduce((sum, entry) => sum + Number(entry.price || 0), 0);
  const normalizedTotal = Math.max(0, roundToCents(computedTotal));
  return new Promise(async (resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'gift-card-modal-overlay';
    overlay.innerHTML = buildModalMarkup({ totalAmount: normalizedTotal, items });
    document.body.appendChild(overlay);
    const modal = overlay.querySelector('.gift-card-modal');
    const cardsContainer = overlay.querySelector('[data-gift-card-list]');
    const summaryUsed = overlay.querySelector('[data-gift-card-used]');
    const summaryRemaining = overlay.querySelector('[data-gift-card-remaining]');
    const summaryList = overlay.querySelector('[data-gift-card-used-list]');
    const feedback = overlay.querySelector('[data-gift-card-feedback]');
    const cardToggleButton = overlay.querySelector('[data-gift-card-toggle]');
    const codeInput = overlay.querySelector('[data-gift-card-code-input]');
    const codeFeedback = overlay.querySelector('[data-gift-card-code-feedback]');
    const validateCodeButton = overlay.querySelector('[data-gift-card-validate]');
    const addCardButton = overlay.querySelector('[data-gift-card-add]');
    const payButton = overlay.querySelector('[data-gift-card-pay]');
    const coverButton = overlay.querySelector('[data-gift-card-validate-usage]');
    const closeButton = overlay.querySelector('.gift-card-modal__close');
    const state = {
      cards: [],
      usages: new Map(),
      totalAmount: normalizedTotal,
      cardsVisible: false,
      cardsLoaded: false,
      cardsLoading: false,
      cardsError: ''
    };

    function cleanup() {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (overlay.querySelector('.gift-card-modal__card-confirmation-overlay')) {
          return;
        }
        cleanup();
        reject(new Error('Op?ration annul?e.'));
      }
    }

    function setFeedback(message) {
      if (!feedback) return;
      feedback.textContent = message || '';
    }

    function setCodeFeedback(message) {
      if (!codeFeedback) return;
      codeFeedback.textContent = message || '';
    }

    function gatherGiftCardUsage(excludeCode) {
      return Array.from(state.usages.entries())
        .filter(([, amount]) => amount > 0)
        .filter(([code]) => !excludeCode || code !== excludeCode)
        .map(([code, amount]) => ({ code, amount }));
    }

    function updateSummary() {
      const coverage = roundToCents(
        Array.from(state.usages.values()).reduce((sum, amount) => sum + Number(amount || 0), 0)
      );
      const normalizedCoverage = Math.min(state.totalAmount, coverage);
      const remaining = Math.max(0, roundToCents(state.totalAmount - normalizedCoverage));
      if (summaryUsed) summaryUsed.textContent = formatPrice(normalizedCoverage);
      if (summaryRemaining) summaryRemaining.textContent = formatPrice(remaining);
      if (summaryList) {
        const usageList = gatherGiftCardUsage();
        summaryList.innerHTML = usageList.length
          ? usageList
              .map(
                entry => `
                  <div class="gift-card-modal__summary-item" data-summary-card="${escapeHtml(
                    entry.code
                  )}">
                    <p class="muted">
                      ${escapeHtml(entry.code)} → ${formatPrice(entry.amount)}
                    </p>
                    <button type="button" class="secondary-link" data-gift-card-remove>
                      Annuler
                    </button>
                  </div>
                `
              )
              .join('')
          : '<p class="module-placeholder">Aucune carte utilisee.</p>';
        attachSummaryHandlers();
      }
      coverButton.disabled = normalizedCoverage < state.totalAmount;
    }

    function attachSummaryHandlers() {
      if (!summaryList) return;
      const buttons = summaryList.querySelectorAll('[data-gift-card-remove]');
      buttons.forEach(button => {
        button.addEventListener('click', () => {
          const row = button.closest('[data-summary-card]');
          const code = row?.dataset.summaryCard;
          if (code) {
            state.usages.delete(code);
          }
          updateSummary();
          renderCards();
        });
      });
    }

    function renderCards() {
      if (!cardsContainer) return;
      if (!state.cardsVisible) {
        cardsContainer.innerHTML =
          '<p class="module-placeholder">Cliquez sur "Voir mes cartes cadeaux" pour afficher la liste.</p>';
        return;
      }
      if (state.cardsLoading) {
        cardsContainer.innerHTML =
          '<p class="module-placeholder">Chargement des cartes cadeaux...</p>';
        return;
      }
      if (state.cardsError) {
        cardsContainer.innerHTML = `<p class="module-placeholder">${escapeHtml(state.cardsError)}</p>`;
        return;
      }
      if (!state.cards.length) {
        cardsContainer.innerHTML = '<p class="module-placeholder">Aucune carte cadeau disponible.</p>';
        return;
      }
      cardsContainer.innerHTML = state.cards
        .map(card => {
          const balance = roundToCents(Number(card.balance || 0));
          const used = state.usages.get(card.code) || 0;
          const truncatedCode = formatCardCode(card.code);
          return `
            <article class="data-item gift-card-modal__card-row" data-gift-card-code="${escapeHtml(
              card.code
            )}" tabindex="0" role="button">
              <div>
                <strong>${escapeHtml(truncatedCode)}</strong>
                <p class="muted">Solde : ${formatPrice(balance)}</p>
                <p class="muted">Achat : ${formatDate(card.purchasedAt || card.createdAt)}</p>
                <p class="muted gift-card-modal__card-hint">Cliquez pour utiliser cette carte.</p>
              </div>
              ${used ? `<p class="muted gift-card-modal__card-used">Montant reserve : ${formatPrice(
                used
              )}</p>` : ''}
            </article>
          `;
        })
        .join('');
    }


    function updateCardsToggleButton() {
      if (!cardToggleButton) return;
      cardToggleButton.textContent = state.cardsVisible
        ? 'Masquer mes cartes cadeaux'
        : 'Voir mes cartes cadeaux';
    }

    function setCardListVisibility(visible) {
      state.cardsVisible = visible;
      if (visible) {
        state.cardsError = '';
      }
      updateCardsToggleButton();
      renderCards();
      if (visible && !state.cardsLoaded && !state.cardsLoading) {
        hydrateCards();
      }
    }


    function openCardConfirmation(card) {
      if (!card || !overlay) return;
      const coverageWithoutCard = roundToCents(
        gatherGiftCardUsage(card.code).reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
      );
      const remainingBefore = Math.max(0, roundToCents(state.totalAmount - coverageWithoutCard));
      const balance = roundToCents(Number(card.balance || 0));
      const usageAmount = Math.min(balance, remainingBefore);
      const balanceAfter = Math.max(0, roundToCents(balance - usageAmount));
      const remainingToPay = Math.max(0, roundToCents(remainingBefore - usageAmount));
      const note = remainingToPay > 0
        ? 'Vous pourrez utiliser plusieurs cartes cadeau pour cet achat.'
        : 'Cette carte couvre la totalite du montant restant.';
      const truncatedCode = formatCardCode(card.code);
      const confirmationOverlay = document.createElement('div');
      confirmationOverlay.className = 'gift-card-modal__card-confirmation-overlay';
      confirmationOverlay.innerHTML = `
        <div class="gift-card-modal__card-confirmation">
          <header class="gift-card-modal__card-confirmation-header">
            <h3>Souhaitez-vous utiliser cette carte ?</h3>
            <button type="button" class="gift-card-modal__close" data-card-confirm-close aria-label="Fermer">&times;</button>
          </header>
          <div class="gift-card-modal__card-confirmation-content">
            <p class="muted">Carte ${escapeHtml(truncatedCode)}</p>
            <ul class="gift-card-modal__card-confirmation-list">
              <li>Solde restant : ${formatPrice(balance)}</li>
              <li>Montant utilise : ${formatPrice(usageAmount)}</li>
              <li>Solde apres utilisation : ${formatPrice(balanceAfter)}</li>
              <li>Montant restant a payer : ${formatPrice(remainingToPay)}</li>
            </ul>
            <p class="muted">${note}</p>
          </div>
          <div class="form-actions">
            <button type="button" class="secondary-link" data-card-confirm-cancel>Annuler</button>
            <button type="button" class="primary-button" data-card-confirm-validate ${
              usageAmount <= 0 ? 'disabled' : ''
            }>
              Valider
            </button>
          </div>
        </div>
      `;
      overlay.appendChild(confirmationOverlay);
      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        confirmationOverlay.remove();
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') {
          cleanup();
        }
      };
      confirmationOverlay.addEventListener('click', event => {
        if (event.target === confirmationOverlay) {
          cleanup();
        }
      });
      confirmationOverlay.querySelector('[data-card-confirm-cancel]')?.addEventListener('click', cleanup);
      confirmationOverlay.querySelector('[data-card-confirm-close]')?.addEventListener('click', cleanup);
      confirmationOverlay.querySelector('[data-card-confirm-validate]')?.addEventListener('click', () => {
        if (usageAmount <= 0) return;
        state.usages.set(card.code, usageAmount);
        updateSummary();
        renderCards();
        cleanup();
      });
      document.addEventListener('keydown', onKeyDown);
    }

    async function hydrateCards() {
      state.cardsLoading = true;
      state.cardsError = '';
      renderCards();
      try {
        const response = await fetch(MY_CARDS_ENDPOINT, { credentials: 'include' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Impossible de charger vos cartes.');
        }
        const cards = Array.isArray(payload.cards) ? payload.cards : [];
        state.cards = cards.filter(card => card.status === 'active' && Number(card.balance || 0) > 0);
        state.cardsLoaded = true;
      } catch (error) {
        const message = error?.message || 'Impossible de charger vos cartes.';
        state.cardsError = message;
        state.cards = [];
        setFeedback(message);
      } finally {
        state.cardsLoading = false;
        renderCards();
        updateSummary();
      }
    }

    async function validateCode() {
      const code = codeInput ? String(codeInput.value || '').trim().toUpperCase() : '';
      if (!code) {
        setCodeFeedback('Veuillez renseigner un code.');
        return;
      }
      validateCodeButton.disabled = true;
      setCodeFeedback('');
      try {
        const response = await fetch(VALIDATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code })
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || 'Impossible de valider la carte.');
        }
        const payload = await response.json().catch(() => ({}));
        if (!payload?.card) {
          throw new Error('Carte invalide.');
        }
        const exists = state.cards.some(entry => entry.code === payload.card.code);
        if (!exists) {
          state.cards = [payload.card, ...state.cards];
        }
        setCodeFeedback('Carte validée.');
        if (codeInput) {
          codeInput.value = '';
        }
        setCardListVisibility(true);
        updateSummary();
      } catch (error) {
        setCodeFeedback(error.message);
      } finally {
        validateCodeButton.disabled = false;
      }
    }

    function resolveWithSelection() {
      const payload = gatherGiftCardUsage();
      cleanup();
      resolve(payload);
    }

    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        cleanup();
        reject(new Error('Opération annulée.'));
      }
    });

    closeButton?.addEventListener('click', () => {
      cleanup();
      reject(new Error('Opération annulée.'));
    });

    addCardButton?.addEventListener('click', () => {
      codeInput?.focus();
    });

    cardToggleButton?.addEventListener('click', () => {
      setCardListVisibility(!state.cardsVisible);
    });

    cardsContainer?.addEventListener('click', event => {
      if (!state.cardsVisible) return;
      const row = event.target.closest('[data-gift-card-code]');
      if (!row) return;
      const code = row.dataset.giftCardCode;
      const card = state.cards.find(entry => entry.code === code);
      if (!card) return;
      openCardConfirmation(card);
    });

    cardsContainer?.addEventListener('keydown', event => {
      if (!state.cardsVisible) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-gift-card-code]');
      if (!row) return;
      event.preventDefault();
      const code = row.dataset.giftCardCode;
      const card = state.cards.find(entry => entry.code === code);
      if (!card) return;
      openCardConfirmation(card);
    });

    payButton?.addEventListener('click', () => {
      resolveWithSelection();
    });

    coverButton?.addEventListener('click', () => {
      resolveWithSelection();
    });

    validateCodeButton?.addEventListener('click', () => {
      validateCode();
    });

    updateCardsToggleButton();
    renderCards();

    document.addEventListener('keydown', onKeyDown);
    updateSummary();
  });
}
