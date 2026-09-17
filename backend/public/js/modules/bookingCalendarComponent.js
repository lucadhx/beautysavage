/**
 * bookingCalendarComponent.js
 * Reusable booking calendar component — supports 'service' and 'formation' modes.
 * CSS prefix: bkc-*
 * No external dependencies beyond native fetch.
 */

// ─── CSS injection ────────────────────────────────────────────────────────────

function injectBkcCss() {
  if (document.getElementById('bkc-styles')) return;
  const link = document.createElement('link');
  link.id = 'bkc-styles';
  link.rel = 'stylesheet';
  link.href = '/css/bookingCalendar.css';
  document.head.appendChild(link);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function escHtml(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSlotTime(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateLong(isoOrDateStr) {
  const d = new Date(isoOrDateStr.length === 10 ? isoOrDateStr + 'T12:00:00' : isoOrDateStr);
  if (Number.isNaN(d.getTime())) return isoOrDateStr;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

// Monday-first day headers
const DAY_HEADERS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

// ─── Formation helpers ────────────────────────────────────────────────────────

/**
 * Builds a Map of dateStr → session[] from a sessions array.
 * Uses startDate of each session.
 */
function buildAvailableDaysFromSessions(sessions) {
  const map = new Map();
  for (const session of sessions) {
    if (!session.startDate) continue;
    const d = new Date(session.startDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = toDateStr(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(session);
  }
  return map;
}

// ─── Main factory ─────────────────────────────────────────────────────────────

/**
 * Creates a booking calendar component.
 *
 * @param {Object} options
 * @param {'service'|'formation'} options.mode
 * @param {string} [options.serviceId]          — service mode
 * @param {Array}  [options.sessions]           — formation mode
 * @param {Function} [options.onSlotSelected]   — service mode callback (slot)
 * @param {Function} [options.onSessionSelected]— formation mode callback (session)
 * @param {Function} [options.onBack]           — optional back button callback
 * @param {boolean}  [options.allowPractitionerChoice]
 * @param {number}   [options.initialMonth]     — 1-based
 * @param {number}   [options.initialYear]
 * @param {string}   [options.initialDate]      — YYYY-MM-DD
 * @param {number}   [options.leadDays]         — service mode: min days from today
 * @returns {{ mount, destroy, getSelectedSlot, reset }}
 */
export function createBookingCalendar(options = {}) {
  injectBkcCss();

  const {
    mode = 'service',
    serviceId = '',
    sessions = [],
    onSlotSelected = null,
    onSessionSelected = null,
    onBack = null,
    leadDays = 0,
    initialMonth = null,
    initialYear = null,
    initialDate = null
  } = options;

  // Internal state
  const now = new Date();
  const state = {
    // Calendar navigation
    year: initialYear || now.getFullYear(),
    month: initialMonth || (now.getMonth() + 1),

    // Step: 'calendar' | 'slots' | 'sessions'
    step: 'calendar',

    // Service mode
    availableDays: null,   // Set<string> after fetch
    loadingDays: false,
    selectedDate: initialDate || null,

    // Service slots
    availableSlots: [],
    loadingSlots: false,
    selectedSlot: null,

    // Formation mode
    sessionDaysMap: mode === 'formation' ? buildAvailableDaysFromSessions(sessions) : new Map(),
    selectedSession: null,
    daySessions: [],         // sessions for selected day

    // Errors
    error: null
  };

  // Root element
  let rootEl = null;

  // ─── Fetch helpers (service mode) ──────────────────────────────────────────

  async function loadDays() {
    if (mode !== 'service' || !serviceId) return;
    state.loadingDays = true;
    state.availableDays = null;
    state.error = null;
    render();
    try {
      const res = await fetch(
        `/api/vitrine/availability/days?serviceId=${encodeURIComponent(serviceId)}&month=${state.month}&year=${state.year}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur chargement disponibilités.');
      state.availableDays = new Set(data.availableDays || []);
    } catch (e) {
      state.error = e.message;
    }
    state.loadingDays = false;
    render();
  }

  async function loadSlots(dateStr) {
    if (mode !== 'service' || !serviceId) return;
    // Double RAF — let the browser paint the cell selection animation before replacing the DOM
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    state.loadingSlots = true;
    state.availableSlots = [];
    state.selectedSlot = null;
    state.error = null;
    render();
    try {
      const res = await fetch(
        `/api/vitrine/availability/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateStr)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur chargement créneaux.');
      state.availableSlots = data.slots || [];
    } catch (e) {
      state.error = e.message;
    }
    state.loadingSlots = false;
    render();
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderCalendarGrid() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today.getTime() + leadDays * 24 * 60 * 60 * 1000);

    const firstDay = new Date(state.year, state.month - 1, 1);
    const lastDay = new Date(state.year, state.month, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0

    const isCurrentMonth = state.year === today.getFullYear() && state.month === today.getMonth() + 1;
    const isPastMonth =
      state.year < today.getFullYear() ||
      (state.year === today.getFullYear() && state.month < today.getMonth() + 1);

    const headerCells = DAY_HEADERS.map(d => `<div class="bkc-hcell">${d}</div>`).join('');

    let cells = '';
    for (let i = 0; i < startDow; i++) {
      cells += `<div class="bkc-cell bkc-cell--empty"></div>`;
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d = new Date(state.year, state.month - 1, day);
      const dateStr = toDateStr(d);
      const isPast = d < minDate;
      const isToday = toDateStr(d) === toDateStr(today);

      let hasSlots = false;
      if (mode === 'service') {
        hasSlots = !isPast && state.availableDays?.has(dateStr) === true;
      } else {
        // formation: check map
        const daySessions = state.sessionDaysMap.get(dateStr) || [];
        hasSlots = !isPast && daySessions.length > 0;
      }

      const isSelected = dateStr === state.selectedDate;
      const isDisabled = isPast || (!state.loadingDays && state.availableDays !== null && mode === 'service' && !hasSlots)
        || (mode === 'formation' && !hasSlots && !isPast);

      let cls = 'bkc-cell';
      if (isDisabled || (isPast)) cls += ' bkc-cell--disabled';
      else if (hasSlots) cls += ' bkc-cell--available';
      if (isSelected && hasSlots) cls += ' bkc-cell--selected';
      if (isToday) cls += ' bkc-cell--today';

      const clickable = hasSlots && !isPast && !state.loadingDays;
      cells += `<div class="${cls}"${clickable ? ` data-bkc-date="${escHtml(dateStr)}"` : ''}>${day}</div>`;
    }

    return `
      <div class="bkc-nav">
        <button class="bkc-nav-btn" data-bkc-prev${isPastMonth ? ' disabled' : ''} aria-label="Mois précédent">
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <span class="bkc-title">${MONTH_NAMES[state.month - 1]} ${state.year}</span>
        <button class="bkc-nav-btn" data-bkc-next aria-label="Mois suivant">
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
      <div class="bkc-grid">
        ${headerCells}
        ${state.loadingDays
          ? `<div class="bkc-loading" style="grid-column:1/-1"><i class="bi bi-arrow-repeat bkc-spin" aria-hidden="true"></i> Chargement...</div>`
          : cells}
      </div>
      ${state.error ? `<p class="bkc-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ${escHtml(state.error)}</p>` : ''}
    `;
  }

  function renderSlots() {
    // Deduplicate by time
    const grouped = {};
    for (const slot of state.availableSlots) {
      const t = formatSlotTime(slot.start);
      if (!grouped[t]) grouped[t] = slot;
    }
    const times = Object.keys(grouped).sort();

    const dateLabel = state.selectedDate ? formatDateLong(state.selectedDate) : '';

    const slotsHtml = state.loadingSlots
      ? `<p class="bkc-loading"><i class="bi bi-arrow-repeat bkc-spin" aria-hidden="true"></i> Chargement des créneaux...</p>`
      : times.length
        ? `<div class="bkc-slots-grid">
            ${times.map(t => {
              const slot = grouped[t];
              const isSelected = state.selectedSlot?.start === slot.start;
              return `<button class="bkc-slot${isSelected ? ' bkc-slot--selected' : ''}" data-bkc-slot="${escHtml(JSON.stringify(slot))}">${escHtml(t)}</button>`;
            }).join('')}
          </div>`
        : `<p class="bkc-empty">Aucun créneau disponible ce jour.</p>`;

    return `
      <button class="bkc-back-btn" data-bkc-back>
        <i class="bi bi-arrow-left" aria-hidden="true"></i> ${escHtml(dateLabel)}
      </button>
      ${slotsHtml}
      ${state.error ? `<p class="bkc-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ${escHtml(state.error)}</p>` : ''}
    `;
  }

  function renderDaySessions() {
    const dateLabel = state.selectedDate ? formatDateLong(state.selectedDate) : '';
    const daySessions = state.daySessions || [];

    const cards = daySessions.map(session => {
      const isFull = (session.reservedCount || 0) >= (session.maxClients || Infinity);
      const isSelected = state.selectedSession?.id === session.id;
      let cls = 'bkc-session-card';
      if (isFull) cls += ' bkc-session-card--full';
      if (isSelected) cls += ' bkc-session-card--selected';

      const startLabel = session.startDate
        ? new Date(session.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : '';
      const available = isFull
        ? 'Complet'
        : `${(session.maxClients || 0) - (session.reservedCount || 0)} place(s) disponible(s)`;

      return `
        <div class="${cls}" data-bkc-session="${escHtml(JSON.stringify(session))}">
          <div class="bkc-session-card__date">${escHtml(startLabel)}</div>
          <div class="bkc-session-card__avail">${escHtml(available)}</div>
          ${isFull ? '' : `<div class="bkc-session-card__select"><i class="bi bi-calendar-check" aria-hidden="true"></i> Sélectionner</div>`}
        </div>
      `;
    }).join('');

    return `
      <button class="bkc-back-btn" data-bkc-back>
        <i class="bi bi-arrow-left" aria-hidden="true"></i> ${escHtml(dateLabel)}
      </button>
      ${cards || '<p class="bkc-empty">Aucune session disponible ce jour.</p>'}
      ${state.error ? `<p class="bkc-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ${escHtml(state.error)}</p>` : ''}
    `;
  }

  function render() {
    if (!rootEl) return;

    let inner = '';
    if (state.step === 'slots') {
      inner = renderSlots();
    } else if (state.step === 'sessions') {
      inner = renderDaySessions();
    } else {
      inner = renderCalendarGrid();
    }

    const backBtn = onBack
      ? `<button class="bkc-back-btn bkc-back-btn--external" data-bkc-external-back>
          <i class="bi bi-arrow-left" aria-hidden="true"></i> Retour
        </button>`
      : '';

    rootEl.innerHTML = `
      <div class="bkc-root">
        ${backBtn}
        ${inner}
      </div>
    `;

    attachEvents();
  }

  function attachEvents() {
    if (!rootEl) return;

    // External back
    rootEl.querySelector('[data-bkc-external-back]')?.addEventListener('click', () => {
      onBack?.();
    });

    // Month nav
    rootEl.querySelector('[data-bkc-prev]')?.addEventListener('click', () => {
      if (state.month === 1) { state.month = 12; state.year--; }
      else state.month--;
      state.selectedDate = null;
      if (mode === 'service') {
        loadDays();
      } else {
        render();
      }
    });

    rootEl.querySelector('[data-bkc-next]')?.addEventListener('click', () => {
      if (state.month === 12) { state.month = 1; state.year++; }
      else state.month++;
      state.selectedDate = null;
      if (mode === 'service') {
        loadDays();
      } else {
        render();
      }
    });

    // Day click
    rootEl.querySelectorAll('[data-bkc-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.bkcDate;
        state.selectedDate = dateStr;

        // Animate cell selection — remove old, force reflow, add new
        rootEl.querySelectorAll('.bkc-cell--selected').forEach(c => c.classList.remove('bkc-cell--selected'));
        void cell.offsetWidth; // force reflow so animation restarts
        cell.classList.add('bkc-cell--selected');

        if (mode === 'service') {
          state.step = 'slots';
          // loadSlots has its own double-RAF before the first render(), animation is safe
          loadSlots(dateStr);
        } else {
          // formation: get sessions for this day
          const daySessions = state.sessionDaysMap.get(dateStr) || [];
          state.daySessions = daySessions;

          if (daySessions.length === 1) {
            // Single session: direct select — no re-render so animation stays visible
            const session = daySessions[0];
            const isFull = (session.reservedCount || 0) >= (session.maxClients || Infinity);
            if (!isFull) {
              state.selectedSession = session;
              onSessionSelected?.(session);
            } else {
              // Show sessions view after animation frame
              requestAnimationFrame(() => requestAnimationFrame(() => {
                state.step = 'sessions';
                render();
              }));
            }
          } else {
            // Multi-session day — let animation paint before switching view
            requestAnimationFrame(() => requestAnimationFrame(() => {
              state.step = 'sessions';
              render();
            }));
          }
        }
      });
    });

    // Back button (internal — return to calendar)
    rootEl.querySelector('[data-bkc-back]')?.addEventListener('click', () => {
      state.step = 'calendar';
      state.selectedDate = null;
      state.selectedSlot = null;
      state.availableSlots = [];
      state.daySessions = [];
      render();
    });

    // Slot selection — in-place DOM update so animation isn't killed by re-render
    rootEl.querySelectorAll('[data-bkc-slot]').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const slot = JSON.parse(btn.dataset.bkcSlot);
          state.selectedSlot = slot;
          // Animate slot selection
          rootEl.querySelectorAll('.bkc-slot--selected').forEach(s => s.classList.remove('bkc-slot--selected'));
          void btn.offsetWidth;
          btn.classList.add('bkc-slot--selected');
          onSlotSelected?.(slot);
        } catch (_) { /* ignore */ }
      });
    });

    // Session card selection — in-place DOM update so animation isn't killed by re-render
    rootEl.querySelectorAll('[data-bkc-session]').forEach(card => {
      card.addEventListener('click', () => {
        try {
          const session = JSON.parse(card.dataset.bkcSession);
          const isFull = (session.reservedCount || 0) >= (session.maxClients || Infinity);
          if (isFull) return;
          state.selectedSession = session;
          rootEl.querySelectorAll('.bkc-session-card--selected').forEach(c => c.classList.remove('bkc-session-card--selected'));
          void card.offsetWidth;
          card.classList.add('bkc-session-card--selected');
          onSessionSelected?.(session);
        } catch (_) { /* ignore */ }
      });
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  function mount(el) {
    rootEl = el;
    render();
    if (mode === 'service') {
      loadDays();
    }
  }

  function destroy() {
    if (rootEl) {
      rootEl.innerHTML = '';
    }
    rootEl = null;
  }

  function getSelectedSlot() {
    if (mode === 'service') return state.selectedSlot;
    return state.selectedSession;
  }

  function reset() {
    const now2 = new Date();
    state.year = initialYear || now2.getFullYear();
    state.month = initialMonth || (now2.getMonth() + 1);
    state.step = 'calendar';
    state.availableDays = null;
    state.loadingDays = false;
    state.selectedDate = initialDate || null;
    state.availableSlots = [];
    state.loadingSlots = false;
    state.selectedSlot = null;
    state.selectedSession = null;
    state.daySessions = [];
    state.error = null;
    if (rootEl) {
      render();
      if (mode === 'service') loadDays();
    }
  }

  return { mount, destroy, getSelectedSlot, reset };
}
