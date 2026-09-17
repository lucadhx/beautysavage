const EMPTY_STATE_ACTION_EVENT = 'vitrine:empty-state-action';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dispatchEmptyStateNavigation(slug) {
  if (!slug || typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const event = new CustomEvent(EMPTY_STATE_ACTION_EVENT, {
    detail: { slug }
  });
  window.dispatchEvent(event);
}

export function renderEmptyState(container, options = {}) {
  if (!container) return;
  const iconMarkup = options.iconHtml
    ? `<span class="empty-state__icon" aria-hidden="true">${options.iconHtml}</span>`
    : options.iconClass
    ? `<span class="empty-state__icon" aria-hidden="true"><i class="${escapeHtml(options.iconClass)}"></i></span>`
    : options.icon
    ? `<span class="empty-state__icon" aria-hidden="true">${escapeHtml(options.icon)}</span>`
    : '';
  const titleMarkup = `<p class="empty-state__title">${escapeHtml(options.title || 'Aucune donnée')}</p>`;
  const descriptionMarkup = options.description
    ? `<p class="empty-state__description">${escapeHtml(options.description)}</p>`
    : '';
  const actionMarkup = options.action?.label
    ? `<button type="button" class="primary-button empty-state__action" data-empty-state-action>${escapeHtml(
        options.action.label
      )}</button>`
    : '';
  container.innerHTML = `
    <div class="empty-state" role="status" aria-live="polite">
      ${iconMarkup}
      ${titleMarkup}
      ${descriptionMarkup}
      ${actionMarkup}
    </div>
  `;
  const button = container.querySelector('[data-empty-state-action]');
  if (button && options.action) {
    if (typeof options.action.onClick === 'function') {
      button.addEventListener('click', options.action.onClick);
    } else if (options.action.slug) {
      button.addEventListener('click', () => dispatchEmptyStateNavigation(options.action.slug));
    } else if (options.action.href) {
      button.addEventListener('click', () => {
        window.location.href = options.action.href;
      });
    }
  }
}

export { EMPTY_STATE_ACTION_EVENT };
