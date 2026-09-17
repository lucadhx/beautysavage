import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { showToast } from '../helpers/toastService.js';

const API_BOOKINGS = '/api/client/bookings';
const API_CANCEL = bookingId => `/api/client/bookings/${bookingId}/cancel`;

function escHtml(v = '') {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function injectCss() {
  if (document.getElementById('msm-styles')) return;
  const link = document.createElement('link');
  link.id = 'msm-styles';
  link.rel = 'stylesheet';
  link.href = '/css/myServicesModule.css';
  document.head.appendChild(link);
}

function getStatusMeta(booking) {
  const now = new Date();
  if (booking.status === 'cancelled') return { label: 'Annulée', cls: 'msm-badge--cancelled' };
  if (booking.status === 'completed') return { label: 'Terminée', cls: 'msm-badge--completed' };
  if (new Date(booking.startAt) < now) return { label: 'Passée', cls: 'msm-badge--past' };
  return { label: 'Confirmée', cls: 'msm-badge--confirmed' };
}

function canCancel(booking) {
  if (booking.status === 'cancelled' || booking.status === 'completed') return false;
  return new Date(booking.startAt) > new Date();
}

function buildBookingCard(booking, onCancel) {
  const statusMeta = getStatusMeta(booking);
  const cancelable = canCancel(booking);
  const isPaid = ['paid', 'deposit_paid'].includes(booking.paymentStatus);
  const paymentLabel = booking.paymentType === 'deposit' && booking.paymentStatus === 'deposit_paid'
    ? `Acompte payé : ${Number(booking.depositAmount || 0).toFixed(2)} € — Reste à régler sur place : ${Math.max(0, (booking.totalPrice || 0) - (booking.depositAmount || 0)).toFixed(2)} €`
    : `${Number(booking.totalPrice || 0).toFixed(2)} €`;

  const card = document.createElement('article');
  card.className = 'msm-card';
  card.innerHTML = `
    <div class="msm-card__header">
      <div class="msm-card__header-left">
        <i class="bi bi-scissors msm-card__icon"></i>
        <span class="msm-card__service">${escHtml(booking.serviceName)}</span>
      </div>
      <span class="msm-badge ${escHtml(statusMeta.cls)}">${escHtml(statusMeta.label)}</span>
    </div>
    <div class="msm-card__body">
      <div class="msm-card__detail-row">
        <i class="bi bi-calendar3"></i>
        <span>${escHtml(formatDate(booking.startAt))}</span>
      </div>
      <div class="msm-card__detail-row">
        <i class="bi bi-clock"></i>
        <span>${escHtml(formatTime(booking.startAt))} → ${escHtml(formatTime(booking.endAt))}</span>
      </div>
      ${booking.practitionerName ? `
        <div class="msm-card__detail-row">
          <i class="bi bi-person-badge"></i>
          <span>${escHtml(booking.practitionerName)}</span>
        </div>
      ` : ''}
      <div class="msm-card__detail-row msm-card__detail-row--price">
        <i class="bi bi-credit-card"></i>
        <span>${escHtml(paymentLabel)}</span>
      </div>
    </div>
    <div class="msm-card__footer" data-msm-footer${cancelable ? '' : ' style="display:none"'}>
      ${cancelable ? `
        <button class="msm-cancel-btn" data-cancel="${escHtml(booking.bookingId)}">
          <i class="bi bi-x-circle"></i> Annuler
        </button>
      ` : ''}
      <a class="msm-invoice-btn" data-msm-invoice-btn style="display:none" target="_blank" rel="noopener noreferrer">
        <i class="bi bi-file-earmark-pdf"></i> Facture
      </a>
    </div>
  `;

  if (cancelable) {
    card.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel(booking));
  }

  if (isPaid && booking.bookingId) {
    fetch(`/api/client/bookings/${encodeURIComponent(booking.bookingId)}/invoice`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.ok || !data.pdfUrl) return;
        const btn = card.querySelector('[data-msm-invoice-btn]');
        if (!btn) return;
        btn.href = data.pdfUrl;
        btn.style.display = '';
        const footer = card.querySelector('[data-msm-footer]');
        if (footer) footer.style.display = '';
      })
      .catch(() => {});
  }

  return card;
}

async function handleCancel(booking, container, reload) {
  // Show modal with skeleton while fetching eligibility
  let resolveConfirm;
  const confirmPromise = new Promise(resolve => { resolveConfirm = resolve; });

  const overlay = document.createElement('div');
  overlay.className = 'msm-confirm-overlay';
  overlay.innerHTML = `
    <div class="msm-confirm-modal">
      <p class="msm-confirm-modal__title">Annuler votre réservation ?</p>
      <p class="msm-confirm-modal__booking"><strong>${escHtml(booking.serviceName)}</strong> · ${escHtml(formatDate(booking.startAt))}</p>
      <div class="msm-confirm-modal__eligibility" id="msm-elig-info">
        <div class="msm-elig-skeleton"></div>
      </div>
      <div class="msm-confirm-modal__btns">
        <button class="msm-confirm-modal__cancel" data-no>Garder ma réservation</button>
        <button class="msm-confirm-modal__ok msm-confirm-modal__ok--danger" data-yes disabled>Confirmer l'annulation</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-no]').addEventListener('click', () => { overlay.remove(); resolveConfirm(false); });
  overlay.querySelector('[data-yes]').addEventListener('click', () => { overlay.remove(); resolveConfirm(true); });

  // Fetch eligibility
  try {
    const r = await fetch(`/api/client/bookings/${encodeURIComponent(booking.bookingId)}/refund-eligibility`, { credentials: 'include' });
    const elig = await r.json();
    const infoEl = document.getElementById('msm-elig-info');
    if (infoEl && elig.ok) {
      let reasonLabel = '';
      if (!elig.eligibleRefund) {
        if (elig.waiverSigned) reasonLabel = 'Renonciation signée lors de la réservation.';
        else reasonLabel = 'Délai d\'annulation dépassé.';
      } else {
        if (elig.reason === 'retractation') reasonLabel = 'Droit de rétractation légal (14 jours).';
        else reasonLabel = 'Dans le délai d\'annulation de l\'institut.';
      }
      const amountStr = elig.refundAmount > 0
        ? (elig.refundAmount).toFixed(2).replace('.', ',') + ' €'
        : '';
      infoEl.innerHTML = elig.eligibleRefund
        ? `<div class="msm-elig msm-elig--yes"><i class="bi bi-check-circle-fill"></i><div><strong>Remboursement : ${escHtml(amountStr)}</strong><p>${escHtml(reasonLabel)} Un email de suivi vous sera envoyé.</p></div></div>`
        : `<div class="msm-elig msm-elig--no"><i class="bi bi-x-circle-fill"></i><div><strong>Pas de remboursement</strong><p>${escHtml(reasonLabel)}</p></div></div>`;
    } else if (infoEl) {
      infoEl.innerHTML = '';
    }
  } catch (_) {
    const infoEl = document.getElementById('msm-elig-info');
    if (infoEl) infoEl.innerHTML = '';
  }

  // Enable confirm button after eligibility loaded
  const yesBtn = overlay.querySelector('[data-yes]');
  if (yesBtn) yesBtn.disabled = false;

  const confirmed = await confirmPromise;
  if (!confirmed) return;

  try {
    const res = await fetch(API_CANCEL(booking.bookingId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur annulation.');
    if (data.eligibleRefund) {
      const amt = data.refundAmount > 0 ? ' (' + Number(data.refundAmount).toFixed(2).replace('.', ',') + ' €)' : '';
      showToast({ type: 'success', message: 'Réservation annulée. Remboursement en cours' + amt + '.' });
    } else {
      showToast({ type: 'success', message: 'Réservation annulée.' });
    }
    reload();
  } catch (e) {
    showToast({ type: 'error', message: e.message || 'Impossible d\'annuler la réservation.' });
  }
}

export async function renderModule(container) {
  injectCss();

  container.innerHTML = `
    <div class="msm-root">
      <div class="msm-header">
        <h2 class="msm-title"><i class="bi bi-scissors"></i> Mes prestations</h2>
        <button class="msm-book-btn" id="msm-book-btn">
          <i class="bi bi-calendar-plus"></i> Prendre un rendez-vous
        </button>
      </div>
      <div class="msm-body" id="msm-body">
        <div class="msm-loader"><i class="bi bi-arrow-repeat msm-spin"></i></div>
      </div>
    </div>
  `;

  container.querySelector('#msm-book-btn')?.addEventListener('click', () => {
    requestVitrineNavigation('prestations');
  });

  async function load() {
    const body = container.querySelector('#msm-body');
    body.innerHTML = '<div class="msm-loader"><i class="bi bi-arrow-repeat msm-spin"></i></div>';

    try {
      const res = await fetch(API_BOOKINGS, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur chargement.');

      const bookings = data.bookings || [];

      if (!bookings.length) {
        body.innerHTML = `
          <div class="msm-empty">
            <i class="bi bi-calendar-x msm-empty__icon"></i>
            <p>Vous n'avez pas encore de réservation.</p>
            <button class="msm-book-btn-inline" data-goto-services>Découvrir nos prestations</button>
          </div>
        `;
        body.querySelector('[data-goto-services]')?.addEventListener('click', () => {
          requestVitrineNavigation('prestations');
        });
        return;
      }

      body.innerHTML = '';
      const now = new Date();
      const upcoming = bookings.filter(b => b.status !== 'cancelled' && new Date(b.startAt) > now);
      const past = bookings.filter(b => b.status === 'cancelled' || new Date(b.startAt) <= now);

      if (upcoming.length) {
        const section = document.createElement('section');
        section.className = 'msm-section';
        section.innerHTML = `<h3 class="msm-section__title">À venir</h3>`;
        for (const b of upcoming) {
          section.appendChild(buildBookingCard(b, booking => handleCancel(booking, container, load)));
        }
        body.appendChild(section);
      }

      if (past.length) {
        const section = document.createElement('section');
        section.className = 'msm-section';
        section.innerHTML = `<h3 class="msm-section__title">Historique</h3>`;
        for (const b of past) {
          section.appendChild(buildBookingCard(b, booking => handleCancel(booking, container, load)));
        }
        body.appendChild(section);
      }

    } catch (e) {
      const body = container.querySelector('#msm-body');
      body.innerHTML = `<p class="msm-error"><i class="bi bi-exclamation-circle"></i> ${escHtml(e.message || 'Erreur')}</p>`;
    }
  }

  await load();
}

export async function renderPage(container, context) {
  return renderModule(container, context);
}
