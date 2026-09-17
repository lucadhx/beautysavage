const PRESENTIEL_ENDPOINT = '/api/client/me/presentiel';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSessionDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date inconnue';
  }
  return date.toLocaleString();
}

function buildPresentielScheduleHtml(schedule = []) {
  if (!Array.isArray(schedule) || !schedule.length) {
    return '<p class="muted">Horaires non definis.</p>';
  }
  return schedule
    .map(entry => `<p class="muted">Jour ${entry.dayIndex} : ${escapeHtml(entry.startTime)} - ${escapeHtml(entry.endTime)}</p>`)
    .join('');
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderSessionItem(session) {
  const dateLabel = formatSessionDate(session.startDate);
  const durationLabel =
    session.durationLabel || `${session.durationDays ?? 1} jour${session.durationDays > 1 ? 's' : ''}`;
  const scheduleHtml = buildPresentielScheduleHtml(session.schedule);
  const remaining = Number.isFinite(session.placesRemaining)
    ? session.placesRemaining
    : Math.max(0, (session.maxClients || 0) - (session.reservedCount || 0));
  const statusLabel = session.isAvailable ? 'Disponible' : 'Indisponible (complet)';
  const capacityLabel = `Capacite ${session.maxClients} · Reservés ${session.reservedCount} · Restantes ${remaining}`;
  return `
    <article class="data-item">
      <div>
        <strong>${escapeHtml(dateLabel)}</strong>
        <p class="muted">Durée : ${escapeHtml(durationLabel)}</p>
        ${scheduleHtml}
        <p class="muted">${escapeHtml(capacityLabel)}</p>
        <p class="muted">${escapeHtml(statusLabel)}</p>
      </div>
    </article>
  `;
}


function renderSessionCard(container, purchase) {
  if (!container || !purchase) return;
  const session = purchase.session;
  const formation = purchase.formation;
  container.innerHTML = `
    <div class="module-panel">
      <header>
        <h2>Session réservée</h2>
        <p>Formation : ${escapeHtml(formation?.name || '—')}</p>
      </header>
      <section class="manager-section">
        <div class="data-list">
          ${session ? renderSessionItem(session) : '<li class="module-placeholder">Session introuvable.</li>'}
        </div>
      </section>
    </div>
  `;
}

async function loadReservedSession() {
  const response = await fetch(PRESENTIEL_ENDPOINT, { credentials: 'include' });
  if (response.status === 401) {
    throw new Error('unauthenticated');
  }
  if (response.status === 404) {
    throw new Error('not-found');
  }
  if (!response.ok) {
    throw new Error('fetch-failed');
  }
  const payload = await response.json().catch(() => ({}));
  return payload.purchase || null;
}

export async function renderPage(container) {
  if (!container) return;
  container.innerHTML = '<p class="module-placeholder">Chargement des sessions présentiel...</p>';
  try {
    const purchase = await loadReservedSession();
    if (!purchase) {
      renderStatus(container, 'Aucune session réservée pour le moment.');
      return;
    }
    renderSessionCard(container, purchase);
  } catch (error) {
    if (error.message === 'unauthenticated') {
      renderStatus(container, 'Veuillez vous connecter pour voir votre session.');
    } else if (error.message === 'not-found') {
      renderStatus(container, 'Aucune session réservée.');
    } else {
      renderStatus(container, 'Impossible de charger la session réservée.');
      console.error('Erreur sessions présentiel', error);
    }
  }
}
