import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { createBookingCalendar } from './bookingCalendarComponent.js';

const API_SERVICE = slug => `/api/vitrine/services/${slug}`;

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
  if (h === 0) return `${m} min`;
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, '0')}`;
}

function injectCss() {
  if (document.getElementById('sdd-styles')) return;
  const link = document.createElement('link');
  link.id = 'sdd-styles';
  link.rel = 'stylesheet';
  link.href = '/css/serviceDetailModule.css';
  document.head.appendChild(link);
  if (!document.getElementById('sbm-styles')) {
    const l2 = document.createElement('link');
    l2.id = 'sbm-styles';
    l2.rel = 'stylesheet';
    l2.href = '/css/serviceBookingModule.css';
    document.head.appendChild(l2);
  }
}

// ─── Booking modal helpers ─────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function formatSlotTime(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ─── Booking modal (using bookingCalendarComponent) ────────────────────────

function createBookingModal(service) {
  // Track currently selected slot (set via component callback)
  let selectedSlot = null;
  let calendarInstance = null;

  const overlay = document.createElement('div');
  overlay.className = 'sbm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  function close() {
    calendarInstance?.destroy();
    calendarInstance = null;
    overlay.remove();
  }

  function navigateToCheckout() {
    if (!selectedSlot) return;
    const practitionerId = selectedSlot.practitionerId || '';
    close();
    requestVitrineNavigation('checkout', {
      query: {
        serviceSlug: service.slug,
        slotStart: selectedSlot.start,
        slotEnd: selectedSlot.end,
        practitionerId
      }
    });
  }

  function renderSlotRecap() {
    const recapEl = overlay.querySelector('.sbm-slot-recap');
    if (!recapEl) return;
    if (!selectedSlot) {
      recapEl.hidden = true;
      recapEl.innerHTML = '';
      return;
    }
    recapEl.hidden = false;
    recapEl.innerHTML = `
      <div class="sbm-slot-recap__info">
        <span>${escHtml(service.name)}</span>
        <span class="sbm-slot-recap__time"><i class="bi bi-clock" aria-hidden="true"></i> ${formatSlotTime(selectedSlot.start)} → ${formatSlotTime(selectedSlot.end)}</span>
        <span class="sbm-slot-recap__price">${Number(service.effectivePrice ?? service.price).toFixed(2)} €</span>
      </div>
      <button class="sbm-confirm-btn" data-sbm-continue>
        <i class="bi bi-arrow-right" aria-hidden="true"></i> Continuer vers le paiement
      </button>
    `;
    recapEl.querySelector('[data-sbm-continue]')?.addEventListener('click', navigateToCheckout);
  }

  function open() {
    overlay.innerHTML = `
      <div class="sbm-modal">
        <div class="sbm-modal__header">
          <span class="sbm-modal__title"><i class="bi bi-calendar3" aria-hidden="true"></i> Réserver — ${escHtml(service.name)}</span>
          <button class="sbm-modal__close" data-sbm-close aria-label="Fermer"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
        <div class="sbm-modal__body">
          <div class="sbm-calendar-mount"></div>
          <div class="sbm-slot-recap" hidden></div>
        </div>
      </div>
    `;

    overlay.querySelector('[data-sbm-close]')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.body.appendChild(overlay);

    const mountEl = overlay.querySelector('.sbm-calendar-mount');
    calendarInstance = createBookingCalendar({
      mode: 'service',
      serviceId: service.id,
      leadDays: service.bookingLeadDays || 0,
      onSlotSelected: slot => {
        selectedSlot = slot;
        renderSlotRecap();
      }
    });
    calendarInstance.mount(mountEl);
  }

  return { open };
}

function buildGallery(photos) {
  if (!photos || !photos.length) return '';
  const [main, ...rest] = photos;
  const thumbs = rest.map((url, i) => `
    <button class="sdd-thumb-btn" data-sdd-photo="${escHtml(url)}" data-idx="${i + 1}" aria-label="Photo ${i + 2}">
      <img src="${escHtml(url)}" alt="Photo ${i + 2}" loading="lazy">
    </button>
  `).join('');

  return `
    <div class="sdd-gallery">
      <div class="sdd-gallery__main">
        <img src="${escHtml(main)}" alt="Photo principale" class="sdd-gallery__main-img" id="sdd-main-photo">
      </div>
      ${rest.length ? `<div class="sdd-gallery__thumbs">${thumbs}</div>` : ''}
    </div>
  `;
}

function buildOptionsSection(options) {
  if (!options || !options.length) return '';
  const items = options.map(opt => `
    <div class="sdd-option">
      <div class="sdd-option__info">
        <span class="sdd-option__name">${escHtml(opt.name)}</span>
        ${opt.description ? `<span class="sdd-option__desc">${escHtml(opt.description)}</span>` : ''}
      </div>
      <span class="sdd-option__price">+${escHtml(formatPrice(opt.price))}</span>
    </div>
  `).join('');
  return `
    <section class="sdd-section">
      <h3 class="sdd-section__title"><i class="bi bi-list-check"></i> Options disponibles</h3>
      <div class="sdd-options-list">${items}</div>
    </section>
  `;
}

function buildCancellationPolicy(cancellationDays) {
  const days = Number(cancellationDays);
  let text;
  if (!Number.isFinite(days) || days <= 0) {
    text = 'Annulation non remboursable.';
  } else {
    text = `Annulation gratuite jusqu'à ${days} jour${days > 1 ? 's' : ''} avant le rendez-vous.`;
  }
  return `
    <section class="sdd-section">
      <h3 class="sdd-section__title"><i class="bi bi-shield-check"></i> Politique d'annulation</h3>
      <p class="sdd-policy-text">${escHtml(text)}</p>
    </section>
  `;
}

function buildPractitionersSection(practitioners) {
  if (!practitioners || !practitioners.length) return '';
  const items = practitioners.map(p => {
    const thumb = p.photo
      ? `<img src="${escHtml(p.photo)}" alt="${escHtml(p.displayName || '')}" class="sdd-pract__photo">`
      : `<div class="sdd-pract__photo sdd-pract__photo--empty" style="background:${escHtml(p.color || '#c5bb96')}">
           <i class="bi bi-person-fill"></i>
         </div>`;
    return `
      <div class="sdd-pract">
        ${thumb}
        <span class="sdd-pract__name">${escHtml(p.displayName || 'Praticienne')}</span>
      </div>
    `;
  }).join('');

  return `
    <section class="sdd-section">
      <h3 class="sdd-section__title"><i class="bi bi-person-badge"></i> Avec</h3>
      <div class="sdd-pract-list">${items}</div>
    </section>
  `;
}

function buildPaymentInfo(service) {
  const { paymentType, depositValue, depositType, price } = service;
  if (paymentType === 'free') return `<span class="sdd-payment-badge"><i class="bi bi-gift"></i> Gratuit</span>`;
  if (paymentType === 'deposit') {
    const depositLabel = depositType === 'percentage'
      ? `Acompte de ${depositValue}% requis`
      : `Acompte de ${formatPrice(depositValue)} requis`;
    return `<span class="sdd-payment-badge sdd-payment-badge--deposit"><i class="bi bi-piggy-bank"></i> ${escHtml(depositLabel)}</span>`;
  }
  return `<span class="sdd-payment-badge"><i class="bi bi-credit-card"></i> Paiement complet : ${escHtml(formatPrice(price))}</span>`;
}

export async function renderModule(container, context) {
  injectCss();

  const slug = context?.query?.serviceSlug
    || context?.query?.id
    || null;

  if (!slug) {
    container.innerHTML = `<div class="sdd-root"><p class="sdd-error">Prestation introuvable.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="sdd-root">
      <div class="sdd-loader"><i class="bi bi-arrow-repeat sdd-spin"></i></div>
    </div>
  `;

  let service;
  try {
    const res = await fetch(API_SERVICE(slug), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data.service) throw new Error(data.error || 'Introuvable');
    service = data.service;
  } catch (_) {
    container.innerHTML = `
      <div class="sdd-root">
        <p class="sdd-error">Prestation introuvable.</p>
        <button class="sdd-back-btn" id="sdd-back"><i class="bi bi-arrow-left"></i> Retour aux prestations</button>
      </div>
    `;
    container.querySelector('#sdd-back')?.addEventListener('click', () =>
      requestVitrineNavigation('services')
    );
    return;
  }

  const priceHtml = service.hasPromo
    ? `<span class="sdd-price sdd-price--effective">${escHtml(formatPrice(service.effectivePrice))}</span>
       <span class="sdd-price sdd-price--original">${escHtml(formatPrice(service.price))}</span>
       <span class="sdd-promo-badge">${escHtml(service.promotionLabel)}</span>`
    : `<span class="sdd-price">${escHtml(formatPrice(service.price))}</span>`;

  container.innerHTML = `
    <div class="sdd-root">
      <button class="sdd-back-btn" id="sdd-back">
        <i class="bi bi-arrow-left"></i> Retour aux prestations
      </button>

      <div class="sdd-layout">
        <div class="sdd-col-main">
          ${buildGallery(service.photos)}

          ${service.description ? `
            <section class="sdd-section sdd-about-section">
              <h3 class="sdd-section__title"><i class="bi bi-file-text"></i> À propos de cette prestation</h3>
              <div class="sdd-about-body">${escHtml(service.description)}</div>
            </section>
          ` : ''}

          ${buildOptionsSection(service.options)}
          ${buildCancellationPolicy(service.cancellationDays)}
        </div>

        <aside class="sdd-col-aside">
          <div class="sdd-aside-card">
            <h1 class="sdd-aside-title">${escHtml(service.name)}</h1>
            ${service.shortDescription ? `<p class="sdd-aside-short">${escHtml(service.shortDescription)}</p>` : ''}

            <div class="sdd-aside-meta">
              <div class="sdd-aside-meta__item">
                <i class="bi bi-clock"></i>
                <span>${escHtml(formatDuration(service.duration))}</span>
              </div>
              ${(service.capacity || 1) > 1 ? `
                <div class="sdd-aside-meta__item">
                  <i class="bi bi-people"></i>
                  <span>Jusqu'à ${service.capacity} personnes</span>
                </div>
              ` : ''}
            </div>

            <div class="sdd-aside-price">${priceHtml}</div>

            <div class="sdd-aside-payment">${buildPaymentInfo(service)}</div>

            <button class="sdd-book-cta" id="sdd-book-btn"${context?.user ? ' disabled aria-busy="true"' : ''}>
              <i class="bi bi-calendar-check"></i>
              Réserver ce soin
            </button>
          </div>

          ${buildPractitionersSection(service.practitioners)}
        </aside>
      </div>
    </div>
  `;

  // Back button
  container.querySelector('#sdd-back')?.addEventListener('click', () =>
    requestVitrineNavigation('services')
  );

  // Gallery thumbnails
  container.querySelectorAll('[data-sdd-photo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mainImg = container.querySelector('#sdd-main-photo');
      if (mainImg) mainImg.src = btn.dataset.sddPhoto;
      container.querySelectorAll('.sdd-thumb-btn').forEach(b => b.classList.remove('sdd-thumb-btn--active'));
      btn.classList.add('sdd-thumb-btn--active');
    });
  });

  // Book button — open booking calendar modal
  const bookBtn = container.querySelector('#sdd-book-btn');
  if (bookBtn) {
    if (!service.isBookable) {
      bookBtn.disabled = true;
      bookBtn.textContent = 'Réservation indisponible';
    } else {
      bookBtn.addEventListener('click', () => {
        const modal = createBookingModal(service);
        modal.open();
      });
    }
  }

  // Suspension check — only if user is authenticated
  // Button is disabled by default (set via template attribute) and enabled here unless suspended
  if (context?.user) {
    // Non-blocking: fetch in parallel with UI already rendered
    fetch('/api/client/me/booking-status', { credentials: 'include', cache: 'no-store' })
      .then(suspRes => suspRes.ok ? suspRes.json() : Promise.reject(new Error('status check failed')))
      .then(suspData => {
        if (!bookBtn) return;
        if (suspData.bookingSuspended) {
          bookBtn.disabled = true;
          bookBtn.removeAttribute('aria-busy');
          bookBtn.style.opacity = '0.5';
          bookBtn.style.cursor = 'not-allowed';
          const banner = document.createElement('div');
          banner.className = 'idd-suspension-banner';
          banner.innerHTML = `
            <i class="bi bi-exclamation-triangle-fill"></i>
            <div>
              <strong>Compte temporairement suspendu</strong>
              <p>Suite à des absences non signalées, votre accès aux réservations est suspendu. Contactez-nous pour régulariser votre situation.</p>
            </div>
          `;
          bookBtn.insertAdjacentElement('afterend', banner);
        } else if (service.isBookable) {
          // Not suspended and service is bookable — enable the button
          bookBtn.disabled = false;
          bookBtn.removeAttribute('aria-busy');
        }
      })
      .catch(() => {
        // Non-blocking: network error → enable the button anyway (if still bookable)
        if (bookBtn && service.isBookable) {
          bookBtn.disabled = false;
          bookBtn.removeAttribute('aria-busy');
        }
      });
  }
}

export async function renderPage(container, context) {
  return renderModule(container, context);
}
