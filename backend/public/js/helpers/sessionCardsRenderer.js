function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateLabel(value, options = {}) {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...options
  });
}

export function normalizeTimeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  const hours = String(Math.max(0, Math.min(23, Number(match[1])))).padStart(2, "0");
  const minutes = String(Math.max(0, Math.min(59, Number(match[2])))).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function buildSessionTimeRangeLabel(session) {
  const schedule = Array.isArray(session?.schedule) ? session.schedule : [];
  if (!schedule.length) return "Horaires non definis";
  const normalized = schedule
    .map((entry) => ({
      dayIndex: Number(entry?.dayIndex || 0),
      startTime: normalizeTimeLabel(entry?.startTime),
      endTime: normalizeTimeLabel(entry?.endTime)
    }))
    .filter((entry) => entry.startTime && entry.endTime)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  if (!normalized.length) return "Horaires non definis";
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (normalized.length === 1) return `${first.startTime} - ${first.endTime}`;
  return `${first.startTime} - ${last.endTime}`;
}

export function getSessionRemainingSlots(session) {
  const explicit = Number(session?.placesRemaining);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  const capacity = Number(session?.maxClients);
  const booked = Number(session?.reservedCount);
  if (Number.isFinite(capacity) && Number.isFinite(booked)) {
    return Math.max(0, capacity - booked);
  }
  return 0;
}

export function isSessionComplete(session) {
  const remaining = getSessionRemainingSlots(session);
  const capacity = Number(session?.maxClients);
  const booked = Number(session?.reservedCount);
  if (Number.isFinite(capacity) && Number.isFinite(booked) && capacity > 0) {
    return booked >= capacity;
  }
  if (remaining <= 0) {
    return true;
  }
  if (typeof session?.isAvailable === "boolean") {
    return !session.isAvailable;
  }
  return false;
}

export function isSessionSelectable(session) {
  return Boolean(session) && !isSessionComplete(session);
}

export function findFirstSelectableSessionId(sessions = []) {
  const match = Array.isArray(sessions) ? sessions.find((session) => isSessionSelectable(session)) : null;
  return String(match?.id || "").trim();
}

export function buildSessionSelectionLabel(session) {
  if (!session) return "Aucune session sélectionnée.";
  return `Session sélectionnée : ${formatDateLabel(session.startDate)} (${buildSessionTimeRangeLabel(session)})`;
}

export function buildSessionSummaryLine(session) {
  const duration = Number.isFinite(Number(session?.durationDays))
    ? Math.max(1, Number(session.durationDays))
    : 1;
  return `${formatDateLabel(session?.startDate)} - ${duration} jour${duration > 1 ? "s" : ""}`;
}

function buildRemainingBadgeLabel(session) {
  const remaining = getSessionRemainingSlots(session);
  if (remaining <= 0) return "Compl&egrave;te";
  return `${remaining} place${remaining > 1 ? "s" : ""}`;
}

function buildSupportingText(session, isComplete) {
  if (isComplete) return "Aucune place restante";
  const duration = Number.isFinite(Number(session?.durationDays))
    ? Math.max(1, Number(session.durationDays))
    : 1;
  return `${duration} jour${duration > 1 ? "s" : ""}`;
}

export function buildSessionCardsMarkup({
  sessions = [],
  selectedSessionId = "",
  emptyMessage = "Aucune session disponible pour le moment."
} = {}) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return `<p class="module-placeholder">${escapeHtml(emptyMessage)}</p>`;
  }

  return sessions
    .map((session) => {
      const sessionId = String(session?.id || "").trim();
      const isSelected = sessionId && sessionId === String(selectedSessionId || "").trim();
      const complete = isSessionComplete(session);
      const badgeLabel = buildRemainingBadgeLabel(session);
      const supportLabel = buildSupportingText(session, complete);
      const timeLabel = buildSessionTimeRangeLabel(session);

      return `
        <button
          type="button"
          class="session-card ${isSelected ? "is-selected" : ""} ${complete ? "is-complete" : ""}"
          data-session-card
          data-session-id="${escapeHtml(sessionId)}"
          aria-pressed="${isSelected ? "true" : "false"}"
          ${complete ? "disabled aria-disabled=\"true\"" : ""}
        >
          <span class="session-card__icon" aria-hidden="true">
            <i class="bi bi-calendar-event"></i>
          </span>
          <span class="session-card__content">
            <span class="session-card__eyebrow">${escapeHtml(buildSessionSummaryLine(session))}</span>
            <span class="session-card__title">${escapeHtml(timeLabel)}</span>
            <span class="session-card__support">${escapeHtml(supportLabel)}</span>
          </span>
          <span class="session-card__meta">
            <span class="session-card__badge ${complete ? "is-complete" : ""}">${badgeLabel}</span>
            <span class="session-card__status">
              ${
                complete
                  ? "Aucune place restante"
                  : isSelected
                    ? "Selectionnee"
                    : "Disponible"
              }
            </span>
            <span class="session-card__check" aria-hidden="true">
              <i class="bi bi-check2-circle"></i>
            </span>
          </span>
        </button>
      `;
    })
    .join("");
}
