import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const HOME_SETTINGS_ENDPOINT = '/api/vitrine/home-settings';
const SITE_IDENTITY_ENDPOINT = '/api/vitrine/site-identity';
const HIGHLIGHTS_ENDPOINT = '/api/vitrine/highlights';
const SHOP_ENDPOINT = '/api/vitrine/shop';
const GIFT_CARD_ENDPOINT = '/api/vitrine/gift-cards';
const BOOSTED_SERVICES_ENDPOINT = '/api/vitrine/services/boosted';
const REVIEW_STATS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/reviews/stats`;

const SHOP_SLUG = 'boutique';
const MIN_LOADER_MS = 1000;
const CAROUSEL_INTERVAL_MS = 4500;

let activeCleanup = null;

function wait(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) {
    return 'Prix indisponible';
  }
  return `${price.toFixed(2)} €`;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeFormationKind(value) {
  const normalized = normalizeText(value);
  if (normalized.includes('present')) return 'presentiel';
  if (normalized.includes('distanc')) return 'distanciel';
  return '';
}

function normalizeBoostItemKind(value) {
  const normalized = normalizeText(value);
  if (
    normalized === 'formation' ||
    normalized === 'presentiel' ||
    normalized === 'distanciel'
  ) {
    return 'formation';
  }
  if (
    normalized === 'product' ||
    normalized === 'produit' ||
    normalized === 'produits'
  ) {
    return 'product';
  }
  return '';
}

function resolveBoostBasePrice(item = {}) {
  const candidates = [item?.originalPrice, item?.basePrice, item?.price, item?.finalPrice];
  const value = candidates.find(candidate => Number.isFinite(Number(candidate)));
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function resolveBoostFinalPrice(item = {}) {
  const candidates = [item?.finalPrice, item?.price, item?.basePrice, item?.originalPrice];
  const value = candidates.find(candidate => Number.isFinite(Number(candidate)));
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function buildPromotionBadge(promotion) {
  if (!promotion) return '';
  const label =
    promotion.discountType === 'percentage'
      ? `-${promotion.discountValue}%`
      : `-${formatPrice(promotion.discountValue)}`;
  return `<span class="home-premium-badge">${escapeHtml(label)}</span>`;
}

function buildPawIcons(averageRating = 0) {
  const normalized = Number.isFinite(averageRating)
    ? Math.min(Math.max(averageRating, 0), 5)
    : 0;
  const activeCount = Math.round(normalized);
  return Array.from({ length: 5 })
    .map(
      (_unused, index) =>
        `<span class="paw-icon${index < activeCount ? ' is-active' : ''}">${PAW_ICON_SVG}</span>`
    )
    .join('');
}

async function fetchJson(endpoint) {
  const response = await fetch(endpoint, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Request failed: ${endpoint}`);
  }
  return response.json().catch(() => ({}));
}

async function loadHomeData() {
  const [settingsResult, identityResult, highlightsResult, shopResult, giftCardResult, boostedServicesResult] =
    await Promise.allSettled([
      fetchJson(HOME_SETTINGS_ENDPOINT),
      fetchJson(SITE_IDENTITY_ENDPOINT),
      fetchJson(HIGHLIGHTS_ENDPOINT),
      fetchJson(SHOP_ENDPOINT),
      fetchJson(GIFT_CARD_ENDPOINT),
      fetchJson(BOOSTED_SERVICES_ENDPOINT)
    ]);

  const settings =
    settingsResult.status === 'fulfilled' ? settingsResult.value?.settings || {} : {};
  const identity = identityResult.status === 'fulfilled' ? identityResult.value || {} : {};
  const highlights =
    highlightsResult.status === 'fulfilled' && Array.isArray(highlightsResult.value?.highlights)
      ? highlightsResult.value.highlights
      : [];
  const formations =
    shopResult.status === 'fulfilled' && Array.isArray(shopResult.value?.formations)
      ? shopResult.value.formations
      : [];
  const giftCardConfig =
    giftCardResult.status === 'fulfilled' ? giftCardResult.value?.config || null : null;
  const boostedServices =
    boostedServicesResult.status === 'fulfilled' && Array.isArray(boostedServicesResult.value?.services)
      ? boostedServicesResult.value.services
      : [];

  return {
    settings,
    identity,
    highlights,
    formations,
    giftCardConfig,
    boostedServices
  };
}

function pickRandomFormationCover(formations, targetKind) {
  const filtered = formations.filter(
    entry => normalizeFormationKind(entry?.type) === targetKind && String(entry?.coverImage || '').trim()
  );
  if (!filtered.length) return null;
  const randomIndex = Math.floor(Math.random() * filtered.length);
  const selected = filtered[randomIndex] || null;
  if (!selected) return null;
  return {
    id: String(selected.id || '').trim(),
    title: String(selected.name || '').trim() || 'Formation',
    coverImage: String(selected.coverImage || '').trim()
  };
}

function resolveBannerUrl(settings) {
  return String(settings?.banner?.urlResolved || '').trim();
}

function buildLoaderMarkup(label = "Chargement de l'accueil...") {
  return `
    <div class="home-premium-loader" role="status" aria-live="polite">
      <div class="home-premium-loader__paws" aria-hidden="true">
        <span class="home-premium-loader__paw">${PAW_ICON_SVG}</span>
        <span class="home-premium-loader__paw home-premium-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="home-premium-loader__paw home-premium-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

function buildBoostSlides(highlights = []) {
  if (!highlights.length) {
    return `
      <article class="home-premium-boost-empty">
        <i class="bi bi-stars" aria-hidden="true"></i>
        <p>Aucun article boosté pour le moment.</p>
      </article>
    `;
  }
    return highlights
    .map((item, index) => {
      const id = String(item?.id || '').trim();
      const kind = normalizeBoostItemKind(item?.kind || item?.type);
      const title = String(item?.name || '').trim() || 'Article';
      const cover = String(item?.coverImage || '').trim();
      const basePrice = resolveBoostBasePrice(item);
      const finalPrice = resolveBoostFinalPrice(item);
      const promoBadge = buildPromotionBadge(item?.activePromotion);
      const ratingKey = kind === 'formation' ? `formation:${id}` : '';
      const hasProductDiscount =
        kind === 'product' &&
        finalPrice < basePrice;
      const ratingMarkup =
        kind === 'formation'
          ? `
              <div
                class="paw-row paw-row--compact home-premium-boost-card__rating"
                data-home-rating="${escapeHtml(ratingKey)}"
                aria-label="Avis"
                hidden
              ></div>
            `
          : '';
      const priceMarkup = hasProductDiscount
        ? `
            <p class="home-premium-boost-card__price home-premium-boost-card__price--promo">
              <span class="home-premium-boost-card__price-old">${escapeHtml(formatPrice(basePrice))}</span>
              <span class="home-premium-boost-card__price-new">${escapeHtml(formatPrice(finalPrice))}</span>
            </p>
          `
        : `<p class="home-premium-boost-card__price">${escapeHtml(formatPrice(finalPrice))}</p>`;
      return `
        <article
          class="home-premium-boost-slide${index === 0 ? ' is-active' : ''}"
          data-boost-slide
          data-boost-index="${index}"
          data-boost-id="${escapeHtml(id)}"
          data-boost-kind="${escapeHtml(kind)}"
        >
          <button type="button" class="home-premium-boost-card" data-boost-open>
            <div class="home-premium-boost-card__media">
              ${promoBadge}
              ${
                cover
                  ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" loading="lazy">`
                  : '<div class="home-premium-boost-card__fallback"><i class="bi bi-image"></i></div>'
              }
            </div>
            <div class="home-premium-boost-card__body">
              <p class="home-premium-boost-card__type">${escapeHtml(kind === 'formation' ? 'Formation' : 'Produit')}</p>
              <h3>${escapeHtml(title)}</h3>
              ${priceMarkup}
              ${ratingMarkup}
            </div>
          </button>
        </article>
      `;
    })
    .join('');
}

function buildCollectionsCardMarkup({ title, description, coverImage, action, type, fallbackIcon }) {
  return `
    <button
      type="button"
      class="home-premium-collection-card"
      data-home-collection-action="${escapeHtml(action)}"
      ${type ? `data-home-collection-type="${escapeHtml(type)}"` : ''}
    >
      <div class="home-premium-collection-card__media">
        ${
          coverImage
            ? `<img src="${escapeHtml(coverImage)}" alt="${escapeHtml(title)}" loading="lazy">`
            : `<div class="home-premium-collection-card__fallback"><i class="${escapeHtml(
                fallbackIcon || 'bi bi-image'
              )}" aria-hidden="true"></i></div>`
        }
      </div>
      <div class="home-premium-collection-card__body">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
      </div>
    </button>
  `;
}

function buildBoostedServicesSection(services = []) {
  if (!services.length) return '';

  const cards = services.map(s => {
    const thumb = s.photos?.[0]
      ? `<img src="${escapeHtml(s.photos[0])}" alt="${escapeHtml(s.name)}" loading="lazy" class="home-service-card__img">`
      : `<div class="home-service-card__img home-service-card__img--empty"><i class="bi bi-scissors"></i></div>`;
    const duration = (() => {
      const m = Number(s.duration);
      if (!Number.isFinite(m) || m <= 0) return '';
      const h = Math.floor(m / 60);
      const rem = m % 60;
      return h === 0 ? `${m} min` : rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, '0')}`;
    })();
    const priceHtml = s.hasPromo
      ? `<span class="home-service-card__price home-service-card__price--promo">${escapeHtml(formatPrice(s.effectivePrice))}</span>`
      : `<span class="home-service-card__price">${escapeHtml(formatPrice(s.price))}</span>`;
    const promoBadge = s.hasPromo && s.promotionLabel
      ? `<span class="home-service-card__promo-badge">${escapeHtml(s.promotionLabel)}</span>`
      : '';
    return `
      <button type="button" class="home-service-card" data-home-service-slug="${escapeHtml(s.slug)}">
        <div class="home-service-card__media">
          ${thumb}
          ${promoBadge}
        </div>
        <div class="home-service-card__body">
          <p class="home-service-card__duration"><i class="bi bi-clock"></i> ${escapeHtml(duration)}</p>
          <h3 class="home-service-card__name">${escapeHtml(s.name)}</h3>
          ${priceHtml}
        </div>
      </button>
    `;
  }).join('');

  return `
    <section class="home-premium-section home-premium-services home-premium-reveal" data-home-reveal>
      <header class="home-premium-section__header">
        <p class="home-premium-section__eyebrow">Soins &amp; Beauté</p>
        <h2>Nos prestations phares</h2>
      </header>
      <div class="home-services-grid">
        ${cards}
      </div>
      <div class="home-services-cta-wrap">
        <button type="button" class="home-services-cta" data-home-action="see-services">
          Voir toutes nos prestations
        </button>
      </div>
    </section>
  `;
}

function buildHomeMarkup(data) {
  const settings = data?.settings || {};
  const siteName = String(data?.identity?.siteName || 'Beauty Savage').trim() || 'Beauty Savage';
  const slogan =
    String(settings?.slogan || '').trim() || 'Des formations et produits experts pour révéler votre style.';
  const hookEditorialHtml =
    String(settings?.hookEditorialHtml || '').trim() ||
    '<p>Découvrez une sélection premium pensée pour accélérer votre progression.</p>';
  const bannerUrl = resolveBannerUrl(settings);
  const highlights = Array.isArray(data?.highlights) ? data.highlights.slice(0, 3) : [];
  const boostedServices = Array.isArray(data?.boostedServices) ? data.boostedServices : [];
  const showCarouselControls = highlights.length > 1;
  const presentielCover = pickRandomFormationCover(data?.formations || [], 'presentiel');
  const distancielCover = pickRandomFormationCover(data?.formations || [], 'distanciel');
  const giftCardCover = String(data?.giftCardConfig?.image || '').trim();
  const collections = [
    {
      title: 'Formations présentielles',
      description: 'Travail en institut, pratique intensive et sessions guidées.',
      coverImage: presentielCover?.coverImage || '',
      action: 'collection',
      type: 'presentiel',
      fallbackIcon: 'bi bi-calendar-event'
    },
    {
      title: 'Formations distancielles',
      description: 'Programme en ligne, modules progressifs et accès flexible.',
      coverImage: distancielCover?.coverImage || '',
      action: 'collection',
      type: 'distanciel',
      fallbackIcon: 'bi bi-laptop'
    },
    {
      title: 'Cartes cadeaux',
      description: 'Offrez une expérience Beauty Savage en quelques clics.',
      coverImage: giftCardCover,
      action: 'gift-card',
      fallbackIcon: 'bi bi-gift'
    }
  ];
  const showCollectionsControls = collections.length > 1;

  return `
    <article class="home-premium">
      <section class="home-premium-hero home-premium-reveal" data-home-reveal>
        <div class="home-premium-hero__media">
          ${
            bannerUrl
              ? `<img src="${escapeHtml(bannerUrl)}" alt="${escapeHtml(siteName)}" loading="eager">`
              : '<div class="home-premium-hero__fallback"></div>'
          }
        </div>
        <div class="home-premium-hero__overlay">
          <h1 style="color: var(--color-surface)">${escapeHtml(siteName)}</h1>
          <p class="home-premium-hero__slogan">${escapeHtml(slogan)}</p>
          <button type="button" class="home-premium-hero__cta" data-home-action="discover">
            Découvrir les formations
          </button>
        </div>
      </section>

      <section class="home-premium-section home-premium-boost home-premium-reveal" data-home-reveal>
        <header class="home-premium-section__header">
          <p class="home-premium-section__eyebrow">À la une</p>
          <h2>Articles du moment</h2>
        </header>
        <div
          class="home-premium-carousel"
          data-home-carousel
          data-carousel-kind="boost"
          data-boost-count="${highlights.length}"
          aria-label="Carrousel des boosts"
        >
          <div class="home-premium-carousel__viewport">
            <div class="home-premium-carousel__track" data-carousel-track>
              ${buildBoostSlides(highlights)}
            </div>
          </div>
          ${
            showCarouselControls
              ? `
                <div class="home-premium-carousel__controls">
                  <button type="button" class="home-premium-carousel__arrow" data-carousel-prev aria-label="Boost précédent">
                    <i class="bi bi-chevron-left"></i>
                  </button>
                  <div class="home-premium-carousel__dots" data-boost-dots>
                    ${highlights
                      .map(
                        (_item, index) => `
                          <button
                            type="button"
                            class="home-premium-carousel__dot${index === 0 ? ' is-active' : ''}"
                            data-carousel-dot="${index}"
                            aria-label="Aller au boost ${index + 1}"
                          ></button>
                        `
                      )
                      .join('')}
                  </div>
                  <button type="button" class="home-premium-carousel__arrow" data-carousel-next aria-label="Boost suivant">
                    <i class="bi bi-chevron-right"></i>
                  </button>
                </div>
              `
              : ''
          }
        </div>
      </section>

      ${buildBoostedServicesSection(boostedServices)}

      <section class="home-premium-section home-premium-collections home-premium-reveal" data-home-reveal>
        <header class="home-premium-section__header">
          <p class="home-premium-section__eyebrow">Sélection</p>
          <h2>Nos collections</h2>
        </header>
        <div
          class="home-premium-carousel home-premium-carousel--collections"
          data-home-carousel
          data-carousel-kind="collections"
          aria-label="Carrousel des collections"
        >
          <div class="home-premium-carousel__viewport">
            <div class="home-premium-carousel__track" data-carousel-track>
              ${collections
                .map(
                  (collection, index) => `
                    <article class="home-premium-boost-slide home-premium-collection-slide${
                      index === 0 ? ' is-active' : ''
                    }" data-boost-slide data-boost-index="${index}">
                      ${buildCollectionsCardMarkup(collection)}
                    </article>
                  `
                )
                .join('')}
            </div>
          </div>
          ${
            showCollectionsControls
              ? `
                <div class="home-premium-carousel__controls">
                  <button type="button" class="home-premium-carousel__arrow" data-carousel-prev aria-label="Collection précédente">
                    <i class="bi bi-chevron-left"></i>
                  </button>
                  <div class="home-premium-carousel__dots">
                    ${collections
                      .map(
                        (_item, index) => `
                          <button
                            type="button"
                            class="home-premium-carousel__dot${index === 0 ? ' is-active' : ''}"
                            data-carousel-dot="${index}"
                            aria-label="Aller à la collection ${index + 1}"
                          ></button>
                        `
                      )
                      .join('')}
                  </div>
                  <button type="button" class="home-premium-carousel__arrow" data-carousel-next aria-label="Collection suivante">
                    <i class="bi bi-chevron-right"></i>
                  </button>
                </div>
              `
              : ''
          }
        </div>
      </section>

      

      <section class="home-premium-section home-premium-hook home-premium-reveal" data-home-reveal>
        <header class="home-premium-section__header">
          <p class="home-premium-section__eyebrow">Accroche</p>
          <h2>Votre prochaine transformation commence ici</h2>
        </header>
        <div class="editorial-detail home-premium-editorial">${hookEditorialHtml}</div>
      </section>

    </article>
  `;
}

function setupRevealAnimations(container) {
  const nodes = Array.from(container.querySelectorAll('[data-home-reveal]'));
  if (!nodes.length) return () => {};
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof IntersectionObserver === 'undefined') {
    nodes.forEach(node => node.classList.add('is-visible'));
    return () => {};
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  nodes.forEach(node => observer.observe(node));
  return () => observer.disconnect();
}

async function fetchFormationRatingStats(formationId) {
  if (!formationId) return null;
  try {
    const payload = await fetchJson(REVIEW_STATS_ENDPOINT(formationId));
    if (!payload?.ok) return null;
    return {
      averageRating: Number.isFinite(Number(payload.averageRating))
        ? Number(payload.averageRating)
        : 0,
      reviewCount: Number.isFinite(Number(payload.reviewCount)) ? Number(payload.reviewCount) : 0
    };
  } catch (_error) {
    return null;
  }
}

function setupBoostRatings(container, highlights = []) {
  const formationBoosts = highlights.filter(
    item => normalizeBoostItemKind(item?.kind || item?.type) === 'formation'
  );
  let cancelled = false;
  Promise.all(
    formationBoosts.map(async item => {
      const id = String(item?.id || '').trim();
      if (!id) return;
      const stats = await fetchFormationRatingStats(id);
      if (cancelled) return;
      const node = container.querySelector(`[data-home-rating="formation:${id}"]`);
      if (!node) return;
      const reviewCount = Number(stats?.reviewCount || 0);
      if (reviewCount <= 0) {
        node.innerHTML = '';
        node.hidden = true;
        return;
      }
      node.innerHTML = buildPawIcons(stats?.averageRating || 0);
      node.hidden = false;
    })
  ).catch(() => {
    // No-op: ratings are decorative only in this block.
  });
  return () => {
    cancelled = true;
  };
}

function setupSingleCarousel(carousel) {
  const viewport = carousel.querySelector('.home-premium-carousel__viewport');
  const track = carousel.querySelector('[data-carousel-track]');
  if (!carousel || !viewport || !track) return () => {};

  const slides = Array.from(track.querySelectorAll('[data-boost-slide]'));
  if (slides.length <= 1) return () => {};
  const dots = Array.from(carousel.querySelectorAll('[data-carousel-dot]'));
  const prevButton = carousel.querySelector('[data-carousel-prev]');
  const nextButton = carousel.querySelector('[data-carousel-next]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let currentIndex = 0;
  let paused = false;
  let intervalId = null;
  let touchStartX = null;
  let touchStartY = null;
  let touchStartedAt = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getMaxOffset = () => Math.max(0, track.scrollWidth - viewport.clientWidth);

  const getOffsetForIndex = index => {
    const safeIndex = clamp(index, 0, slides.length - 1);
    const slide = slides[safeIndex];
    if (!slide) return 0;
    const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
    const viewportCenter = viewport.clientWidth / 2;
    const targetOffset = slideCenter - viewportCenter;
    return clamp(targetOffset, 0, getMaxOffset());
  };

  const update = index => {
    currentIndex = clamp(index, 0, slides.length - 1);
    const offset = getOffsetForIndex(currentIndex);
    track.style.transform = `translate3d(${-offset}px, 0, 0)`;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === currentIndex);
      const isNeighbor =
        slideIndex === currentIndex - 1 || slideIndex === currentIndex + 1;
      slide.classList.toggle('is-neighbor', isNeighbor);
    });
    dots.forEach((dot, dotIndex) => {
      dot.classList.toggle('is-active', dotIndex === currentIndex);
    });
  };

  const next = () => {
    const nextIndex = currentIndex >= slides.length - 1 ? 0 : currentIndex + 1;
    update(nextIndex);
  };

  const prev = () => {
    const prevIndex = currentIndex <= 0 ? slides.length - 1 : currentIndex - 1;
    update(prevIndex);
  };

  const stopAuto = () => {
    if (!intervalId) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const startAuto = () => {
    stopAuto();
    if (reducedMotion) return;
    intervalId = window.setInterval(() => {
      if (paused) return;
      if (!document.body.contains(carousel)) {
        stopAuto();
        return;
      }
      next();
    }, CAROUSEL_INTERVAL_MS);
  };

  prevButton?.addEventListener('click', () => {
    prev();
  });
  nextButton?.addEventListener('click', () => {
    next();
  });
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const nextIndex = Number(dot.dataset.carouselDot || 0);
      if (!Number.isFinite(nextIndex)) return;
      update(nextIndex);
    });
  });

  carousel.addEventListener('mouseenter', () => {
    paused = true;
  });
  carousel.addEventListener('mouseleave', () => {
    paused = false;
  });
  carousel.addEventListener('focusin', () => {
    paused = true;
  });
  carousel.addEventListener('focusout', () => {
    paused = false;
  });

  const handleTouchStart = event => {
    paused = true;
    touchStartX = Number(event.changedTouches?.[0]?.clientX || 0);
    touchStartY = Number(event.changedTouches?.[0]?.clientY || 0);
    touchStartedAt = Date.now();
  };

  const handleTouchEnd = event => {
    const endX = Number(event.changedTouches?.[0]?.clientX || 0);
    const endY = Number(event.changedTouches?.[0]?.clientY || 0);
    const startX = Number(touchStartX || 0);
    const startY = Number(touchStartY || 0);
    const elapsed = Date.now() - touchStartedAt;
    touchStartX = null;
    touchStartY = null;
    touchStartedAt = 0;

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY);
    const validSwipe = Math.abs(deltaX) >= 34 && Math.abs(deltaY) <= 72 && elapsed <= 700;
    if (horizontalIntent && validSwipe) {
      carousel.dataset.swipeLockUntil = String(Date.now() + 280);
      if (deltaX < 0) next();
      else prev();
    }
    window.setTimeout(() => {
      paused = false;
    }, 300);
  };

  const handleResize = () => {
    update(currentIndex);
  };

  carousel.addEventListener('touchstart', handleTouchStart, { passive: true });
  carousel.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('resize', handleResize, { passive: true });

  update(0);
  startAuto();
  return () => {
    stopAuto();
    window.removeEventListener('resize', handleResize);
    carousel.removeEventListener('touchstart', handleTouchStart);
    carousel.removeEventListener('touchend', handleTouchEnd);
  };
}

function setupBoostCarousel(container) {
  const carousels = Array.from(container.querySelectorAll('[data-home-carousel]'));
  if (!carousels.length) return () => {};
  const cleanups = carousels.map(carousel => setupSingleCarousel(carousel));
  return () => {
    cleanups.forEach(cleanup => {
      if (typeof cleanup === 'function') cleanup();
    });
  };
}

function setupInteractions(container) {
  const handleClick = event => {
    const ctaButton = event.target.closest('[data-home-action="discover"]');
    if (ctaButton) {
      requestVitrineNavigation(SHOP_SLUG, {
        source: 'home-hero-cta',
        skipThrottle: true
      });
      return;
    }

    const boostButton = event.target.closest('[data-boost-open]');
    if (boostButton) {
      const carousel = event.target.closest('[data-home-carousel]');
      const swipeLockUntil = Number(carousel?.dataset?.swipeLockUntil || 0);
      if (swipeLockUntil > Date.now()) {
        return;
      }
      const slide = boostButton.closest('[data-boost-slide]');
      const itemId = String(slide?.dataset?.boostId || '').trim();
      const itemKind = normalizeBoostItemKind(slide?.dataset?.boostKind);
      if (!itemId || !itemKind) return;
      requestVitrineNavigation('item-detail', {
        source: 'home-boost-card',
        skipThrottle: true,
        query: { type: itemKind, id: itemId }
      });
      return;
    }

    const serviceCard = event.target.closest('[data-home-service-slug]');
    if (serviceCard) {
      const slug = String(serviceCard.dataset.homeServiceSlug || '').trim();
      if (slug) {
        requestVitrineNavigation('service-detail', { slug });
      }
      return;
    }

    const seeServicesBtn = event.target.closest('[data-home-action="see-services"]');
    if (seeServicesBtn) {
      requestVitrineNavigation('prestations', { source: 'home-services-cta', skipThrottle: true });
      return;
    }

    const collectionCard = event.target.closest('[data-home-collection-action]');
    if (!collectionCard) return;
    const collectionCarousel = event.target.closest('[data-home-carousel]');
    const swipeLockUntil = Number(collectionCarousel?.dataset?.swipeLockUntil || 0);
    if (swipeLockUntil > Date.now()) {
      return;
    }
    const action = String(collectionCard.dataset.homeCollectionAction || '').trim();
    if (action === 'gift-card') {
      requestVitrineNavigation('gift-card', {
        source: 'home-collection-gift-card',
        skipThrottle: true
      });
      return;
    }
    if (action === 'collection') {
      const type = String(collectionCard.dataset.homeCollectionType || '').trim().toLowerCase();
      if (!type) return;
      requestVitrineNavigation(SHOP_SLUG, {
        source: 'home-collection',
        skipThrottle: true,
        query: { type }
      });
    }
  };

  container.addEventListener('click', handleClick);
  return () => {
    container.removeEventListener('click', handleClick);
  };
}

function mountHomeView(container, data) {
  container.innerHTML = buildHomeMarkup(data);
  const cleanupFns = [
    setupRevealAnimations(container),
    setupBoostCarousel(container, data?.highlights || []),
    setupBoostRatings(container, data?.highlights || []),
    setupInteractions(container)
  ];
  return () => {
    cleanupFns.forEach(cleanup => {
      if (typeof cleanup === 'function') cleanup();
    });
  };
}

export async function renderPage(container) {
  if (!container) return;
  if (typeof activeCleanup === 'function') {
    activeCleanup();
    activeCleanup = null;
  }

  const startedAt = Date.now();
  container.innerHTML = buildLoaderMarkup();
  try {
    const data = await loadHomeData();
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    activeCleanup = mountHomeView(container, data);
  } catch (error) {
    console.error('Erreur chargement accueil premium', error);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    container.innerHTML =
      '<p class="module-placeholder">Impossible de charger la page d accueil.</p>';
  }
}
