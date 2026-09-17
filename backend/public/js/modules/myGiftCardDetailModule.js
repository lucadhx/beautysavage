const DETAIL_ENDPOINT = id => `/api/client/gift-cards/${id}`;

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
  return `${amount.toFixed(2)} €`;
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildTransactions(transactions) {
  if (!transactions.length) {
    return '<p class="module-placeholder">Aucune utilisation enregistrée.</p>';
  }
  return `
    <div class="data-list">
      ${transactions
        .map(
          txn => `
            <article class="data-item">
              <div>
                <strong>${escapeHtml(txn.saleId || 'Paiement')}</strong>
                <p class="muted">Montant : ${formatPrice(txn.amount)}</p>
                <p class="muted">${escapeHtml(txn.usedByLabel || 'Utilisation')}</p>
                <p class="muted">Solde avant : ${formatPrice(txn.balanceBefore)}</p>
                <p class="muted">Solde après : ${formatPrice(txn.balanceAfter)}</p>
                <p class="muted">Date : ${new Date(txn.createdAt).toLocaleString()}</p>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

async function fetchDetail(cardId) {
  const response = await fetch(DETAIL_ENDPOINT(cardId), { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Impossible de lire la carte.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload.ok) {
    throw new Error(payload.error || 'Impossible de lire la carte.');
  }
  return {
    card: payload.card,
    transactions: Array.isArray(payload.transactions) ? payload.transactions : []
  };
}

export async function renderPage(container) {
  if (!container) return;
  const params = new URLSearchParams(window.location.search);
  const cardId = params.get('id');
  if (!cardId) {
    renderStatus(container, 'Carte manquante.');
    return;
  }
  container.innerHTML = '<p class="module-placeholder">Chargement de la carte...</p>';
  try {
    const { card, transactions } = await fetchDetail(cardId);
    container.innerHTML = `
      <div class="module-panel">
        <header>
          <h2>Carte ${escapeHtml(card.code)}</h2>
          <p class="muted">Solde : ${formatPrice(card.balance)} / ${formatPrice(card.amount)}</p>
        </header>
        <section class="manager-section">
          <div class="form-actions">
            <a class="secondary-button" href="/vitrine.html?page=my-gift-cards">Retour</a>
          </div>
          <div class="data-list">
            <article class="data-item">
              <div>
                <p class="muted">Statut : ${escapeHtml(card.status)}</p>
                <p class="muted">Achat : ${new Date(card.purchasedAt || card.createdAt).toLocaleString()}</p>
              </div>
            </article>
          </div>
          <h3>Historique des utilisations</h3>
          ${buildTransactions(transactions)}
        </section>
      </div>
    `;
  } catch (error) {
    renderStatus(container, error.message);
  }
}
