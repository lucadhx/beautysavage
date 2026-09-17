import { CONSUMER_WAIVER_INFO_CONTENT } from '../constants/consumerWaiver.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBulletList(items = []) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return '';
  return `
    <ul class="checkout-waiver-modal__list">
      ${rows.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}
    </ul>
  `;
}

function buildConcernedSection(options = {}) {
  const count = Number(options?.concernedCount || 0);
  const items = Array.isArray(options?.concernedItems) ? options.concernedItems : [];
  if (!count) return '';

  const itemMarkup = items.length
    ? `
      <div class="checkout-waiver-modal__concerned-scroll">
        <ul class="checkout-waiver-modal__concerned-list">
          ${items
            .map(
              item => `
                <li class="checkout-waiver-modal__concerned-item">
                  <span class="checkout-waiver-modal__concerned-dot" aria-hidden="true"></span>
                  <span class="checkout-waiver-modal__concerned-title">${escapeHtml(item)}</span>
                  <small class="checkout-waiver-modal__concerned-kind">(distancielle)</small>
                </li>
              `
            )
            .join('')}
        </ul>
      </div>
    `
    : `<p class="checkout-waiver-modal__concerned-empty">Aucune formation concernée.</p>`;

  const plural = count > 1 ? 's' : '';
  return `
    <section class="checkout-waiver-modal__concerned">
      <h4>Formations concernées dans votre panier (${count})</h4>
      <p>${count} formation${plural} distancielle${plural} est/sont concernée${plural} par cette renonciation.</p>
      ${itemMarkup}
    </section>
  `;
}

export function openConsumerWaiverInfoModal(options = {}) {
  const content = CONSUMER_WAIVER_INFO_CONTENT || {};
  const sections = content.sections || {};
  const subtitle = String(options?.subtitle || '').trim();
  const overlay = document.createElement('div');
  overlay.className = 'checkout-waiver-modal-overlay';
  overlay.setAttribute('role', 'presentation');
  overlay.innerHTML = `
    <div class="checkout-waiver-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      content.title || 'Plus d informations'
    )}">
      <header class="checkout-waiver-modal__header">
        <div class="checkout-waiver-modal__header-copy">
          <h3>${escapeHtml(content.title || 'Plus d informations')}</h3>
          <p class="checkout-waiver-modal__subtitle" data-waiver-modal-subtitle ${subtitle ? '' : 'hidden'}>${escapeHtml(subtitle)}</p>
        </div>
        <button type="button" class="checkout-waiver-modal__close" data-close aria-label="Fermer">
          <i class="bi bi-x-lg"></i>
        </button>
      </header>
      <div class="checkout-waiver-modal__body">
        <section class="checkout-waiver-modal__section">
          <h4><i class="bi bi-person-chalkboard" aria-hidden="true"></i>${escapeHtml(
            sections.presentiel?.title || 'Formations présentielles'
          )}</h4>
          <p>${escapeHtml(sections.presentiel?.intro || '')}</p>
          <p>${escapeHtml(sections.presentiel?.reminder || '')}</p>
          ${buildBulletList(sections.presentiel?.bullets)}
          <p class="checkout-waiver-modal__why">${escapeHtml(content.presentielWhy || '')}</p>
        </section>

        <section class="checkout-waiver-modal__section">
          <h4><i class="bi bi-camera-video" aria-hidden="true"></i>${escapeHtml(
            sections.distanciel?.title || 'Formations en ligne'
          )}</h4>
          ${buildBulletList(sections.distanciel?.bullets)}
        </section>

        <section class="checkout-waiver-modal__section">
          <h4><i class="bi bi-shield-check" aria-hidden="true"></i>${escapeHtml(
            sections.institute?.title || "Si l'institut annule"
          )}</h4>
          <p>${escapeHtml(sections.institute?.text || '')}</p>
        </section>

        <section class="checkout-waiver-modal__section">
          <h4><i class="bi bi-list-check" aria-hidden="true"></i>${escapeHtml(
            sections.summary?.title || 'En resume'
          )}</h4>
          ${buildBulletList(sections.summary?.bullets)}
        </section>

        ${buildConcernedSection(options)}
      </div>
    </div>
  `;

  let subtitleTimer = null;

  const setSubtitle = nextValue => {
    const node = overlay.querySelector('[data-waiver-modal-subtitle]');
    if (!node) return;
    const value = String(nextValue || '').trim();
    node.textContent = value;
    node.hidden = !value;
  };

  const closeModal = () => {
    if (subtitleTimer) {
      window.clearInterval(subtitleTimer);
      subtitleTimer = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    overlay.classList.remove('is-visible');
    window.setTimeout(() => {
      overlay.remove();
    }, 180);
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') closeModal();
  };

  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  const subtitleNode = overlay.querySelector('.checkout-waiver-modal__subtitle');
  if (subtitleNode) {
    subtitleNode.setAttribute('data-waiver-modal-subtitle', 'true');
    subtitleNode.hidden = !subtitle;
  }

  if (typeof options?.getSubtitle === 'function') {
    setSubtitle(options.getSubtitle());
    const tickMs = Math.max(1000, Number(options?.liveSubtitleIntervalMs) || 60000);
    subtitleTimer = window.setInterval(() => {
      setSubtitle(options.getSubtitle());
    }, tickMs);
  }

  return {
    close: closeModal,
    setSubtitle
  };
}
