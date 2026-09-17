import { showToast } from '../helpers/toastService.js';

// ─── API endpoints ───────────────────────────────────────────────────────────

const CALENDAR_EVENTS_API = '/api/gestion/availability/calendar-events';
const SCHEDULE_API = '/api/gestion/availability/schedule/me';
const EXCEPTIONS_API = '/api/gestion/availability/exceptions';
const BOOKINGS_API = '/api/gestion/bookings';

// ─── CSS injection ───────────────────────────────────────────────────────────

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/planningModule.css';
  document.head.appendChild(link);
}

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  calendar: null,
  root: null,
  myPractitionerId: null,
  currentFormationDetail: null // { sessionId, formationId, reservedCount, sessionStart, sessionStatus }
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Retourne une date au format YYYY-MM-DD en heure LOCALE (pas UTC).
 * toISOString() utilise UTC et provoque un décalage d'un jour pour les timezones positives.
 */
function localDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Retourne true si deux tableaux de slots {startTime, endTime} sont identiques.
 */
function isSameSlots(slotsA, slotsB) {
  if (!slotsA || !slotsB) return false;
  if (slotsA.length !== slotsB.length) return false;
  return slotsA.every((a, i) => {
    const b = slotsB[i];
    return a.startTime === b.startTime && a.endTime === b.endTime;
  });
}

/**
 * Retourne true si l'exception change réellement quelque chose par rapport au planning type.
 * Un badge "Modifié" ne doit s'afficher que si les valeurs divergent.
 */
function isDayReallyModified(exception, typeDaySchedule) {
  if (!exception) return false;

  if (exception.type === 'block' && exception.isFullDay) {
    // Modifié seulement si le planning type prévoyait ce jour comme actif
    return typeDaySchedule?.isWorking === true;
  }

  if (exception.type === 'modify') {
    // Si le planning type n'était pas actif → modification réelle
    if (!typeDaySchedule?.isWorking) return true;
    // Si les slots diffèrent → modification réelle
    return !isSameSlots(exception.slots || [], typeDaySchedule.slots || []);
  }

  return false;
}

// ─── Modal slots state ────────────────────────────────────────────────────────

/**
 * État local des plages du modal en cours d'édition.
 * Clé : dayKey ('edit' pour le modal jour, 'w0'-'w6' pour le modal semaine).
 * Valeur : [ { startTime, endTime }, ... ]
 * Mis à jour en temps réel à chaque ajout, suppression ou modification de plage.
 */
const modalSlotsState = {};

function initModalSlotsState(dayKey, slots) {
  modalSlotsState[dayKey] = slots.map(s => ({ startTime: s.startTime, endTime: s.endTime }));
}

function addSlotToState(dayKey, startTime, endTime) {
  if (!modalSlotsState[dayKey]) modalSlotsState[dayKey] = [];
  modalSlotsState[dayKey].push({ startTime, endTime });
}

function removeSlotFromState(dayKey, slotIdx) {
  if (!modalSlotsState[dayKey]) return;
  modalSlotsState[dayKey].splice(slotIdx, 1);
}

function updateSlotInState(dayKey, slotIdx, field, value) {
  if (!modalSlotsState[dayKey]?.[slotIdx]) return;
  modalSlotsState[dayKey][slotIdx][field] = value;
}

// ─── HTML template ───────────────────────────────────────────────────────────

function buildHtml() {
  return `
<div class="plm-root">
  <div class="plm-toolbar">
    <div class="plm-toolbar__left">
      <select class="plm-select" data-plm-view-select>
        <option value="timeGridWeek">Semaine</option>
        <option value="timeGridDay">Jour</option>
        <option value="dayGridMonth">Mois</option>
      </select>
      <div class="plm-nav">
        <button type="button" class="plm-btn-icon" data-plm-prev><i class="bi bi-chevron-left"></i></button>
        <button type="button" class="plm-btn-today" data-plm-today>Aujourd'hui</button>
        <button type="button" class="plm-btn-icon" data-plm-next><i class="bi bi-chevron-right"></i></button>
      </div>
      <h2 class="plm-title" data-plm-title></h2>
    </div>
    <div class="plm-toolbar__right">
      <button type="button" class="plm-btn-edit-view" data-plm-edit-view hidden>
        <i class="bi bi-pencil"></i>
        <span data-plm-edit-view-label>Modifier ce jour</span>
      </button>
      <button type="button" class="plm-btn-remind" data-plm-simulate-reminders>
        <i class="bi bi-bell"></i> Simuler les rappels
      </button>
      <button type="button" class="plm-btn-config" data-plm-config>
        <i class="bi bi-gear"></i> Disponibilités
      </button>
    </div>
  </div>

  <div class="plm-legend">
    <span class="plm-legend-item">
      <span class="plm-legend-dot plm-legend-dot--available"></span>Disponible
    </span>
    <span class="plm-legend-item">
      <span class="plm-legend-dot plm-legend-dot--unavailable"></span>Indisponible
    </span>
    <span class="plm-legend-item">
      <span class="plm-legend-dot plm-legend-dot--blocked"></span>Bloqué
    </span>
    <span class="plm-legend-item">
      <span class="plm-legend-dot plm-legend-dot--formation"></span>Formation
    </span>
    <span class="plm-legend-item">
      <span class="plm-legend-dot plm-legend-dot--booking"></span>Réservation
    </span>
  </div>

  <div class="plm-calendar" data-plm-calendar></div>

  <!-- Toolbar contextuelle -->
  <div class="plm-ctx-menu" data-plm-ctx-menu hidden></div>

  <!-- Modal disponibilités -->
  <div class="plm-modal-overlay" data-plm-modal="schedule" hidden>
    <div class="plm-modal">
      <div class="plm-modal__header">
        <i class="bi bi-gear"></i>
        <h3>Mes disponibilités habituelles</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="schedule"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="plm-modal__body" data-plm-schedule-body>
        <!-- injecté dynamiquement -->
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="schedule">Annuler</button>
        <button type="button" class="plm-btn-save" data-plm-save-schedule>Enregistrer</button>
      </div>
    </div>
  </div>

  <!-- Modal modifier un jour -->
  <div class="plm-modal-overlay" data-plm-modal="day-edit" hidden>
    <div class="plm-modal">
      <div class="plm-modal__header">
        <i class="bi bi-pencil"></i>
        <h3 data-plm-day-edit-title>Modifier ce jour</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="day-edit">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body" data-plm-day-edit-body>
        <!-- injecté dynamiquement -->
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="day-edit">Annuler</button>
        <button type="button" class="plm-btn-save" data-plm-save-day-edit>Enregistrer</button>
      </div>
    </div>
  </div>

  <!-- Modal modifier une semaine -->
  <div class="plm-modal-overlay" data-plm-modal="week-edit" hidden>
    <div class="plm-modal plm-modal--wide">
      <div class="plm-modal__header">
        <i class="bi bi-pencil"></i>
        <h3 data-plm-week-edit-title>Modifier cette semaine</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="week-edit">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body" data-plm-week-edit-body>
        <!-- injecté dynamiquement -->
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="week-edit">Annuler</button>
        <button type="button" class="plm-btn-save" data-plm-save-week-edit>Enregistrer la semaine</button>
      </div>
    </div>
  </div>

  <!-- Modal détail formation -->
  <div class="plm-modal-overlay" data-plm-modal="formation-detail" hidden>
    <div class="plm-modal plm-modal--wide">
      <div class="plm-modal__header">
        <i class="bi bi-mortarboard"></i>
        <div class="plm-fdet-header-info">
          <h3 data-plm-fdet-title>Formation</h3>
          <div class="plm-fdet-meta" data-plm-fdet-meta></div>
        </div>
        <button type="button" class="plm-modal__close" data-plm-modal-close="formation-detail">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body" data-plm-fdet-body>
        <!-- injecté dynamiquement -->
      </div>
      <div class="plm-modal__footer plm-fdet-footer" data-plm-fdet-footer style="display:none">
        <button type="button" class="plm-btn-danger" data-plm-cancel-session>
          <i class="bi bi-x-circle"></i> Annuler la session
        </button>
      </div>
    </div>
  </div>

  <!-- Modal confirmation annulation session -->
  <div class="plm-modal-overlay" data-plm-modal="cancel-confirm" hidden>
    <div class="plm-modal">
      <div class="plm-modal__header">
        <i class="bi bi-exclamation-triangle" style="color:var(--color-danger,#dc2626)"></i>
        <h3>Annuler cette session ?</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="cancel-confirm">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body">
        <p class="plm-fdet-confirm-msg" data-plm-cancel-confirm-msg>Cette action est irréversible. Les clients inscrits seront notifiés et recevront un email avec un lien pour choisir entre un remboursement ou un report.</p>
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="cancel-confirm">Annuler</button>
        <button type="button" class="plm-btn-danger" data-plm-confirm-cancel-session>Confirmer l'annulation</button>
      </div>
    </div>
  </div>

  <!-- Modal détail réservation prestation -->
  <div class="plm-modal-overlay" data-plm-modal="booking-detail" hidden>
    <div class="plm-modal">
      <div class="plm-modal__header">
        <i class="bi bi-scissors"></i>
        <div class="pbm-header-info">
          <h3 data-pbm-title>Réservation</h3>
          <div class="pbm-header-meta" data-pbm-meta></div>
        </div>
        <div class="pbm-badge-wrap" data-pbm-badge></div>
        <button type="button" class="plm-modal__close" data-plm-modal-close="booking-detail">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body" data-pbm-body>
        <!-- injecté dynamiquement -->
      </div>
      <div class="plm-modal__footer" data-pbm-footer style="display:none">
        <!-- injecté dynamiquement -->
      </div>
    </div>
  </div>

  <!-- Modal confirmation no-show -->
  <div class="plm-modal-overlay" data-plm-modal="noshow-confirm" hidden>
    <div class="plm-modal plm-modal--small">
      <div class="plm-modal__header">
        <i class="bi bi-person-x" style="color:var(--color-danger,#dc2626)"></i>
        <h3>Confirmer le no-show ?</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="noshow-confirm">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body">
        <p style="font-size:0.9rem;line-height:1.6">L'acompte sera conservé par l'institut. Cette action est irréversible.</p>
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="noshow-confirm">Annuler</button>
        <button type="button" class="plm-btn-danger" data-pbm-confirm-noshow>Confirmer</button>
      </div>
    </div>
  </div>

  <!-- Modal confirmation annulation réservation -->
  <div class="plm-modal-overlay" data-plm-modal="booking-cancel-confirm" hidden>
    <div class="plm-modal plm-modal--small">
      <div class="plm-modal__header">
        <i class="bi bi-exclamation-triangle" style="color:var(--color-danger,#dc2626)"></i>
        <h3>Annuler la réservation ?</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="booking-cancel-confirm">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body" data-pbm-cancel-msg>
        <p style="font-size:0.9rem;line-height:1.6">Le client sera notifié par email.</p>
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="booking-cancel-confirm">Fermer</button>
        <button type="button" class="plm-btn-danger" data-pbm-confirm-cancel>Confirmer l'annulation</button>
      </div>
    </div>
  </div>

  <!-- Modal simulation rappels — sélection de date -->
  <div class="plm-modal-overlay" data-plm-modal="remind-date" hidden>
    <div class="plm-modal plm-modal--small">
      <div class="plm-modal__header">
        <i class="bi bi-bell"></i>
        <h3>Simuler les rappels</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="remind-date">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="plm-modal__body">
        <p class="plm-remind-date__desc">Envoyer les rappels pour toutes les réservations du&nbsp;:</p>
        <input type="date" class="plm-remind-date__input" id="plm-remind-date-input">
        <p class="plm-remind-date__warning"><i class="bi bi-exclamation-triangle"></i> Les emails seront envoyés aux clients mais les rappels ne seront pas marqués comme envoyés (simulation uniquement).</p>
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="remind-date">Annuler</button>
        <button type="button" class="plm-btn-save" id="plm-remind-date-confirm"><i class="bi bi-send"></i> Envoyer</button>
      </div>
    </div>
  </div>

  <!-- Modal exception -->
  <div class="plm-modal-overlay" data-plm-modal="exception" hidden>
    <div class="plm-modal">
      <div class="plm-modal__header">
        <i class="bi bi-calendar-x"></i>
        <h3 data-plm-exc-modal-title>Bloquer un créneau</h3>
        <button type="button" class="plm-modal__close" data-plm-modal-close="exception"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="plm-modal__body">
        <div class="plm-form-group">
          <label class="plm-form-label">Date</label>
          <input type="date" class="plm-input" data-plm-exc-date>
        </div>
        <div class="plm-form-group">
          <label class="plm-form-label">Type de blocage</label>
          <label class="plm-toggle-slide">
            <input type="checkbox" class="plm-toggle-slide__input" data-plm-exc-fullday checked>
            <span class="plm-toggle-slide__track"><span class="plm-toggle-slide__thumb"></span></span>
            <span class="plm-toggle-slide__label">Journée entière</span>
          </label>
        </div>
        <div class="plm-time-range plm-day-slots--collapsed" data-plm-time-range>
          <div class="plm-form-row">
            <div class="plm-form-group">
              <label class="plm-form-label">De</label>
              <div data-tp-exc-start>${createTimePicker('09:00')}</div>
            </div>
            <div class="plm-form-group">
              <label class="plm-form-label">À</label>
              <div data-tp-exc-end>${createTimePicker('18:00')}</div>
            </div>
          </div>
        </div>
        <div class="plm-form-group">
          <label class="plm-form-label">Raison <span class="plm-optional">(optionnel)</span></label>
          <input type="text" class="plm-input" data-plm-exc-reason placeholder="Rendez-vous médical…">
        </div>
        <!-- champ caché pour l'ID en mode édition -->
        <input type="hidden" data-plm-exc-id value="">
      </div>
      <div class="plm-modal__footer">
        <button type="button" class="plm-btn-cancel" data-plm-modal-close="exception">Annuler</button>
        <button type="button" class="plm-btn-save" data-plm-save-exception>Bloquer</button>
      </div>
    </div>
  </div>
</div>
`;
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function escHtml(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTimeLocal(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getRoot() {
  return state.root;
}

function qs(selector, ctx) {
  return (ctx || getRoot()).querySelector(selector);
}

// ─── Time picker helpers (dropdown grille) ────────────────────────────────────

/**
 * Génère tous les slots de 07:00 à 22:00 par pas de 30 min
 */
function generateTimeSlots() {
  const slots = [];
  for (let h = 7; h <= 22; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 22 && m > 0) break;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

/**
 * Retourne la valeur HH:MM du time picker
 */
function getTimePickerValue(tpEl) {
  return tpEl?.querySelector('[data-tp-display]')?.textContent?.trim() || '09:00';
}

/**
 * Définit la valeur du time picker
 */
function setTimePickerValue(tpEl, value) {
  const disp = tpEl?.querySelector('[data-tp-display]');
  if (disp) disp.textContent = value;
}

/**
 * Crée le HTML du composant time picker dropdown
 */
function createTimePicker(initialValue = '09:00') {
  const val = initialValue || '09:00';
  return `<div class="plm-tp" data-plm-tp>
  <button type="button" class="plm-tp-trigger" data-tp-trigger>
    <span data-tp-display>${escHtml(val)}</span>
    <i class="bi bi-chevron-down plm-tp-caret"></i>
  </button>
  <div class="plm-tp-dropdown" data-tp-dropdown hidden></div>
</div>`;
}

/**
 * Injecte la grille dans le dropdown (optionnellement avec slots désactivés).
 * Le dropdown est appendé au body pour éviter le clipping des overflow.
 */
function renderDropdown(tpEl, onChangeCallback, disabledSlots = []) {
  const dropdown = tpEl._floatingDropdown;
  if (!dropdown) return;
  const currentValue = getTimePickerValue(tpEl);
  const slots = generateTimeSlots();
  dropdown.innerHTML = `<div class="plm-tp-grid">${
    slots.map(slot => {
      const isSelected = slot === currentValue;
      const isDisabled = disabledSlots.includes(slot);
      return `<button type="button" class="plm-tp-slot${isSelected ? ' plm-tp-slot--selected' : ''}${isDisabled ? ' plm-tp-slot--disabled' : ''}" data-slot="${escHtml(slot)}" ${isDisabled ? 'disabled' : ''}>${escHtml(slot)}</button>`;
    }).join('')
  }</div>`;
  dropdown.querySelectorAll('[data-slot]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setTimePickerValue(tpEl, btn.dataset.slot);
      closeAllDropdowns();
      if (typeof onChangeCallback === 'function') onChangeCallback();
    });
  });
}

/**
 * Ferme tous les dropdowns ouverts (retirés du body)
 */
function closeAllDropdowns() {
  document.querySelectorAll('.plm-tp-dropdown-floating').forEach(d => {
    d.remove();
    const tp = d._tpEl;
    if (tp) {
      tp._floatingDropdown = null;
      tp.removeAttribute('data-open');
    }
  });
}

/**
 * Attache les événements sur un time picker.
 * Le dropdown est appendé au body en position fixed pour éviter tout clipping.
 */
function attachTimePickerEvents(tpEl, onChangeCallback) {
  if (!tpEl) return;
  const trigger = tpEl.querySelector('[data-tp-trigger]');
  if (!trigger) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = Boolean(tpEl._floatingDropdown);
    closeAllDropdowns();
    if (!isOpen) {
      // CORRECTIF 1 : revalider le jour AVANT d'ouvrir pour mettre à jour disabledSlots
      const dayRow = tpEl.closest('[data-day]');
      if (dayRow) revalidateDay(dayRow);

      // Créer le dropdown flottant
      const dropdown = document.createElement('div');
      dropdown.className = 'plm-tp-dropdown plm-tp-dropdown-floating';
      dropdown._tpEl = tpEl;
      tpEl._floatingDropdown = dropdown;

      // Injecter le contenu AVANT d'appendre au body
      // (l'animation plmDropIn se déclenche à l'insertion — le contenu doit déjà être là)
      let disabled = [];
      try { disabled = JSON.parse(tpEl.dataset.disabledSlots || '[]'); } catch (_) {}
      renderDropdown(tpEl, onChangeCallback, disabled);

      // Positionner en fixed sous le trigger
      const rect = trigger.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.left = rect.left + 'px';
      dropdown.style.zIndex = '99999';

      // Appendre au body — déclenche l'animation une seule fois avec contenu déjà présent
      document.body.appendChild(dropdown);
      tpEl.setAttribute('data-open', '');

      setTimeout(() => {
        document.addEventListener('click', closeAllDropdowns, { once: true });
      }, 0);
    }
  });
}

/**
 * Revalide les slots interdits pour tous les pickers d'un dayRow.
 * Stocke les listes dans dataset.disabledSlots pour lecture à l'ouverture.
 * Re-rend uniquement les dropdowns actuellement ouverts.
 */
function revalidateDay(dayRow) {
  if (!dayRow) return;
  const allSlots = generateTimeSlots();
  const dayKey = dayRow.dataset.day;
  const stateSlots = modalSlotsState[dayKey];
  const rows = [...dayRow.querySelectorAll('[data-slot-index]')];
  const ranges = rows.map((row, i) => ({
    start: stateSlots?.[i]?.startTime ?? getTimePickerValue(row.querySelector('[data-tp-start] [data-plm-tp]')),
    end:   stateSlots?.[i]?.endTime   ?? getTimePickerValue(row.querySelector('[data-tp-end]   [data-plm-tp]')),
    startTp: row.querySelector('[data-tp-start] [data-plm-tp]'),
    endTp:   row.querySelector('[data-tp-end]   [data-plm-tp]')
  }));

  ranges.forEach((r, i) => {
    const prevEnd   = i > 0                ? ranges[i - 1].end   : '07:00';
    const nextStart = i < ranges.length - 1 ? ranges[i + 1].start : '22:00';

    // Pour startTp[i] : doit être >= prevEnd et < r.end
    const disabledStart = allSlots.filter(s => s < prevEnd || s >= r.end);
    // Pour endTp[i]   : doit être > r.start et <= nextStart
    const disabledEnd   = allSlots.filter(s => s <= r.start || s > nextStart);

    if (r.startTp) {
      r.startTp.dataset.disabledSlots = JSON.stringify(disabledStart);
      if (r.startTp._floatingDropdown) {
        renderDropdown(r.startTp, () => revalidateDay(dayRow), disabledStart);
      }
    }
    if (r.endTp) {
      r.endTp.dataset.disabledSlots = JSON.stringify(disabledEnd);
      if (r.endTp._floatingDropdown) {
        renderDropdown(r.endTp, () => revalidateDay(dayRow), disabledEnd);
      }
    }
  });
}

// ─── Context menu (toolbar contextuelle) ─────────────────────────────────────

function showCtxMenu(x, y, items) {
  const menu = qs('[data-plm-ctx-menu]');
  if (!menu) return;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.innerHTML = items.map(item =>
    `<button class="plm-ctx-btn${item.danger ? ' plm-ctx-btn--danger' : ''}" data-ctx-action="${escHtml(item.action)}" data-ctx-payload="${escHtml(JSON.stringify(item.payload || {}))}">` +
    `<i class="bi ${escHtml(item.icon)}"></i> ${escHtml(item.label)}</button>`
  ).join('');
  menu.removeAttribute('hidden');

  // Close on next outside click
  setTimeout(() => {
    document.addEventListener('click', closeCtxMenu, { once: true });
  }, 0);
}

function closeCtxMenu() {
  const menu = qs('[data-plm-ctx-menu]');
  if (menu) menu.setAttribute('hidden', '');
}

function bindCtxMenuActions() {
  const menu = qs('[data-plm-ctx-menu]');
  if (!menu) return;
  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-ctx-action]');
    if (!btn) return;
    const action = btn.dataset.ctxAction;
    let payload = {};
    try { payload = JSON.parse(btn.dataset.ctxPayload || '{}'); } catch (_) {}

    closeCtxMenu();

    if (action === 'edit-block') {
      // Ouvrir modal exception en mode édition
      const { exceptionId, event } = payload;
      if (!exceptionId) return;
      openExceptionModal({ exceptionId, event, editMode: true });
    } else if (action === 'unblock') {
      if (!payload.exceptionId) return;
      const confirmed = window.confirm('Supprimer ce blocage ?');
      if (!confirmed) return;
      fetch(`${EXCEPTIONS_API}/${payload.exceptionId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            showToast({ type: 'success', message: 'Blocage supprimé.' });
            if (state.calendar) state.calendar.refetchEvents();
          } else {
            showToast({ type: 'error', message: data.error || 'Erreur lors de la suppression.' });
          }
        })
        .catch(() => showToast({ type: 'error', message: 'Erreur réseau lors de la suppression.' }));
    }
  });
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(name) {
  const overlay = qs(`[data-plm-modal="${name}"]`);
  if (overlay) {
    overlay.hidden = false;
    overlay.removeAttribute('hidden');
  }
}

function closeModal(name) {
  const overlay = qs(`[data-plm-modal="${name}"]`);
  if (overlay) overlay.hidden = true;
  if (name === 'day-edit') {
    delete modalSlotsState['edit'];
  } else if (name === 'week-edit') {
    ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'].forEach(k => delete modalSlotsState[k]);
  }
}

// ─── Exception modal ──────────────────────────────────────────────────────────

/**
 * Ouvre le modal exception en mode création ou édition.
 * @param {Object} opts
 * @param {string}  [opts.date]        - date YYYY-MM-DD (mode création)
 * @param {string}  [opts.exceptionId] - ID pour mode édition
 * @param {Object}  [opts.event]       - props FullCalendar event (mode édition)
 * @param {boolean} [opts.editMode]    - true = PUT, false = POST
 */
function openExceptionModal({ date = '', exceptionId = '', event = null, editMode = false } = {}) {
  const root = getRoot();
  const titleEl = qs('[data-plm-exc-modal-title]');
  const dateInput = qs('[data-plm-exc-date]');
  const fulldayToggle = qs('[data-plm-exc-fullday]');
  const timeRange = qs('[data-plm-time-range]');
  const reasonInput = qs('[data-plm-exc-reason]');
  const idInput = qs('[data-plm-exc-id]');
  const saveBtn = qs('[data-plm-save-exception]');
  const toggleLabel = fulldayToggle?.closest('.plm-toggle-slide')?.querySelector('.plm-toggle-slide__label');

  // Réinitialiser
  if (idInput) idInput.value = exceptionId || '';
  if (titleEl) titleEl.textContent = editMode ? 'Modifier le blocage' : 'Bloquer un créneau';
  if (saveBtn) saveBtn.textContent = editMode ? 'Enregistrer' : 'Bloquer';

  if (editMode && event) {
    // Pré-remplir depuis l'event FullCalendar
    const props = event.extendedProps || {};
    const startStr = event.startStr || '';
    const endStr = event.endStr || '';
    const isAllDay = event.allDay;

    if (dateInput) {
      // Extraire YYYY-MM-DD depuis startStr
      dateInput.value = startStr.slice(0, 10);
    }

    if (fulldayToggle) {
      fulldayToggle.checked = isAllDay;
      if (toggleLabel) toggleLabel.textContent = isAllDay ? 'Journée entière' : 'Plage horaire';
    }
    if (timeRange) timeRange.classList.toggle('plm-day-slots--collapsed', isAllDay);

    if (!isAllDay) {
      // Pré-remplir les time pickers
      const startTime = startStr.length > 10 ? startStr.slice(11, 16) : '09:00';
      const endTime = endStr.length > 10 ? endStr.slice(11, 16) : '18:00';
      const startTpWrap = qs('[data-tp-exc-start]');
      const endTpWrap = qs('[data-tp-exc-end]');
      if (startTpWrap) {
        const tp = startTpWrap.querySelector('[data-plm-tp]');
        if (tp) setTimePickerValue(tp, startTime);
      }
      if (endTpWrap) {
        const tp = endTpWrap.querySelector('[data-plm-tp]');
        if (tp) setTimePickerValue(tp, endTime);
      }
    }

    if (reasonInput) reasonInput.value = event.title || '';
  } else {
    // Mode création
    if (dateInput) dateInput.value = date || '';
    if (fulldayToggle) {
      fulldayToggle.checked = true;
      if (toggleLabel) toggleLabel.textContent = 'Journée entière';
    }
    if (timeRange) timeRange.classList.add('plm-day-slots--collapsed');
    if (reasonInput) reasonInput.value = '';
  }

  openModal('exception');
}

// ─── FullCalendar fetch events ────────────────────────────────────────────────

function fetchEvents(info, successCb, failureCb) {
  const from = info.startStr;
  const to = info.endStr;
  const params = new URLSearchParams({ from, to });
  if (state.myPractitionerId) params.set('practitionerId', state.myPractitionerId);

  console.log('[DEBUG fetchEvents] url:', `${CALENDAR_EVENTS_API}?${params.toString()}`, 'myPractId:', state.myPractitionerId);
  fetch(`${CALENDAR_EVENTS_API}?${params.toString()}`, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      // Apply hardcoded colors for FullCalendar (CSS vars not supported in FC JS props)
      const events = (Array.isArray(data.events) ? data.events : []).map(ev => {
        const t = ev.extendedProps?.type || ev.type;
        if (t === 'formation') {
          return { ...ev, backgroundColor: '#5f4ff7', borderColor: '#5f4ff7', textColor: '#ffffff' };
        }
        if (t === 'booking') {
          const status = ev.extendedProps?.status;
          let bgColor = '#5f4ff7';
          if (status === 'completed') bgColor = 'rgba(31,122,58,0.82)';
          else if (status === 'no_show') bgColor = 'rgba(220,38,38,0.6)';
          return { ...ev, backgroundColor: bgColor, borderColor: 'transparent', textColor: '#fff' };
        }
        if (t === 'blocked' && !(Array.isArray(ev.classNames) && ev.classNames.includes('plm-event-unavailable'))) {
          return { ...ev, backgroundColor: 'rgba(0,0,0,0.08)', borderColor: 'rgba(0,0,0,0.2)', textColor: 'rgba(0,0,0,0.5)' };
        }
        if (t === 'available') {
          return { ...ev, display: 'background', backgroundColor: 'rgba(95,79,247,0.12)' };
        }
        return ev;
      });
      successCb(events);
    })
    .catch(err => {
      console.error('fetchEvents error', err);
      failureCb(err);
    });
}

// ─── Event click ──────────────────────────────────────────────────────────────

function handleEventClick(info) {
  const { type, exceptionId } = info.event.extendedProps || {};
  const jsEvent = info.jsEvent;
  const x = jsEvent.clientX;
  const y = jsEvent.clientY;

  if (type === 'blocked') {
    showCtxMenu(x, y, [
      { action: 'edit-block', icon: 'bi-pencil', label: 'Modifier', payload: { exceptionId, event: { startStr: info.event.startStr, endStr: info.event.endStr, allDay: info.event.allDay, title: info.event.title, extendedProps: info.event.extendedProps } } },
      { action: 'unblock', icon: 'bi-slash-circle', label: 'Débloquer', danger: true, payload: { exceptionId } }
    ]);
    return;
  }

  if (type === 'formation') {
    const { sessionId, formationId, formationName, sessionStatus } = info.event.extendedProps || {};
    openFormationDetailModal(
      String(sessionId || ''),
      String(formationId || ''),
      formationName || info.event.title || 'Formation',
      sessionStatus || 'active',
      info.event.start
    );
    return;
  }

  if (type === 'booking') {
    const { bookingId } = info.event.extendedProps || {};
    if (bookingId) openBookingDetailModal(bookingId);
    return;
  }
}

// ─── Date click ───────────────────────────────────────────────────────────────

function handleDateClick(info) {
  openDayModal(info.date);
}

// ─── Toolbar title + today button update ──────────────────────────────────────

function updateTitle() {
  const titleEl = qs('[data-plm-title]');
  if (titleEl && state.calendar) {
    titleEl.textContent = state.calendar.view.title;
  }
}

function updateTodayBtn() {
  const btn = qs('[data-plm-today]');
  if (!btn || !state.calendar) return;
  const now = new Date();
  const view = state.calendar.view;
  const isCurrentPeriod = view.activeStart <= now && now < view.activeEnd;
  if (isCurrentPeriod) {
    btn.innerHTML = "Aujourd'hui";
    btn.classList.remove('plm-btn-today--away');
  } else {
    const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    btn.innerHTML = `<i class="bi bi-house-fill" style="font-size:0.7rem"></i> ${dateStr}`;
    btn.classList.add('plm-btn-today--away');
  }
}

// ─── Schedule modal — multi-slots per day ─────────────────────────────────────

function buildSlotRow(slotIndex, startTime, endTime, isOnly) {
  return `
<div class="plm-slot-row" data-slot-index="${slotIndex}">
  <div data-tp-start>${createTimePicker(startTime)}</div>
  <span class="plm-time-sep">→</span>
  <div data-tp-end>${createTimePicker(endTime)}</div>
  <button type="button" class="plm-slot-remove${isOnly ? ' plm-slot-remove--hidden' : ''}" data-remove-slot="${slotIndex}" title="Supprimer cette plage">
    <i class="bi bi-trash"></i>
  </button>
</div>`;
}

function buildScheduleBody(schedule) {
  const weeklySchedule = schedule?.weeklySchedule || [];
  const byDay = {};
  for (const e of weeklySchedule) byDay[e.dayOfWeek] = e;

  let html = '<div class="plm-day-list">';
  for (let d = 0; d <= 6; d++) {
    const entry = byDay[d] || { dayOfWeek: d, isWorking: false, slots: [] };
    const isOn = entry.isWorking;
    const slots = (entry.slots && entry.slots.length > 0) ? entry.slots : [{ startTime: '09:00', endTime: '18:00' }];

    let slotsHtml = '';
    slots.forEach((slot, idx) => {
      slotsHtml += buildSlotRow(idx, slot.startTime || '09:00', slot.endTime || '18:00', slots.length === 1);
    });

    html += `
      <div class="plm-day-row" data-day="${d}">
        <div class="plm-day-header">
          <span class="plm-day-name">${escHtml(DAYS[d])}</span>
          <label class="plm-toggle-slide" data-day-toggle-label="${d}">
            <input type="checkbox" class="plm-toggle-slide__input" data-day-toggle="${d}" ${isOn ? 'checked' : ''}>
            <span class="plm-toggle-slide__track">
              <span class="plm-toggle-slide__thumb"></span>
            </span>
            <span class="plm-toggle-slide__label">${isOn ? 'Actif' : 'Repos'}</span>
          </label>
        </div>
        <div class="plm-day-slots${isOn ? '' : ' plm-day-slots--collapsed'}" data-day-slots="${d}">
          ${slotsHtml}
        </div>
        <button type="button" class="plm-slot-add${isOn ? '' : ' plm-slot-add--hidden'}" data-add-slot="${d}">
          <i class="bi bi-plus"></i> Ajouter une plage
        </button>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function attachDayToggleListeners(ctx) {
  // Day toggles — écouter change sur checkbox
  ctx.querySelectorAll('[data-day-toggle]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const d = checkbox.dataset.dayToggle;
      const isOn = checkbox.checked;
      // Mettre à jour le label
      const label = ctx.querySelector(`[data-day-toggle-label="${d}"] .plm-toggle-slide__label`);
      if (label) label.textContent = isOn ? 'Actif' : 'Repos';

      const slots = ctx.querySelector(`[data-day-slots="${d}"]`);
      const addBtn = ctx.querySelector(`[data-add-slot="${d}"]`);

      // Animation slide
      if (slots) {
        if (isOn) {
          slots.classList.remove('plm-day-slots--collapsed');
        } else {
          slots.classList.add('plm-day-slots--collapsed');
        }
      }
      if (addBtn) addBtn.classList.toggle('plm-slot-add--hidden', !isOn);
    });
  });

  // Add slot buttons
  ctx.querySelectorAll('[data-add-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.addSlot;
      const slotsContainer = ctx.querySelector(`[data-day-slots="${d}"]`);
      if (!slotsContainer) return;

      const existingRows = slotsContainer.querySelectorAll('[data-slot-index]');
      const newIdx = existingRows.length;

      // Make all existing remove buttons visible now (more than 1 slot)
      existingRows.forEach(row => {
        const removeBtn = row.querySelector('[data-remove-slot]');
        if (removeBtn) removeBtn.classList.remove('plm-slot-remove--hidden');
      });

      // Compute smart start = last slot end + 30 min (arrondi au slot 30min)
      let newStart = '09:00';
      let newEnd = '18:00';
      if (existingRows.length > 0) {
        const lastRow = existingRows[existingRows.length - 1];
        const endTpWrap = lastRow.querySelector('[data-tp-end]');
        const endTp = endTpWrap?.querySelector('[data-plm-tp]');
        if (endTp) {
          const lastEnd = getTimePickerValue(endTp);
          const [lh, lm] = lastEnd.split(':').map(Number);
          const startMin = lh * 60 + lm + 30;
          if (startMin < 22 * 60) {
            const sh = Math.floor(startMin / 60);
            const sm = Math.round((startMin % 60) / 30) * 30 % 60;
            newStart = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
            const endMin = Math.min(startMin + 120, 22 * 60);
            const eh = Math.floor(endMin / 60);
            const em = Math.round((endMin % 60) / 30) * 30 % 60;
            newEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
          }
        }
      }

      const tmp = document.createElement('div');
      tmp.innerHTML = buildSlotRow(newIdx, newStart, newEnd, false);
      const newRow = tmp.firstElementChild;
      slotsContainer.appendChild(newRow);

      // Récupérer le dayRow parent pour revalidation
      const dayRow = slotsContainer.closest('[data-day]');
      const dayKey = dayRow?.dataset.day;

      // Mettre à jour l'état avant d'initialiser les pickers
      if (dayKey) addSlotToState(dayKey, newStart, newEnd);

      // Initialise les time pickers du nouveau rang avec mise à jour de l'état
      initAllTimePickers(newRow);

      // Bind remove button on the new row
      const removeBtn = newRow.querySelector('[data-remove-slot]');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => removeSlotRow(removeBtn, slotsContainer));
      }

      // Revalider les contraintes de tous les pickers du jour
      if (dayRow) revalidateDay(dayRow);
    });
  });

  // Remove slot buttons (existing ones)
  ctx.querySelectorAll('[data-remove-slot]').forEach(btn => {
    const slotsContainer = btn.closest('[data-day-slots]');
    btn.addEventListener('click', () => removeSlotRow(btn, slotsContainer));
  });

  // Attach time picker events to all pickers in context (skip already-initialized)
  ctx.querySelectorAll('[data-day]').forEach(dayRow => {
    dayRow.querySelectorAll('[data-plm-tp]').forEach(tp => {
      if (!tp._tpInitialized) {
        attachTimePickerEvents(tp, () => revalidateDay(dayRow));
        tp._tpInitialized = true;
      }
    });
  });
}

/**
 * Initialise les time pickers non encore initialisés dans un conteneur.
 * Nécessaire quand le conteneur [data-day] est l'élément lui-même (pas un descendant)
 * — cas de openDayModal où body.dataset.day = 'edit', invisible pour querySelectorAll('[data-day]').
 * Le flag _tpInitialized évite la double initialisation.
 */
function initAllTimePickers(container) {
  container.querySelectorAll('[data-plm-tp]').forEach(tpEl => {
    if (!tpEl._tpInitialized) {
      const dayRow = tpEl.closest('[data-day]');
      const onChangeCb = dayRow ? () => {
        const dayKey = dayRow.dataset.day;
        const slotRow = tpEl.closest('[data-slot-index]');
        if (slotRow && dayKey) {
          const slotIdx = parseInt(slotRow.dataset.slotIndex, 10);
          const field = tpEl.closest('[data-tp-start]') ? 'startTime' : 'endTime';
          updateSlotInState(dayKey, slotIdx, field, getTimePickerValue(tpEl));
        }
        revalidateDay(dayRow);
      } : undefined;
      attachTimePickerEvents(tpEl, onChangeCb);
      tpEl._tpInitialized = true;
    }
  });
}

function removeSlotRow(removeBtn, slotsContainer) {
  const row = removeBtn.closest('[data-slot-index]');
  if (!row || !slotsContainer) return;
  const slotIdx = parseInt(row.dataset.slotIndex, 10);
  const dayRow = slotsContainer.closest('[data-day]');
  const dayKey = dayRow?.dataset.day;

  row.remove();

  // Re-index remaining rows and hide remove button if only one left
  const remaining = slotsContainer.querySelectorAll('[data-slot-index]');
  remaining.forEach((r, i) => {
    r.setAttribute('data-slot-index', i);
    const rb = r.querySelector('[data-remove-slot]');
    if (rb) {
      rb.setAttribute('data-remove-slot', i);
      rb.classList.toggle('plm-slot-remove--hidden', remaining.length === 1);
    }
  });

  if (dayKey) removeSlotFromState(dayKey, slotIdx);
  if (dayRow) revalidateDay(dayRow);
}

function collectScheduleData(bodyCtx) {
  const weeklySchedule = [];
  (bodyCtx || getRoot()).querySelectorAll('[data-day]').forEach(dayRow => {
    const dayOfWeek = parseInt(dayRow.dataset.day, 10);
    const toggle = dayRow.querySelector('[data-day-toggle]');
    const isWorking = toggle ? toggle.checked : false;
    const slots = [];
    dayRow.querySelectorAll('[data-slot-index]').forEach(slotRow => {
      const startTpWrap = slotRow.querySelector('[data-tp-start]');
      const endTpWrap = slotRow.querySelector('[data-tp-end]');
      const startTp = startTpWrap ? startTpWrap.querySelector('[data-plm-tp]') : null;
      const endTp = endTpWrap ? endTpWrap.querySelector('[data-plm-tp]') : null;
      if (startTp && endTp) {
        slots.push({
          startTime: getTimePickerValue(startTp),
          endTime: getTimePickerValue(endTp)
        });
      }
    });
    weeklySchedule.push({ dayOfWeek, isWorking, slots: isWorking ? slots : [] });
  });
  return { weeklySchedule };
}

function validateScheduleData(weeklySchedule) {
  for (const day of weeklySchedule) {
    if (!day.isWorking || day.slots.length < 2) continue;
    const ranges = day.slots.map(s => ({
      start: s.startTime,
      end: s.endTime
    }));
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        // Check overlap: a.start < b.end && b.start < a.end
        if (a.start < b.end && b.start < a.end) {
          return `${DAYS[day.dayOfWeek]} : deux plages horaires se chevauchent (${a.start}–${a.end} et ${b.start}–${b.end}).`;
        }
      }
    }
  }
  return null;
}

async function openScheduleModal() {
  const body = qs('[data-plm-schedule-body]');
  if (body) body.innerHTML = '<p class="plm-loading">Chargement...</p>';
  openModal('schedule');

  try {
    const res = await fetch(SCHEDULE_API, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      state.myPractitionerId = data.practitionerId || null;
      if (body) {
        body.innerHTML = buildScheduleBody(data.schedule);
        attachDayToggleListeners(body);
      }
    } else {
      if (body) body.innerHTML = `<p class="plm-error">${escHtml(data.error || 'Erreur chargement.')}</p>`;
    }
  } catch (e) {
    if (body) body.innerHTML = '<p class="plm-error">Erreur réseau.</p>';
  }
}

async function saveScheduleHandler() {
  const body = qs('[data-plm-schedule-body]');
  const { weeklySchedule } = collectScheduleData(body);

  const validationError = validateScheduleData(weeklySchedule);
  if (validationError) {
    showToast({ type: 'error', message: validationError });
    return;
  }

  const saveBtn = qs('[data-plm-save-schedule]');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement...';
  }

  try {
    const actualEndpoint = state.myPractitionerId
      ? `/api/gestion/availability/schedule/${state.myPractitionerId}`
      : SCHEDULE_API;

    const res = await fetch(actualEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeklySchedule })
    });
    const data = await res.json();
    if (data.ok) {
      showToast({ type: 'success', message: 'Disponibilités enregistrées.' });
      closeModal('schedule');
      if (state.calendar) state.calendar.refetchEvents();
      loadBusinessHours(state.myPractitionerId || undefined);
    } else {
      showToast({ type: 'error', message: data.error || 'Erreur enregistrement.' });
    }
  } catch (e) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Enregistrer';
    }
  }
}

// ─── Exception save handler ───────────────────────────────────────────────────

async function saveExceptionHandler() {
  const dateInput = qs('[data-plm-exc-date]');
  const fulldayToggle = qs('[data-plm-exc-fullday]');
  const reasonInput = qs('[data-plm-exc-reason]');
  const idInput = qs('[data-plm-exc-id]');

  const date = dateInput?.value;
  const isFullDay = fulldayToggle?.checked ?? true;
  const editMode = !!(idInput?.value);
  const exceptionId = idInput?.value || '';

  if (!date) {
    showToast({ type: 'error', message: 'Veuillez sélectionner une date.' });
    return;
  }

  const practitionerId = state.myPractitionerId;

  if (!practitionerId && !editMode) {
    showToast({ type: 'error', message: 'Aucune praticienne sélectionnée.' });
    return;
  }

  // Get start/end from time pickers if range mode
  let startTime = null;
  let endTime = null;
  if (!isFullDay) {
    const startTpWrap = qs('[data-tp-exc-start]');
    const endTpWrap = qs('[data-tp-exc-end]');
    if (startTpWrap) {
      const tp = startTpWrap.querySelector('[data-plm-tp]');
      if (tp) startTime = getTimePickerValue(tp);
    }
    if (endTpWrap) {
      const tp = endTpWrap.querySelector('[data-plm-tp]');
      if (tp) endTime = getTimePickerValue(tp);
    }
  }

  const saveBtn = qs('[data-plm-save-exception]');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = editMode ? 'Enregistrement...' : 'Blocage...';
  }

  try {
    const bodyData = {
      date,
      type: 'block',
      isFullDay,
      startTime,
      endTime,
      reason: reasonInput?.value || ''
    };

    let res;
    if (editMode) {
      res = await fetch(`${EXCEPTIONS_API}/${exceptionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
    } else {
      bodyData.practitionerId = practitionerId;
      res = await fetch(EXCEPTIONS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
    }

    const data = await res.json();
    if (data.ok) {
      showToast({ type: 'success', message: editMode ? 'Blocage modifié.' : 'Créneau bloqué.' });
      closeModal('exception');
      if (state.calendar) state.calendar.refetchEvents();
    } else {
      showToast({ type: 'error', message: data.error || 'Erreur lors du blocage.' });
    }
  } catch (e) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = editMode ? 'Enregistrer' : 'Bloquer';
    }
  }
}

// ─── Bouton contextuel "Modifier" ─────────────────────────────────────────────

function updateEditViewBtn() {
  const btn = qs('[data-plm-edit-view]');
  const label = qs('[data-plm-edit-view-label]');
  if (!btn || !state.calendar) return;

  if (!state.myPractitionerId) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;
  const viewType = state.calendar.view.type;
  if (viewType === 'timeGridDay') {
    if (label) label.textContent = 'Modifier ce jour';
  } else if (viewType === 'timeGridWeek') {
    if (label) label.textContent = 'Modifier cette semaine';
  } else {
    if (label) label.textContent = 'Modifier mon planning type';
  }
}

function handleEditViewClick() {
  const viewType = state.calendar?.view?.type;
  if (viewType === 'timeGridDay') {
    const currentDate = state.calendar.view.currentStart;
    openDayModal(currentDate);
  } else if (viewType === 'timeGridWeek') {
    const weekStart = state.calendar.view.currentStart;
    openWeekModal(weekStart);
  } else {
    openScheduleModal();
  }
}

// ─── Modal "Modifier ce jour" ─────────────────────────────────────────────────

async function openDayModal(date) {
  const title = qs('[data-plm-day-edit-title]');
  const body = qs('[data-plm-day-edit-body]');

  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (title) title.textContent = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);

  if (body) body.innerHTML = '<p class="plm-loading">Chargement...</p>';
  openModal('day-edit');

  const practId = state.myPractitionerId;
  if (!practId) {
    if (body) body.innerHTML = '<p class="plm-error">Aucune praticienne sélectionnée.</p>';
    return;
  }

  const saveBtn = qs('[data-plm-save-day-edit]');
  if (saveBtn) saveBtn.dataset.editDate = localDateStr(date);

  try {
    const dateStr = localDateStr(date);
    const excRes = await fetch(`${EXCEPTIONS_API}/${practId}?from=${dateStr}&to=${dateStr}`, { cache: 'no-store' });
    const excData = excRes.ok ? await excRes.json() : { exceptions: [] };
    const exceptions = Array.isArray(excData.exceptions) ? excData.exceptions : [];
    // CORRECTIF 3 — Chercher toute exception (modify ET block) pour ce jour
    const dayExc = exceptions.find(e => e.date?.slice(0, 10) === dateStr);

    const schedRes = await fetch(`${SCHEDULE_API}`, { cache: 'no-store' });
    const schedData = schedRes.ok ? await schedRes.json() : { schedule: null };
    const dayOfWeek = date.getDay();
    const typEntry = schedData.schedule?.weeklySchedule?.find(d => d.dayOfWeek === dayOfWeek);

    let isOn, slots;
    if (dayExc?.type === 'block' && dayExc.isFullDay) {
      isOn = false;
      slots = [{ startTime: '09:00', endTime: '18:00' }];
    } else if (dayExc?.type === 'modify') {
      isOn = true;
      slots = dayExc.slots?.length ? dayExc.slots : [{ startTime: '09:00', endTime: '18:00' }];
    } else if (typEntry) {
      isOn = typEntry.isWorking;
      slots = typEntry.slots?.length ? typEntry.slots : [{ startTime: '09:00', endTime: '18:00' }];
    } else {
      isOn = false;
      slots = [{ startTime: '09:00', endTime: '18:00' }];
    }

    initModalSlotsState('edit', slots);

    if (saveBtn && dayExc?._id) saveBtn.dataset.editExcId = dayExc._id;

    if (body) {
      let slotsHtml = '';
      slots.forEach((s, i) => { slotsHtml += buildSlotRow(i, s.startTime, s.endTime, slots.length === 1); });

      const modifiedBar = isDayReallyModified(dayExc, typEntry)
        ? `<div class="plm-modified-bar">
            <span class="plm-modified-badge"><i class="bi bi-pencil-fill"></i> Modifié</span>
            <button type="button" class="plm-btn-reset" data-plm-reset-day="${escHtml(String(dayExc._id))}">
              <i class="bi bi-arrow-counterclockwise"></i> Réinitialiser
            </button>
          </div>`
        : '';

      body.innerHTML = `
        ${modifiedBar}
        <div class="plm-form-group">
          <label class="plm-toggle-slide" data-day-toggle-label="edit">
            <input type="checkbox" class="plm-toggle-slide__input" data-day-toggle="edit" ${isOn ? 'checked' : ''}>
            <span class="plm-toggle-slide__track"><span class="plm-toggle-slide__thumb"></span></span>
            <span class="plm-toggle-slide__label">${isOn ? 'Actif' : 'Repos'}</span>
          </label>
        </div>
        <div class="plm-day-slots${isOn ? '' : ' plm-day-slots--collapsed'}" data-day-slots="edit">
          ${slotsHtml}
        </div>
        <button type="button" class="plm-slot-add${isOn ? '' : ' plm-slot-add--hidden'}" data-add-slot="edit">
          <i class="bi bi-plus"></i> Ajouter une plage
        </button>
      `;

      // Réinitialiser — supprime l'exception et réouvre le modal avec les valeurs fraîches du planning type
      const resetBtn = body.querySelector('[data-plm-reset-day]');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          try {
            const res = await fetch(`${EXCEPTIONS_API}/${resetBtn.dataset.plmResetDay}`, { method: 'DELETE' });
            const d = await res.json();
            if (!d.ok) { showToast({ type: 'error', message: d.error || 'Erreur.' }); return; }
            closeModal('day-edit');
            await openDayModal(date); // réouvrir avec les valeurs fraîches du planning type
            state.calendar?.refetchEvents();
            loadBusinessHours(state.myPractitionerId);
          } catch (_) {
            showToast({ type: 'error', message: 'Erreur réseau.' });
          }
        });
      }

      // Créer un conteneur parent data-day="edit" pour revalidateDay
      const slotsContainer = body.querySelector('[data-day-slots="edit"]');
      if (slotsContainer) {
        const wrapper = slotsContainer.parentElement || body;
        if (!wrapper.dataset.day) wrapper.dataset.day = 'edit';
      }

      attachDayToggleListeners(body);
      // Initialise les pickers existants — body lui-même a data-day="edit"
      // donc querySelectorAll('[data-day]') dans attachDayToggleListeners ne les trouve pas
      initAllTimePickers(body);
    }
  } catch (e) {
    if (body) body.innerHTML = '<p class="plm-error">Erreur lors du chargement.</p>';
  }
}

async function saveDayEdit() {
  const saveBtn = qs('[data-plm-save-day-edit]');
  const date = saveBtn?.dataset.editDate;
  if (!date) return;

  const practId = state.myPractitionerId;
  console.log('[DEBUG saveDayEdit] practId:', practId, 'date:', date, 'myPractitionerId:', state.myPractitionerId);
  if (!practId) return;

  const body = qs('[data-plm-day-edit-body]');
  const toggle = body?.querySelector('[data-day-toggle="edit"]');
  const isOn = toggle?.checked ?? false;

  if (!isOn) {
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Enregistrement...';
      const blockPayload = { practitionerId: practId, date, type: 'block', isFullDay: true };
      console.log('[DEBUG saveDayEdit] block payload:', JSON.stringify(blockPayload));
      const res = await fetch(EXCEPTIONS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blockPayload)
      });
      const data = await res.json();
      if (data.ok) {
        showToast({ type: 'success', message: 'Journée bloquée.' });
        closeModal('day-edit');
        state.calendar?.refetchEvents();
      } else {
        showToast({ type: 'error', message: data.error || 'Erreur.' });
      }
    } catch(e) {
      showToast({ type: 'error', message: 'Erreur réseau.' });
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Enregistrer';
    }
    return;
  }

  const slots = [];
  body?.querySelectorAll('[data-slot-index]').forEach(row => {
    const startTp = row.querySelector('[data-tp-start] [data-plm-tp]');
    const endTp = row.querySelector('[data-tp-end] [data-plm-tp]');
    if (startTp && endTp) slots.push({ startTime: getTimePickerValue(startTp), endTime: getTimePickerValue(endTp) });
  });

  if (!slots.length) {
    showToast({ type: 'error', message: 'Ajoutez au moins une plage horaire.' });
    return;
  }

  const payload = { practitionerId: practId, date, type: 'modify', isFullDay: false, slots };
  const excId = saveBtn?.dataset.editExcId;
  const method = excId ? 'PUT' : 'POST';
  const url = excId ? `${EXCEPTIONS_API}/${excId}` : EXCEPTIONS_API;
  console.log('[DEBUG saveDayEdit] modify payload:', JSON.stringify(payload), 'method:', method, 'url:', url);

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement...';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      showToast({ type: 'success', message: 'Journée mise à jour.' });
      closeModal('day-edit');
      state.calendar?.refetchEvents();
      loadBusinessHours(practId);
    } else {
      showToast({ type: 'error', message: data.error || 'Erreur.' });
    }
  } catch(e) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Enregistrer';
    if (saveBtn.dataset.editExcId) delete saveBtn.dataset.editExcId;
  }
}

// ─── Modal "Modifier cette semaine" ──────────────────────────────────────────

async function openWeekModal(weekStart) {
  const title = qs('[data-plm-week-edit-title]');
  const body = qs('[data-plm-week-edit-body]');

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const fromLabel = days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const toLabel = days[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (title) title.textContent = `Semaine du ${fromLabel} au ${toLabel}`;

  if (body) body.innerHTML = '<p class="plm-loading">Chargement...</p>';
  openModal('week-edit');

  const practId = state.myPractitionerId;
  if (!practId) {
    if (body) body.innerHTML = '<p class="plm-error">Aucune praticienne sélectionnée.</p>';
    return;
  }

  const fromStr = localDateStr(days[0]);
  const toStr = localDateStr(days[6]);

  const saveBtn = qs('[data-plm-save-week-edit]');
  if (saveBtn) {
    saveBtn.dataset.weekFrom = fromStr;
    saveBtn.dataset.weekTo = toStr;
  }

  try {
    const [excData, schedData] = await Promise.all([
      fetch(`${EXCEPTIONS_API}/${practId}?from=${fromStr}&to=${toStr}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { exceptions: [] }),
      fetch(SCHEDULE_API, { cache: 'no-store' }).then(r => r.ok ? r.json() : { schedule: null })
    ]);

    const exceptions = Array.isArray(excData.exceptions) ? excData.exceptions : [];
    // CORRECTIF 3 — Compter toutes les exceptions (modify + block) pour le message d'avertissement
    const weekSchedule = schedData.schedule?.weeklySchedule || [];

    const excsWithOverride = exceptions.filter(e => {
      const excDate = new Date((e.date?.slice(0, 10) || '') + 'T12:00:00');
      const typEntry = weekSchedule.find(d => d.dayOfWeek === excDate.getDay());
      return isDayReallyModified(e, typEntry);
    });
    const warningHtml = excsWithOverride.length > 0
      ? `<div class="plm-week-warning"><i class="bi bi-exclamation-triangle"></i> ${excsWithOverride.length} jour${excsWithOverride.length > 1 ? 's ont' : ' a'} déjà des modifications — elles seront remplacées.</div>`
      : '';

    let daysHtml = '';
    days.forEach((d, i) => {
      const dateStr = localDateStr(d);
      const dayLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const labelCap = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);

      // CORRECTIF 3 — Chercher toute exception (modify ET block) pour ce jour
      const dayExc = exceptions.find(e => e.date?.slice(0, 10) === dateStr);
      const typEntry = weekSchedule.find(e => e.dayOfWeek === d.getDay());

      let isOn, slots;
      if (dayExc?.type === 'block' && dayExc.isFullDay) {
        isOn = false;
        slots = [{ startTime: '09:00', endTime: '18:00' }];
      } else if (dayExc?.type === 'modify') {
        isOn = true;
        slots = dayExc.slots?.length ? dayExc.slots : [{ startTime: '09:00', endTime: '18:00' }];
      } else if (typEntry) {
        isOn = typEntry.isWorking;
        slots = typEntry.slots?.length ? typEntry.slots : [{ startTime: '09:00', endTime: '18:00' }];
      } else {
        isOn = false;
        slots = [{ startTime: '09:00', endTime: '18:00' }];
      }

      initModalSlotsState(`w${i}`, slots);

      let slotsHtml = '';
      slots.forEach((s, idx) => { slotsHtml += buildSlotRow(idx, s.startTime, s.endTime, slots.length === 1); });

      const weekDayModifiedBar = isDayReallyModified(dayExc, typEntry)
        ? `<div class="plm-modified-bar">
            <span class="plm-modified-badge"><i class="bi bi-pencil-fill"></i> Modifié</span>
            <button type="button" class="plm-btn-reset" data-plm-reset-week-day="${escHtml(String(dayExc._id))}">
              <i class="bi bi-arrow-counterclockwise"></i> Réinitialiser
            </button>
          </div>`
        : '';

      daysHtml += `
        <div class="plm-day-row" data-day="w${i}" data-week-date="${escHtml(dateStr)}">
          ${weekDayModifiedBar}
          <div class="plm-day-header">
            <span class="plm-day-name">${escHtml(labelCap)}</span>
            <label class="plm-toggle-slide" data-day-toggle-label="w${i}">
              <input type="checkbox" class="plm-toggle-slide__input" data-day-toggle="w${i}" ${isOn ? 'checked' : ''}>
              <span class="plm-toggle-slide__track"><span class="plm-toggle-slide__thumb"></span></span>
              <span class="plm-toggle-slide__label">${isOn ? 'Actif' : 'Repos'}</span>
            </label>
          </div>
          <div class="plm-day-slots${isOn ? '' : ' plm-day-slots--collapsed'}" data-day-slots="w${i}">
            ${slotsHtml}
          </div>
          <button type="button" class="plm-slot-add${isOn ? '' : ' plm-slot-add--hidden'}" data-add-slot="w${i}">
            <i class="bi bi-plus"></i> Ajouter une plage
          </button>
        </div>
      `;
    });

    if (body) {
      body.innerHTML = `${warningHtml}<div class="plm-day-list">${daysHtml}</div>`;
      attachDayToggleListeners(body);
      initAllTimePickers(body);

      // Réinitialiser par jour — supprime l'exception, garde la modal ouverte, revert au planning type
      body.querySelectorAll('[data-plm-reset-week-day]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const excId = btn.dataset.plmResetWeekDay;
          const dayRow = btn.closest('[data-day][data-week-date]');
          const dateStr2 = dayRow?.dataset.weekDate;
          if (!excId || !dayRow || !dateStr2) return;
          try {
            const res = await fetch(`${EXCEPTIONS_API}/${excId}`, { method: 'DELETE' });
            const d = await res.json();
            if (!d.ok) { showToast({ type: 'error', message: d.error || 'Erreur.' }); return; }
            // Retirer le badge
            const bar = dayRow.querySelector('.plm-modified-bar');
            if (bar) bar.remove();
            // Revenir au planning type — fetch frais pour avoir les valeurs actuelles
            const schedRes2 = await fetch(SCHEDULE_API, { cache: 'no-store' });
            const schedData2 = schedRes2.ok ? await schedRes2.json() : { schedule: null };
            const freshSchedule = schedData2.schedule?.weeklySchedule || [];
            const dayOfWeek = new Date(dateStr2 + 'T12:00:00').getDay();
            const typEntry2 = freshSchedule.find(e => e.dayOfWeek === dayOfWeek);
            const newIsOn = typEntry2?.isWorking ?? false;
            const newSlots = typEntry2?.slots?.length ? typEntry2.slots : [{ startTime: '09:00', endTime: '18:00' }];
            // Mettre à jour le toggle
            const dayKey = dayRow.dataset.day;
            const toggle = dayRow.querySelector(`[data-day-toggle="${dayKey}"]`);
            if (toggle) {
              toggle.checked = newIsOn;
              toggle.dispatchEvent(new Event('change'));
            }
            // Reconstruire les slots
            const slotsContainer = dayRow.querySelector('[data-day-slots]');
            if (slotsContainer) {
              slotsContainer.innerHTML = newSlots.map((s, idx) =>
                buildSlotRow(idx, s.startTime, s.endTime, newSlots.length === 1)
              ).join('');
              initModalSlotsState(dayKey, newSlots);
              initAllTimePickers(slotsContainer);
              dayRow.querySelectorAll('[data-remove-slot]').forEach(rb => {
                rb.addEventListener('click', () => removeSlotRow(rb, slotsContainer));
              });
            }
          } catch (_) {
            showToast({ type: 'error', message: 'Erreur réseau.' });
          }
        });
      });
    }
  } catch(e) {
    if (body) body.innerHTML = '<p class="plm-error">Erreur lors du chargement.</p>';
  }
}

async function saveWeekEdit() {
  const saveBtn = qs('[data-plm-save-week-edit]');
  const practId = state.myPractitionerId;
  if (!practId) return;

  const body = qs('[data-plm-week-edit-body]');

  const exceptions = [];
  body?.querySelectorAll('[data-day][data-week-date]').forEach(dayRow => {
    const date = dayRow.dataset.weekDate;
    const dayKey = dayRow.dataset.day;
    const toggle = dayRow.querySelector(`[data-day-toggle="${dayKey}"]`);
    const isOn = toggle?.checked ?? false;

    if (!isOn) {
      exceptions.push({ date, type: 'block', isFullDay: true, practitionerId: practId });
      return;
    }

    const slots = [];
    dayRow.querySelectorAll('[data-slot-index]').forEach(row => {
      const startTp = row.querySelector('[data-tp-start] [data-plm-tp]');
      const endTp = row.querySelector('[data-tp-end] [data-plm-tp]');
      if (startTp && endTp) slots.push({ startTime: getTimePickerValue(startTp), endTime: getTimePickerValue(endTp) });
    });

    if (slots.length > 0) {
      exceptions.push({ date, type: 'modify', isFullDay: false, slots, practitionerId: practId });
    }
  });

  if (!exceptions.length) {
    showToast({ type: 'error', message: 'Aucune donnée à enregistrer.' });
    return;
  }

  console.log('[DEBUG saveWeekEdit] practId:', practId, 'exceptions:', JSON.stringify(exceptions));

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement...';

    const res = await fetch(`${EXCEPTIONS_API}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exceptions })
    });
    const data = await res.json();

    if (data.ok) {
      showToast({ type: 'success', message: 'Semaine mise à jour.' });
      closeModal('week-edit');
      state.calendar?.refetchEvents();
      loadBusinessHours(practId);
    } else {
      showToast({ type: 'error', message: data.error || 'Erreur.' });
    }
  } catch(e) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Enregistrer la semaine';
  }
}

// ─── Formation detail modal ───────────────────────────────────────────────────

function buildParticipantSkeleton() {
  return Array.from({ length: 3 }, () => `
    <div class="plm-fdet-skeleton">
      <div class="plm-fdet-skeleton__line plm-fdet-skeleton__line--wide"></div>
      <div class="plm-fdet-skeleton__line plm-fdet-skeleton__line--narrow"></div>
    </div>
  `).join('');
}

function buildParticipantCard(p, sessionStart, isSessionPast = false) {
  const isCancelled = p.status === 'canceled';
  const joinedAt = p.joinedAt ? new Date(p.joinedAt) : null;
  const now = new Date();
  const sessionStart_ = sessionStart ? new Date(sessionStart) : null;
  const isRefundable = !isCancelled && sessionStart_ && sessionStart_ > now;

  const joinedLabel = joinedAt
    ? joinedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const optionsHtml = (p.selectedOptions || []).length > 0
    ? `<div class="plm-fdet-options">
        <span class="plm-fdet-options__label">Options :</span>
        ${p.selectedOptions.map(o => `<div class="plm-fdet-option">· ${escHtml(o.name)} — ${Number(o.price).toFixed(2)} €</div>`).join('')}
      </div>`
    : '';

  return `
    <div class="plm-fdet-participant${isCancelled ? ' plm-fdet-participant--cancelled' : ''}">
      <div class="plm-fdet-participant__header">
        <div>
          <span class="plm-fdet-participant__name">${escHtml(p.firstName)} ${escHtml((p.lastName || '').toUpperCase())}</span>
          <a href="mailto:${escHtml(p.email)}" class="plm-fdet-participant__email">${escHtml(p.email)}</a>
        </div>
        ${isCancelled ? '<span class="plm-fdet-badge plm-fdet-badge--cancelled">Annulé</span>' : ''}
      </div>
      ${joinedLabel ? `<div class="plm-fdet-participant__joined">Réservé le ${escHtml(joinedLabel)}</div>` : ''}
      ${optionsHtml}
      ${!isCancelled && !isSessionPast ? `<div class="plm-fdet-participant__refund">
        ${isRefundable
          ? '<i class="bi bi-check-circle-fill" style="color:var(--color-success,#1f7a3a)"></i> Remboursable'
          : '<i class="bi bi-x-circle-fill" style="color:var(--color-danger,#dc2626)"></i> Non remboursable'}
      </div>` : ''}
    </div>
  `;
}

async function openFormationDetailModal(sessionId, formationId, formationName, sessionStatus, eventStartStr) {
  if (!sessionId) return;

  const titleEl = qs('[data-plm-fdet-title]');
  const metaEl = qs('[data-plm-fdet-meta]');
  const body = qs('[data-plm-fdet-body]');
  const footer = qs('[data-plm-fdet-footer]');

  if (titleEl) titleEl.textContent = formationName || 'Formation';
  if (metaEl) {
    metaEl.textContent = eventStartStr
      ? new Date(eventStartStr).toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '';
  }
  if (body) body.innerHTML = buildParticipantSkeleton();

  // Visibilité du bouton annuler calculée depuis les params de l'événement
  // (disponibles immédiatement, sans attendre la réponse API)
  // Note: style.display utilisé car display:flex dans CSS surpasse l'attribut hidden
  // getTime() utilisé pour éviter toute ambiguïté de comparaison Date
  const sessionStartMs = eventStartStr instanceof Date
    ? eventStartStr.getTime()
    : (eventStartStr ? new Date(eventStartStr).getTime() : 0);
  const isPast = sessionStartMs <= 0 || sessionStartMs < Date.now();
  const isCancelledStatus = sessionStatus === 'canceled_by_institute' || sessionStatus === 'canceled';
  if (footer) footer.style.display = (isPast || isCancelledStatus) ? 'none' : '';

  const sessionStartFromEvent = eventStartStr ? new Date(eventStartStr) : null;
  state.currentFormationDetail = {
    sessionId,
    formationId,
    reservedCount: 0,
    sessionStart: sessionStartFromEvent,
    sessionStatus
  };

  openModal('formation-detail');

  try {
    // CORRECTIF 1 — URL correcte de l'endpoint participants
    const res = await fetch(`/api/gestion/sessions/${sessionId}/attendees`, { cache: 'no-store' });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      if (body) body.innerHTML = `<p class="plm-error">${escHtml(data.error || 'Erreur de chargement.')}</p>`;
      return;
    }

    const { participants = [], isSessionPast = false } = data;
    state.currentFormationDetail.reservedCount = participants.length;

    if (!participants.length) {
      if (body) body.innerHTML = '<p class="plm-empty">Aucun participant inscrit.</p>';
      return;
    }

    if (body) {
      body.innerHTML = participants.map(p => buildParticipantCard(p, sessionStartFromEvent, isSessionPast)).join('');
    }
  } catch (e) {
    if (body) body.innerHTML = '<p class="plm-error">Erreur réseau.</p>';
  }
}

async function handleCancelSession() {
  const detail = state.currentFormationDetail;
  if (!detail?.sessionId) return;

  const count = detail.reservedCount || 0;
  const msgEl = qs('[data-plm-cancel-confirm-msg]');
  if (msgEl) {
    const clientsMsg = count > 0
      ? `<strong>${count} client${count > 1 ? 's' : ''} inscrit${count > 1 ? 's' : ''}</strong> sera${count > 1 ? 'ont' : ''} notifié${count > 1 ? 's' : ''} et recevra${count > 1 ? 'ont' : ''} un email avec un lien pour choisir entre un remboursement ou un report.`
      : 'Aucun client inscrit — la session sera supprimée.';
    msgEl.innerHTML = `Cette action est irréversible.<br>${clientsMsg}`;
  }

  closeModal('formation-detail');
  openModal('cancel-confirm');
}

async function confirmCancelSession() {
  const detail = state.currentFormationDetail;
  if (!detail?.sessionId || !detail?.formationId) return;

  const confirmBtn = qs('[data-plm-confirm-cancel-session]');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Annulation…';
  }

  try {
    const res = await fetch(`/api/gestion/formations/${detail.formationId}/sessions/${detail.sessionId}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.ok) {
      const msg = data.canceledByInstitute
        ? `Session annulée. ${data.notifiedClientsCount || 0} client(s) notifié(s).`
        : 'Session supprimée.';
      showToast({ type: 'success', message: msg });
      closeModal('cancel-confirm');
      closeModal('formation-detail');
      if (state.calendar) state.calendar.refetchEvents();
    } else {
      showToast({ type: 'error', message: data.error || "Erreur lors de l'annulation." });
      closeModal('cancel-confirm');
      openModal('formation-detail');
    }
  } catch (e) {
    showToast({ type: 'error', message: 'Erreur réseau.' });
    closeModal('cancel-confirm');
    openModal('formation-detail');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirmer l'annulation";
    }
  }
}

// ─── Booking detail modal ─────────────────────────────────────────────────────

/**
 * État courant du modal réservation (pour les actions no-show/annulation).
 */
const bookingModalState = {
  bookingId: null,
  status: null
};

function buildBookingStatusBadge(status) {
  const map = {
    confirmed: { label: 'Confirmée', cls: 'pbm-badge--confirmed' },
    completed: { label: 'Complétée', cls: 'pbm-badge--completed' },
    no_show: { label: 'No-show', cls: 'pbm-badge--noshow' },
    cancelled: { label: 'Annulée', cls: 'pbm-badge--cancelled' }
  };
  const cfg = map[status] || { label: status, cls: '' };
  return `<span class="pbm-badge ${cfg.cls}">${escHtml(cfg.label)}</span>`;
}

function buildBookingModalBody(booking, refundEligibility) {
  const client = booking.clientId || {};
  const service = booking.serviceId || {};
  const options = Array.isArray(booking.selectedOptions) ? booking.selectedOptions : [];
  const snapshot = booking.consumerWaiverSnapshot || {};

  const createdAt = booking.createdAt
    ? new Date(booking.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  // Section client
  const clientHtml = `
    <div class="pbm-section">
      <div class="pbm-section__title"><i class="bi bi-person"></i> Client</div>
      <div class="pbm-row"><span class="pbm-label">Nom</span><span class="pbm-value">${escHtml(`${client.firstName || ''} ${client.lastName || ''}`.trim() || '—')}</span></div>
      <div class="pbm-row"><span class="pbm-label">Email</span><a href="mailto:${escHtml(client.email || '')}" class="pbm-link">${escHtml(client.email || '—')}</a></div>
      <div class="pbm-row"><span class="pbm-label">Réservé le</span><span class="pbm-value">${escHtml(createdAt)}</span></div>
    </div>`;

  // Section options
  let optionsHtml = '';
  if (options.length > 0) {
    optionsHtml = `
      <div class="pbm-section">
        <div class="pbm-section__title"><i class="bi bi-list-ul"></i> Options</div>
        ${options.map(o => `<div class="pbm-row"><span class="pbm-label">${escHtml(o.name)}</span><span class="pbm-value">${Number(o.price).toFixed(2)} €</span></div>`).join('')}
      </div>`;
  }

  // Section paiement
  let paymentHtml = '';
  if (booking.paymentType === 'free' || booking.totalPrice === 0) {
    paymentHtml = `<div class="pbm-row"><span class="pbm-label">Paiement</span><span class="pbm-value">Gratuit</span></div>`;
  } else if (booking.paymentType === 'deposit') {
    const reste = Math.max(0, Number(booking.totalPrice) - Number(booking.depositAmount));
    paymentHtml = `
      <div class="pbm-row"><span class="pbm-label">Acompte payé</span><span class="pbm-value">${Number(booking.depositAmount).toFixed(2)} €</span></div>
      <div class="pbm-row"><span class="pbm-label">Reste dû sur place</span><span class="pbm-value">${reste.toFixed(2)} €</span></div>`;
  } else {
    paymentHtml = `<div class="pbm-row"><span class="pbm-label">Paiement complet</span><span class="pbm-value">${Number(booking.totalPrice).toFixed(2)} €</span></div>`;
  }
  const paymentSection = `
    <div class="pbm-section">
      <div class="pbm-section__title"><i class="bi bi-credit-card"></i> Paiement</div>
      ${paymentHtml}
    </div>`;

  // Section éligibilité remboursement — eligibleRefund est la source de vérité
  let refundHtml = '';
  const elig = refundEligibility || {};
  if (elig.eligibleRefund) {
    const refundLabel = elig.reason === 'retractation'
      ? 'Remboursable — droit de rétractation légal'
      : 'Remboursable — dans le délai d\'annulation institut';
    refundHtml = `<div class="pbm-refund pbm-refund--yes"><i class="bi bi-check-circle-fill"></i> ${refundLabel}</div>`;
  } else if (elig.waiverSigned) {
    refundHtml = `<div class="pbm-refund pbm-refund--no"><i class="bi bi-x-circle-fill"></i> Non remboursable — renonciation signée</div>`;
  } else {
    refundHtml = `<div class="pbm-refund pbm-refund--no"><i class="bi bi-x-circle-fill"></i> Non remboursable — délai dépassé</div>`;
  }

  return `${clientHtml}${optionsHtml}${paymentSection}
    <div class="pbm-section">
      <div class="pbm-section__title"><i class="bi bi-arrow-counterclockwise"></i> Remboursement</div>
      ${refundHtml}
    </div>`;
}

function buildBookingModalFooter(booking) {
  const status = booking.status;
  const now = new Date();
  const startAt = booking.startAt ? new Date(booking.startAt) : null;
  const isFuture = startAt && startAt > now;
  const isPast = startAt && startAt <= now;

  if (status === 'no_show' || status === 'completed' || status === 'cancelled') {
    return '';
  }
  if (status === 'confirmed' && isFuture) {
    return `<button type="button" class="plm-btn-danger" data-pbm-cancel><i class="bi bi-x-circle"></i> Annuler la réservation</button>`;
  }
  if (status === 'confirmed' && isPast) {
    return `
      <button type="button" class="plm-btn-danger" data-pbm-noshow><i class="bi bi-person-x"></i> Marquer No-show</button>
      <button type="button" class="plm-btn-save" data-pbm-complete><i class="bi bi-check-circle"></i> Marquer Complétée</button>`;
  }
  return '';
}

async function openBookingDetailModal(bookingId) {
  bookingModalState.bookingId = bookingId;
  bookingModalState.status = null;

  const titleEl = qs('[data-pbm-title]');
  const metaEl = qs('[data-pbm-meta]');
  const badgeEl = qs('[data-pbm-badge]');
  const body = qs('[data-pbm-body]');
  const footer = qs('[data-pbm-footer]');

  if (titleEl) titleEl.textContent = 'Réservation';
  if (metaEl) metaEl.textContent = '';
  if (badgeEl) badgeEl.innerHTML = '';
  if (body) body.innerHTML = '<p class="plm-loading">Chargement...</p>';
  if (footer) footer.style.display = 'none';

  openModal('booking-detail');

  try {
    const res = await fetch(`${BOOKINGS_API}/${bookingId}/detail`, { cache: 'no-store' });
    const data = await res.json();

    if (!data.ok || !data.booking) {
      if (body) body.innerHTML = `<p class="plm-error">${escHtml(data.error || 'Erreur de chargement.')}</p>`;
      return;
    }

    const booking = data.booking;
    bookingModalState.status = booking.status;

    // Header
    const service = booking.serviceId || {};
    if (titleEl) titleEl.textContent = service.name || 'Réservation';
    if (metaEl) {
      const startStr = booking.startAt
        ? new Date(booking.startAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      metaEl.textContent = startStr;
    }
    if (badgeEl) badgeEl.innerHTML = buildBookingStatusBadge(booking.status);

    // Body
    if (body) body.innerHTML = buildBookingModalBody(booking, data.refundEligibility);

    // Footer
    const footerHtml = buildBookingModalFooter(booking);
    if (footer) {
      footer.innerHTML = footerHtml;
      footer.style.display = footerHtml ? '' : 'none';
      bindBookingFooterActions(footer, booking, data.refundEligibility);
    }
  } catch (e) {
    if (body) body.innerHTML = '<p class="plm-error">Erreur réseau.</p>';
  }
}

function bindBookingFooterActions(footer, booking, refundEligibility) {
  // No-show
  const noshowBtn = footer.querySelector('[data-pbm-noshow]');
  if (noshowBtn) {
    noshowBtn.addEventListener('click', () => {
      closeModal('booking-detail');
      openModal('noshow-confirm');
    });
  }

  // Marquer complétée (direct, sans confirmation)
  const completeBtn = footer.querySelector('[data-pbm-complete]');
  if (completeBtn) {
    completeBtn.addEventListener('click', async () => {
      completeBtn.disabled = true;
      completeBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Enregistrement...';
      try {
        const res = await fetch(`${BOOKINGS_API}/${bookingModalState.bookingId}/complete`, { method: 'POST' });
        const d = await res.json();
        if (d.ok) {
          showToast({ type: 'success', message: 'Réservation marquée comme complétée.' });
          closeModal('booking-detail');
          state.calendar?.refetchEvents();
        } else {
          showToast({ type: 'error', message: d.error || 'Erreur.' });
          completeBtn.disabled = false;
          completeBtn.innerHTML = '<i class="bi bi-check-circle"></i> Marquer Complétée';
        }
      } catch (_) {
        showToast({ type: 'error', message: 'Erreur réseau.' });
        completeBtn.disabled = false;
        completeBtn.innerHTML = '<i class="bi bi-check-circle"></i> Marquer Complétée';
      }
    });
  }

  // Annuler la réservation
  const cancelBtn = footer.querySelector('[data-pbm-cancel]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const msgEl = qs('[data-pbm-cancel-msg]');
      if (msgEl) {
        const isRefundable = refundEligibility?.eligibleRefund;
        msgEl.innerHTML = `<p style="font-size:0.9rem;line-height:1.6">Le client sera notifié par email.${isRefundable ? ' <strong>Un remboursement pourra être traité.</strong>' : ''}</p>`;
      }
      closeModal('booking-detail');
      openModal('booking-cancel-confirm');
    });
  }
}

// ─── Toolbar event binding ─────────────────────────────────────────────────────

function bindToolbar() {
  const root = getRoot();

  // View select
  const viewSel = qs('[data-plm-view-select]');
  if (viewSel) {
    viewSel.addEventListener('change', () => {
      if (state.calendar) state.calendar.changeView(viewSel.value);
    });
  }

  // Nav buttons
  const prevBtn = qs('[data-plm-prev]');
  const nextBtn = qs('[data-plm-next]');
  const todayBtn = qs('[data-plm-today]');
  if (prevBtn) prevBtn.addEventListener('click', () => state.calendar?.prev());
  if (nextBtn) nextBtn.addEventListener('click', () => state.calendar?.next());
  if (todayBtn) todayBtn.addEventListener('click', () => state.calendar?.today());

  // Config button
  const configBtn = qs('[data-plm-config]');
  if (configBtn) {
    configBtn.addEventListener('click', () => openScheduleModal());
  }

  // Modal close buttons
  root.querySelectorAll('[data-plm-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.plmModalClose));
  });

  // Close on overlay click
  root.querySelectorAll('[data-plm-modal]').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.dataset.plmModal);
    });
  });

  // Save schedule
  const saveScheduleBtn = qs('[data-plm-save-schedule]');
  if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener('click', saveScheduleHandler);
  }

  // Save exception
  const saveExcBtn = qs('[data-plm-save-exception]');
  if (saveExcBtn) {
    saveExcBtn.addEventListener('click', saveExceptionHandler);
  }

  // Bouton Modifier la vue courante
  const editViewBtn = qs('[data-plm-edit-view]');
  if (editViewBtn) editViewBtn.addEventListener('click', handleEditViewClick);

  // Save day edit
  const saveDayEditBtn = qs('[data-plm-save-day-edit]');
  if (saveDayEditBtn) saveDayEditBtn.addEventListener('click', saveDayEdit);

  // Save week edit
  const saveWeekEditBtn = qs('[data-plm-save-week-edit]');
  if (saveWeekEditBtn) saveWeekEditBtn.addEventListener('click', saveWeekEdit);

  // Exception fullday toggle (checkbox)
  const fulldayToggle = qs('[data-plm-exc-fullday]');
  const timeRange = qs('[data-plm-time-range]');
  const toggleLabel = fulldayToggle?.closest('.plm-toggle-slide')?.querySelector('.plm-toggle-slide__label');

  if (fulldayToggle) {
    fulldayToggle.addEventListener('change', () => {
      const isFullDay = fulldayToggle.checked;
      if (toggleLabel) toggleLabel.textContent = isFullDay ? 'Journée entière' : 'Plage horaire';
      if (timeRange) timeRange.classList.toggle('plm-day-slots--collapsed', isFullDay);
    });
  }

  // Attach time picker events in exception modal time range
  if (timeRange) {
    timeRange.querySelectorAll('[data-plm-tp]').forEach(tp => attachTimePickerEvents(tp));
  }

  // Cancel session button (formation-detail modal footer)
  const cancelSessionBtn = qs('[data-plm-cancel-session]');
  if (cancelSessionBtn) cancelSessionBtn.addEventListener('click', handleCancelSession);

  // Confirm cancel session button
  const confirmCancelBtn = qs('[data-plm-confirm-cancel-session]');
  if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', confirmCancelSession);

  // Context menu actions
  bindCtxMenuActions();

  // Booking modal: confirm no-show
  const confirmNoshowBtn = qs('[data-pbm-confirm-noshow]');
  if (confirmNoshowBtn) {
    confirmNoshowBtn.addEventListener('click', async () => {
      confirmNoshowBtn.disabled = true;
      confirmNoshowBtn.textContent = 'Enregistrement...';
      try {
        const res = await fetch(`${BOOKINGS_API}/${bookingModalState.bookingId}/no-show`, { method: 'POST' });
        const d = await res.json();
        if (d.ok) {
          showToast({ type: 'success', message: 'No-show enregistré.' });
          closeModal('noshow-confirm');
          state.calendar?.refetchEvents();
        } else {
          showToast({ type: 'error', message: d.error || 'Erreur.' });
          closeModal('noshow-confirm');
        }
      } catch (_) {
        showToast({ type: 'error', message: 'Erreur réseau.' });
        closeModal('noshow-confirm');
      } finally {
        confirmNoshowBtn.disabled = false;
        confirmNoshowBtn.textContent = 'Confirmer';
      }
    });
  }

  // Booking modal: confirm cancel
  const confirmCancelBookingBtn = qs('[data-pbm-confirm-cancel]');
  if (confirmCancelBookingBtn) {
    confirmCancelBookingBtn.addEventListener('click', async () => {
      confirmCancelBookingBtn.disabled = true;
      confirmCancelBookingBtn.textContent = 'Annulation...';
      try {
        const res = await fetch(`${BOOKINGS_API}/${bookingModalState.bookingId}/cancel`, { method: 'POST' });
        const d = await res.json();
        if (d.ok) {
          showToast({ type: 'success', message: 'Réservation annulée.' });
          closeModal('booking-cancel-confirm');
          state.calendar?.refetchEvents();
        } else {
          showToast({ type: 'error', message: d.error || 'Erreur.' });
          closeModal('booking-cancel-confirm');
        }
      } catch (_) {
        showToast({ type: 'error', message: 'Erreur réseau.' });
        closeModal('booking-cancel-confirm');
      } finally {
        confirmCancelBookingBtn.disabled = false;
        confirmCancelBookingBtn.textContent = "Confirmer l'annulation";
      }
    });
  }

  // Simulate reminders button — ouvre la modal de sélection de date
  const simulateBtn = qs('[data-plm-simulate-reminders]');
  if (simulateBtn) {
    simulateBtn.addEventListener('click', () => {
      const dateInput = qs('#plm-remind-date-input');
      if (dateInput) {
        const today = new Date().toISOString().slice(0, 10);
        dateInput.value = today;
      }
      openModal('remind-date');
    });
  }

  // Confirm send reminders
  const confirmRemindBtn = qs('#plm-remind-date-confirm');
  if (confirmRemindBtn) {
    confirmRemindBtn.addEventListener('click', async () => {
      const dateInput = qs('#plm-remind-date-input');
      const dateVal = dateInput?.value || new Date().toISOString().slice(0, 10);
      confirmRemindBtn.disabled = true;
      confirmRemindBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Envoi...';
      try {
        const res = await fetch(`${BOOKINGS_API}/simulate-reminders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateVal })
        });
        const data = await res.json();
        if (data.ok) {
          closeModal('remind-date');
          if (data.total === 0) {
            showToast({ type: 'info', message: 'Aucune réservation confirmée ce jour-là.' });
          } else {
            showToast({ type: 'success', message: `${data.sent} rappel(s) envoyé(s) pour le ${data.date}.` });
          }
          if (data.failed > 0) {
            showToast({ type: 'warning', message: `${data.failed} rappel(s) ont échoué.` });
          }
        } else {
          showToast({ type: 'error', message: data.error || 'Erreur.' });
        }
      } catch (_) {
        showToast({ type: 'error', message: 'Erreur réseau.' });
      } finally {
        confirmRemindBtn.disabled = false;
        confirmRemindBtn.innerHTML = '<i class="bi bi-send"></i> Envoyer';
      }
    });
  }
}

// ─── Business hours (hatch off-hours) ────────────────────────────────────────

function scheduleToBusinessHours(weeklySchedule) {
  const result = [];
  for (const day of weeklySchedule) {
    if (!day.isWorking || !day.slots?.length) continue;
    for (const slot of day.slots) {
      result.push({ daysOfWeek: [day.dayOfWeek], startTime: slot.startTime, endTime: slot.endTime });
    }
  }
  return result.length > 0 ? result : true;
}

async function loadBusinessHours(practitionerId) {
  if (!state.calendar) return;
  try {
    const endpoint = practitionerId
      ? `/api/gestion/availability/schedule/${practitionerId}`
      : SCHEDULE_API;
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.schedule?.weeklySchedule) return;
    state.calendar.setOption('businessHours', scheduleToBusinessHours(data.schedule.weeklySchedule));
  } catch (_) {}
}

// ─── renderModule ─────────────────────────────────────────────────────────────

export async function renderModule(container) {
  injectCss();

  container.innerHTML = buildHtml();
  state.root = container.querySelector('.plm-root');

  // Init myPractitionerId from /schedule/me (needed before any user action)
  try {
    const meRes = await fetch(SCHEDULE_API, { cache: 'no-store' });
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData.ok && meData.practitionerId) {
        state.myPractitionerId = meData.practitionerId;
      }
    }
  } catch (_) {}

  // Initialize FullCalendar
  const calEl = qs('[data-plm-calendar]');
  if (!calEl || !window.FullCalendar) {
    const err = !window.FullCalendar ? 'FullCalendar non chargé.' : 'Conteneur calendrier introuvable.';
    if (calEl) calEl.innerHTML = `<p style="color:var(--color-danger);padding:1rem">${err}</p>`;
    return;
  }

  const initialView = window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek';

  const calendar = new window.FullCalendar.Calendar(calEl, {
    locale: 'fr',
    initialView,
    headerToolbar: false,
    slotMinTime: '07:00:00',
    slotMaxTime: '22:00:00',
    allDaySlot: true,
    nowIndicator: true,
    businessHours: true,
    events: fetchEvents,
    eventClick: handleEventClick,
    dateClick: handleDateClick,
    datesSet: function() {
      updateTitle();
      updateTodayBtn();
      updateEditViewBtn();
    },
    viewDidMount: function() {
      updateEditViewBtn();
    },
    height: 'auto'
  });

  calendar.render();
  state.calendar = calendar;
  setTimeout(() => updateEditViewBtn(), 0);

  // Set initial title after render
  updateTitle();
  updateTodayBtn();

  // Load business hours from practitioner schedule (hides off-hours with hatching)
  loadBusinessHours();

  // Bind toolbar interactions
  bindToolbar();
}
