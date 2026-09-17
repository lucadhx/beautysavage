import { requestVitrineNavigation } from './vitrineNavigationHelper.js';

const API_SERVICES = '/api/vitrine/services';

function escHtml(v = '') {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} €` : '—';
}

function formatDuration(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min`;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, '0')}`;
}

function injectCss() {
  if (document.getElementById('svs-styles')) return;
  const link = document.createElement('link');
  link.id = 'svs-styles';
  link.rel = 'stylesheet';
  link.href = '/css/servicesModule.css';
  document.head.appendChild(link);
}

function buildPromoBadge(service) {
  if (!service.hasPromo || !service.promotionLabel) return '';
  return `<span class="svs-promo-badge">${escHtml(service.promotionLabel)}</span>`;
}

function buildServiceCard(service) {
  const thumb = service.photos?.[0]
    ? `<div class="svs-card__img-wrap">
         <img src="${escHtml(service.photos[0])}" alt="${escHtml(service.name)}" class="svs-card__img" loading="lazy">
         ${buildPromoBadge(service)}
       </div>`
    : `<div class="svs-card__img-wrap">
         <div class="svs-card__img svs-card__img--empty"><i class="bi bi-scissors"></i></div>
         ${buildPromoBadge(service)}
       </div>`;

  const priceHtml = service.hasPromo
    ? `<span class="svs-price svs-price--promo">${escHtml(formatPrice(service.effectivePrice))}</span>
       <span class="svs-price svs-price--original">${escHtml(formatPrice(service.price))}</span>`
    : `<span class="svs-price">${escHtml(formatPrice(service.price))}</span>`;

  return `
    <div class="svs-card" data-slug="${escHtml(service.slug)}" role="button" tabindex="0">
      ${thumb}
      <div class="svs-card__body">
        <div class="svs-card__title">${escHtml(service.name)}</div>
        ${service.shortDescription ? `<p class="svs-card__desc">${escHtml(service.shortDescription)}</p>` : ''}
        <div class="svs-card__footer">
          <span class="svs-card__duration"><i class="bi bi-clock"></i> ${escHtml(formatDuration(service.duration))}</span>
          <div class="svs-card__price-wrap">${priceHtml}</div>
        </div>
        <button class="svs-book-btn" data-slug="${escHtml(service.slug)}">
          <i class="bi bi-calendar-check"></i> Voir la prestation
        </button>
      </div>
    </div>
  `;
}

export async function renderModule(container) {
  injectCss();
  container.innerHTML = `
    <div class="svs-root">
      <div class="svs-header">
        <h2 class="svs-title">Nos Prestations</h2>
        <p class="svs-subtitle">Prenez soin de vous avec nos soins beauté personnalisés.</p>
      </div>
      <div class="svs-grid svs-grid--loading">
        ${Array(3).fill('<div class="svs-card svs-card--skeleton"></div>').join('')}
      </div>
    </div>
  `;

  let services = [];
  try {
    const res = await fetch(API_SERVICES, { credentials: 'include' });
    const data = await res.json();
    services = data.services || [];
  } catch (_) {
    container.innerHTML = `<div class="svs-root"><p class="svs-error">Impossible de charger les prestations.</p></div>`;
    return;
  }

  const grid = container.querySelector('.svs-grid');
  if (!grid) return;
  grid.classList.remove('svs-grid--loading');

  if (!services.length) {
    grid.innerHTML = `<p class="svs-empty">Aucune prestation disponible pour le moment.</p>`;
    return;
  }

  grid.innerHTML = services.map(buildServiceCard).join('');

  grid.querySelectorAll('[data-slug]').forEach(el => {
    el.addEventListener('click', () => {
      const slug = el.dataset.slug;
      if (slug) requestVitrineNavigation('service-detail', { query: { serviceSlug: slug } });
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

export const renderPage = renderModule;
