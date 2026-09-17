// @deprecated C3 — Détail module distanciel legacy. Remplacé par le Learning Studio React
// (`/mes-formations`, lecteur Formation → Chapitre → Leçon). Conservé pour rétro-compatibilité,
// retrait planifié (voir rapport 216). Ne pas faire évoluer ici.
const MODULE_DETAIL_ENDPOINT = moduleId => `/api/client/modules/${moduleId}`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function fetchModuleDetail(moduleId) {
  if (!moduleId) throw new Error('Module manquant.');
  const response = await fetch(MODULE_DETAIL_ENDPOINT(moduleId), { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Impossible de charger le module.');
  }
  const payload = await response.json().catch(() => ({}));
  return payload.module || null;
}

function getEmbeddableUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch (error) {
    console.error('URL parsing failed', error);
  }
  return null;
}

function renderVideosSection(videos) {
  const validVideos =
    Array.isArray(videos) && videos.length
      ? videos
          .map(video => ({ embedUrl: getEmbeddableUrl(video) }))
          .filter(entry => entry.embedUrl)
      : [];
  if (!validVideos.length) {
    return '<p class="module-placeholder">Aucune vidéo disponible.</p>';
  }
  return `
    <div class="data-list">
      ${validVideos
        .map(
          video => `
            <article class="data-item">
              <div class="module-video">
                <iframe
                  src="${escapeHtml(video.embedUrl)}"
                  title="Vidéo module"
                  loading="lazy"
                  allowfullscreen
                ></iframe>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderFilesSection(files) {
  if (!Array.isArray(files) || !files.length) {
    return '<p class="module-placeholder">Aucun fichier associé.</p>';
  }
  return `
    <ul class="data-list">
      ${files
        .map(
          file => `
            <li class="data-item">
              <a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(file.name || 'Télécharger')}
              </a>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function renderHeader(container, module, onBack) {
  if (!container || !module) return;
  const backButton = onBack
    ? '<button class="secondary-button" type="button" data-module-detail-back>Retour</button>'
    : '';
  container.innerHTML = `
    <div class="module-panel">
      <header>
        <h2>${escapeHtml(module.title || 'Module')}</h2>
        <p class="muted">${escapeHtml(module.description || 'Description indisponible.')}</p>
        ${backButton}
      </header>
      <section class="manager-section" data-module-detail-body></section>
    </div>
  `;
}

async function renderModule(container, module) {
  if (!container || !module) return;
  const body = container.querySelector('[data-module-detail-body]');
  if (!body) return;
  body.innerHTML = `
    <div class="module-section">
      <p class="muted">Vidéos :</p>
      ${renderVideosSection(module.videos)}
    </div>
    <div class="module-section">
      <p class="muted">Fichiers :</p>
      ${renderFilesSection(module.files)}
    </div>
  `;
}

export async function renderPage(container, data = {}) {
  if (!container) return;
  const moduleId = data.moduleId;
  const onBack = typeof data.onBack === 'function' ? data.onBack : null;
  container.innerHTML = '<p class="module-placeholder">Chargement du module...</p>';
  try {
    const moduleDetail = await fetchModuleDetail(moduleId);
    if (!moduleDetail) {
      renderStatus(container, 'Module introuvable.');
      return;
    }
    renderHeader(container, moduleDetail, onBack);
    if (onBack) {
      const backButton = container.querySelector('[data-module-detail-back]');
      backButton?.addEventListener('click', event => {
        event.preventDefault();
        onBack();
      });
    }
    await renderModule(container, moduleDetail);
  } catch (error) {
    console.error('Erreur détail module', error);
    renderStatus(container, error.message || 'Impossible de charger le module.');
  }
}
