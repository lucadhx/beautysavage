// @deprecated C3 — Viewer distanciel legacy (FormationModule). L'expérience apprenante de référence
// est désormais le Learning Studio React (Formation → Chapitre → Leçon → Ressource + progression
// serveur + attestation) servie sur la vitrine authentifiée `/mes-formations`. Ce module est
// conservé pour rétro-compatibilité uniquement et sera retiré dans une version ultérieure (voir
// rapport 216). Ne pas faire évoluer ici : toute nouvelle fonctionnalité va côté React.
const MY_FORMATIONS_ENDPOINT = '/api/client/me/formations';
const MODULES_ENDPOINT = formationId => `/api/client/formations/${formationId}/modules`;

let currentFormation = null;
let currentModules = [];
let rootContainer = null;
let moduleClickHandler = null;
let moduleKeydownHandler = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString();
}

function renderListItems(items, renderItem, emptyMessage) {
  if (!items.length) {
    return `<li class="module-placeholder">${escapeHtml(emptyMessage)}</li>`;
  }
  return items.map(renderItem).join('');
}

function renderModuleItem(module) {
  const title = escapeHtml(module.title);
  const description = escapeHtml(module.description || 'Sans description');
  const videosList = renderListItems(
    Array.isArray(module.videos) ? module.videos : [],
    video => `<li><a href="${escapeHtml(video)}" target="_blank" rel="noreferrer">${escapeHtml(video)}</a></li>`,
    'Aucune vidéo enregistrée.'
  );
  const filesList = renderListItems(
    Array.isArray(module.files) ? module.files : [],
    file => `<li><a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">${escapeHtml(file.name)}</a></li>`,
    'Aucun fichier enregistré.'
  );
  const orderLabel = module.order !== undefined ? `Ordre ${module.order}` : 'Ordre non défini';
  const createdLabel = formatDate(module.createdAt);
  return `
    <article
      class="data-item clickable-card"
      role="button"
      data-module-card
      data-module-id="${escapeHtml(module.id)}"
      tabindex="0"
    >
      <div>
        <strong>${orderLabel} · ${title}</strong>
        <p>${description}</p>
        <p class="muted">Créé le ${createdLabel}</p>
        <div>
          <p class="muted">Vidéos</p>
          <ul class="data-list">${videosList}</ul>
        </div>
        <div>
          <p class="muted">Fichiers</p>
          <ul class="data-list">${filesList}</ul>
        </div>
      </div>
    </article>
  `;
}

function renderStatusMessage(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-forbidden">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderModuleList(container, formation, modules) {
  if (!container) return;
  const list = modules.map(renderModuleItem).join('');
  container.innerHTML = `
    <div class="module-panel">
      <header>
        <h2>Modules distanciels</h2>
        <p>Formation : ${escapeHtml(formation.name || 'Formation')}</p>
      </header>
      <section class="manager-section">
        <div class="data-list">
          ${list}
        </div>
      </section>
    </div>
  `;
}

function renderCurrentList() {
  if (!rootContainer || !currentFormation) return;
  renderModuleList(rootContainer, currentFormation, currentModules);
  setupModuleHandlers(rootContainer);
}

function setupModuleHandlers(container) {
  if (!container || !currentFormation) return;
  removeModuleHandlers();
  moduleClickHandler = event => {
    const card = event.target.closest('[data-module-card]');
    if (!card) return;
    const moduleId = card.dataset.moduleId;
    if (!moduleId) return;
    event.preventDefault();
    openModuleDetail(moduleId, currentFormation);
  };
  moduleKeydownHandler = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-module-card]');
    if (!card) return;
    const moduleId = card.dataset.moduleId;
    if (!moduleId) return;
    event.preventDefault();
    openModuleDetail(moduleId, currentFormation);
  };
  container.addEventListener('click', moduleClickHandler);
  container.addEventListener('keydown', moduleKeydownHandler);
}

function removeModuleHandlers() {
  if (!rootContainer) return;
  if (moduleClickHandler) {
    rootContainer.removeEventListener('click', moduleClickHandler);
    moduleClickHandler = null;
  }
  if (moduleKeydownHandler) {
    rootContainer.removeEventListener('keydown', moduleKeydownHandler);
    moduleKeydownHandler = null;
  }
}

async function openModuleDetail(moduleId, formation) {
  if (!rootContainer || !moduleId || !formation) return;
  try {
    const detailModule = await import('/js/modules/myFormationModuleDetailModule.js');
    await detailModule.renderPage(rootContainer, {
      formation,
      moduleId,
      onBack: renderCurrentList
    });
  } catch (error) {
    console.error('Erreur chargement détail module', error);
    renderStatusMessage(rootContainer, 'Impossible d’ouvrir le module demandé.');
  }
}

async function fetchPurchasedDistancielFormation() {
  const response = await fetch(MY_FORMATIONS_ENDPOINT, { credentials: 'include' });
  if (response.status === 401) {
    throw new Error('unauthenticated');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('fetch-failed');
  }
  const purchases = Array.isArray(payload.formations) ? payload.formations : [];
  return purchases.find(entry => entry?.formation?.type === 'distanciel') || null;
}

async function fetchModulesForFormation(formationId) {
  const response = await fetch(MODULES_ENDPOINT(formationId), { credentials: 'include' });
  if (response.status === 401) {
    throw new Error('unauthenticated');
  }
  if (response.status === 403) {
    throw new Error('forbidden');
  }
  if (!response.ok) {
    throw new Error('fetch-failed');
  }
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.modules) ? payload.modules : [];
}

export async function renderPage(container) {
  if (!container) return;
  rootContainer = container;
  container.innerHTML = '<p class="module-placeholder">Chargement des modules distanciels...</p>';
  try {
    const purchase = await fetchPurchasedDistancielFormation();
    if (!purchase || !purchase.formation?.id) {
      renderStatusMessage(container, 'Accès réservé aux formations distancielles achetées.');
      return;
    }
    currentFormation = purchase.formation;
    const formationId = currentFormation.id;
    const modules = await fetchModulesForFormation(formationId);
    if (!modules.length) {
      renderStatusMessage(container, 'Aucun module disponible pour cette formation.');
      return;
    }
    currentModules = modules;
    renderCurrentList();
  } catch (error) {
    if (error.message === 'unauthenticated') {
      renderStatusMessage(container, 'Veuillez vous connecter pour accéder aux modules.');
    } else if (error.message === 'forbidden') {
      renderStatusMessage(container, 'Achat requis pour accéder aux modules distanciels.');
    } else {
      renderStatusMessage(container, 'Impossible de charger les modules distanciels.');
      console.error('Erreur chargement modules distanciels', error);
    }
  }
}
