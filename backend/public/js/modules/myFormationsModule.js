import { renderEmptyState } from './emptyStateHelper.js';
import {
  ACQUISITION_PAGES,
  resetAcquisitionNotifications
} from './acquisitionNotificationService.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

let loadedFormations = [];

const CURRENCY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  return CURRENCY.format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function buildInlinePawLoader(message = 'Chargement...') {
  return `
    <div class="myf-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="myf-inline-loader__paws" aria-hidden="true">
        <span class="myf-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="myf-inline-loader__paw myf-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="myf-inline-loader__paw myf-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="myf-inline-loader__label">${escapeHtml(message)}</p>
    </div>
  `;
}

function resolveFormationType(rawType = '') {
  const normalized = String(rawType || '').trim().toLowerCase();
  return normalized === 'presentiel' ? 'presentiel' : 'distanciel';
}

function resolveFormationTypeLabel(rawType = '') {
  return resolveFormationType(rawType) === 'presentiel' ? 'Présentielle' : 'Distancielle';
}

function resolveProgressPercent(entry = {}, formation = {}) {
  const raw = Number(entry?.progressPercent ?? entry?.progress ?? formation?.progressPercent ?? NaN);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderTable(container, entries) {
  if (!container) return;
  if (!entries.length) {
    renderEmptyState(container, {
      iconClass: 'bi bi-mortarboard',
      title: 'Aucune formation',
      description: 'Vous n’avez pas encore acheté de formation',
      action: { label: 'Voir les formations', slug: 'shop' }
    });
    return;
  }

  container.innerHTML = `
    <ul class="myf-formation-list">
      ${entries
        .map((item, index) => {
          const formation = item?.formation && typeof item.formation === 'object' ? item.formation : null;
          const participationStatus = String(item?.participationStatus || 'active').trim().toLowerCase();
          const isCanceled = participationStatus === 'canceled';
          const isDeleted = !String(formation?.id || '').trim();
          const cover = String(formation?.coverImage || '').trim();
          const type = isDeleted ? '' : resolveFormationType(formation?.type);
          const typeLabel = isDeleted
            ? 'Formation supprimée'
            : isCanceled
              ? 'Formation annulée'
              : resolveFormationTypeLabel(formation?.type);
          const description = isDeleted
            ? 'Cette formation a été supprimée et n’est plus accessible.'
            : isCanceled
              ? 'Cette formation a été annulée. L’archive d’achat est conservée comme preuve.'
              : String(formation?.previewDescription || formation?.description || '').trim();
          const progressPercent = isDeleted || isCanceled ? null : resolveProgressPercent(item, formation || {});
          const canOpen = !isDeleted && !isCanceled && String(formation?.id || '').trim();
          return `
            <li class="myf-formation-card ${isDeleted ? 'is-deleted' : ''} ${isCanceled ? 'is-canceled' : ''}" data-formation-index="${index}">
              <div class="myf-formation-card__cover">
                ${
                  cover
                    ? `<img src="${escapeHtml(cover)}" alt="Couverture ${escapeHtml(formation?.name || 'formation')}" loading="lazy">`
                    : `<span class="myf-formation-card__cover-fallback"><i class="bi bi-image" aria-hidden="true"></i></span>`
                }
              </div>
              <div class="myf-formation-card__body">
                <div class="myf-formation-card__meta-row">
                  <span class="myf-formation-card__type ${isDeleted ? 'is-deleted' : ''} ${isCanceled ? 'is-canceled' : ''}">${escapeHtml(typeLabel)}</span>
                  ${
                    canOpen
                      ? `<span class="myf-formation-card__price">${formatPrice(formation?.price)}</span>`
                      : ''
                  }
                </div>
                <strong>${escapeHtml(canOpen ? formation?.name || 'Formation' : 'Formation supprimée')}</strong>
                <p class="myf-formation-card__description muted">${escapeHtml(description || 'Description disponible dans le détail.')}</p>
                ${
                  progressPercent !== null && type === 'distanciel'
                    ? `<p class="myf-formation-card__progress">Progression: ${progressPercent}%</p>`
                    : ''
                }
                <div class="myf-formation-card__actions">
                  ${
                    canOpen
                      ? `
                        <button type="button" class="myf-formation-access" data-action="open-formation" data-formation-index="${index}">
                          Accéder à la formation <i class="bi bi-play-fill"></i>
                        </button>
                      `
                      : `<p class="myf-formation-card__deleted-note">${
                          isCanceled ? 'Achat annulé conservé comme preuve.' : 'Archive d’achat conservée.'
                        }</p>`
                  }
                </div>
              </div>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

async function openDetail(root, entry) {
  if (!root || !entry) return;
  try {
    const detailModule = await import('/js/modules/myFormationDetailModule.js');
    await detailModule.renderPage(root, {
      formation: entry.formation || {},
      purchase: entry,
      onBack: () => renderPage(root)
    });
  } catch (error) {
    console.error('Erreur chargement detail formation', error);
    const body = root.querySelector('[data-formations-list]');
    renderStatus(body, error.message || 'Impossible de charger le détail.');
  }
}

function attachDetailHandlers(container, root) {
  if (!container) return;
  container.querySelectorAll('[data-action="open-formation"]').forEach(button => {
    const open = () => {
      const index = Number(button.dataset.formationIndex);
      const entry = loadedFormations[index];
      if (entry?.formation?.id) {
        openDetail(root, entry);
      }
    };
    button.addEventListener('click', open);
  });
}

export async function renderPage(container) {
  if (!container) return;
  resetAcquisitionNotifications(ACQUISITION_PAGES.MY_FORMATIONS);
  container.innerHTML = `
    <article class="formations-page">
      <header>
        <h2>Mes formations</h2>
        <p>Retrouvez vos achats et les archives de formations annulées.</p>
      </header>
      <section class="manager-section">
        <div class="data-list" data-formations-list>
          ${buildInlinePawLoader('Chargement de vos formations...')}
        </div>
      </section>
    </article>
  `;

  const list = container.querySelector('[data-formations-list]');
  const startedAt = Date.now();

  try {
    const response = await fetch('/api/client/me/formations', { credentials: 'include' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || 'Impossible de lire vos formations.');
    }
    const payload = await response.json().catch(() => ({}));
    const remaining = 500 - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    loadedFormations = Array.isArray(payload.formations) ? payload.formations : [];
    renderTable(list, loadedFormations);
    attachDetailHandlers(list, container);
  } catch (error) {
    console.error('Erreur chargement formations client', error);
    const remaining = 500 - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    renderStatus(list, 'Impossible de récupérer vos formations pour le moment.');
  }
}
