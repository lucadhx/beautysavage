import { openEditorialEditor } from './editorialEditor.js';

const API_ROOT = '/api/gestion/editable-content';
const TARGET_TYPE = 'page';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(value) {
  if (!value) return 'Pas encore personnalisé';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date inconnue';
  }
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function createPageGestionModule(config) {
  const state = {
    zones: [],
    entries: []
  };

  function showFeedback(container, message, status = '') {
    const target = container?.querySelector('[data-editorial-feedback]');
    if (!target) return;
    target.textContent = message || '';
    if (status) {
      target.dataset.status = status;
    } else {
      delete target.dataset.status;
    }
  }

  async function fetchPageContent(container) {
    const listRoot = container?.querySelector('[data-editorial-list]');
    if (listRoot) {
      listRoot.innerHTML = '<p class="module-placeholder">Chargement...</p>';
    }
    showFeedback(container, '');
    try {
      const params = new URLSearchParams({
        targetType: TARGET_TYPE,
        targetId: config.targetId
      });
      const response = await fetch(`${API_ROOT}?${params.toString()}`, {
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Impossible de charger les zones éditoriales.');
      }
      state.zones = Array.isArray(payload.zones) ? payload.zones : [];
      state.entries = Array.isArray(payload.entries) ? payload.entries : [];
      renderList(container);
    } catch (error) {
      console.error('Erreur chargement contenu éditorial', error);
      if (listRoot) {
        listRoot.innerHTML = '<p class="module-placeholder">Impossible de charger les zones.</p>';
      }
      showFeedback(container, 'Impossible de charger les zones éditoriales.', 'error');
    }
  }

  function getEntryForZone(zoneKey) {
    return state.entries.find(entry => entry.zoneKey === zoneKey);
  }

  function buildZoneCard(zone) {
    const entry = getEntryForZone(zone.key);
    const preview = entry?.contentHtml || zone.defaultContent || '';
    const summary = preview || '<p class="muted">Aucun contenu personnalisé.</p>';
    const timestamp = entry?.updatedAt ? formatTimestamp(entry.updatedAt) : 'Pas encore personnalisé';
    return `
      <article class="data-item clickable-card" data-zone-item="${zone.key}">
        <div>
          <strong>${zone.label}</strong>
          <p class="muted">${zone.description || 'Zone de texte fixe.'}</p>
          <div class="editorial-preview" data-zone-preview>${summary}</div>
          <small class="muted">Dernière mise à jour : ${escapeHtml(timestamp)}</small>
        </div>
        <div class="item-actions">
          <button type="button" class="primary-button" data-zone-action="${zone.key}">
            Modifier
          </button>
        </div>
      </article>
    `;
  }

  function renderList(container) {
    const listRoot = container?.querySelector('[data-editorial-list]');
    if (!listRoot) return;
    if (!state.zones.length) {
      listRoot.innerHTML =
        '<p class="module-placeholder">Aucune zone éditoriale disponible pour le moment.</p>';
      return;
    }
    listRoot.innerHTML = state.zones.map(buildZoneCard).join('');
    attachZoneActions(container);
  }

  function attachZoneActions(container) {
    const buttons = container?.querySelectorAll('[data-zone-action]') || [];
    buttons.forEach(button => {
      const zoneKey = button.dataset.zoneAction;
      const zone = state.zones.find(entry => entry.key === zoneKey);
      if (!zone) return;
      button.addEventListener('click', () => openZoneEditor(zone, container));
    });
  }

  async function openZoneEditor(zone, container) {
    const entry = getEntryForZone(zone.key);
    openEditorialEditor({
      title: zone.label,
      description: zone.description || '',
      label: `Édition : ${zone.label}`,
      initialHtml: entry?.contentHtml || zone.defaultContent || '',
      onSave: html => saveZoneContent(zone, html, container)
    });
  }

  async function saveZoneContent(zone, html, container) {
    const payload = {
      targetType: TARGET_TYPE,
      targetId: config.targetId,
      zoneKey: zone.key,
      contentHtml: html
    };
    const response = await fetch(API_ROOT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || 'Impossible de sauvegarder le contenu.');
    }
    await fetchPageContent(container);
  }

  return {
    async renderModule(container) {
      if (!container) return;
      container.innerHTML = `
        <section class="module-panel" data-module-root>
          <header>
            <h2>${config.heading}</h2>
            <p>${config.subheading}</p>
          </header>
          <div class="manager-section">
            <div class="section-header">
              <h3>Zones éditoriales</h3>
            </div>
            <div data-editorial-list class="data-list">
              <p class="module-placeholder">Chargement...</p>
            </div>
            <p data-editorial-feedback class="form-message"></p>
          </div>
        </section>
      `;
      await fetchPageContent(container);
    }
  };
}
