const STORAGE_KEY = 'beautysavage_notifications';
export const ACQUISITION_NOTIFICATION_EVENT = 'acquisition:updated';
export const ACQUISITION_PAGES = {
  MY_FORMATIONS: 'myformations',
  MY_GIFT_CARDS: 'my-gift-cards'
};

const TRACKED_SLUGS = Object.values(ACQUISITION_PAGES);
const STORAGE_FIELDS = Object.freeze({
  [ACQUISITION_PAGES.MY_FORMATIONS]: 'formations',
  [ACQUISITION_PAGES.MY_GIFT_CARDS]: 'cartesCadeaux'
});

let storageAvailable = false;
let storageRef = null;
let memoryCounts = createDefaultCounts();

function createDefaultCounts() {
  return TRACKED_SLUGS.reduce((acc, slug) => ({
    ...acc,
    [slug]: 0
  }), {});
}

function ensureStorage() {
  if (storageAvailable) return;
  if (typeof window === 'undefined') return;
  try {
    storageRef = window.sessionStorage;
    const testKey = '__beautysavage_notifications_test__';
    storageRef.setItem(testKey, testKey);
    storageRef.removeItem(testKey);
    storageAvailable = true;
  } catch (_error) {
    storageAvailable = false;
    storageRef = null;
  }
}

function normalizeCounter(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function ensurePersistedShape(candidate = {}) {
  return {
    formations: normalizeCounter(candidate?.formations),
    cartesCadeaux: normalizeCounter(candidate?.cartesCadeaux)
  };
}

function persistedToInternal(candidate = {}) {
  const normalizedPersisted = ensurePersistedShape(candidate);
  return TRACKED_SLUGS.reduce((acc, slug) => {
    const field = STORAGE_FIELDS[slug];
    acc[slug] = normalizeCounter(normalizedPersisted?.[field]);
    return acc;
  }, {});
}

function internalToPersisted(candidate = {}) {
  const normalizedInternal = TRACKED_SLUGS.reduce((acc, slug) => {
    acc[slug] = normalizeCounter(candidate?.[slug]);
    return acc;
  }, {});
  return {
    formations: normalizedInternal[ACQUISITION_PAGES.MY_FORMATIONS],
    cartesCadeaux: normalizedInternal[ACQUISITION_PAGES.MY_GIFT_CARDS]
  };
}

function parseCounts(raw) {
  if (!raw) return createDefaultCounts();
  try {
    const parsed = JSON.parse(raw);
    return persistedToInternal(parsed);
  } catch (_error) {
    return createDefaultCounts();
  }
}

function loadCounts() {
  ensureStorage();
  if (storageAvailable && storageRef) {
    const raw = storageRef.getItem(STORAGE_KEY);
    const persisted = parseCounts(raw);
    memoryCounts = { ...persisted };
    return persisted;
  }
  return { ...memoryCounts };
}

function persistCounts(counts) {
  memoryCounts = { ...counts };
  if (!storageAvailable || !storageRef) return;
  try {
    storageRef.setItem(STORAGE_KEY, JSON.stringify(internalToPersisted(counts)));
  } catch (error) {
    console.warn("Impossible de sauvegarder les notifications d'acquisition", error);
  }
}

function countsEqual(a, b) {
  return TRACKED_SLUGS.every(slug => Number(a?.[slug] ?? 0) === Number(b?.[slug] ?? 0));
}

function dispatchUpdate(counts, updatedSlug) {
  if (typeof window === 'undefined') return;
  const total = Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  window.dispatchEvent(
    new CustomEvent(ACQUISITION_NOTIFICATION_EVENT, {
      detail: { counts: { ...counts }, total, updatedSlug: updatedSlug || null }
    })
  );
}

function updateCounts(transform, updatedSlug) {
  const baseline = loadCounts();
  const candidate = transform({ ...baseline });
  const next = TRACKED_SLUGS.reduce((acc, slug) => {
    acc[slug] = normalizeCounter(candidate?.[slug]);
    return acc;
  }, {});
  if (countsEqual(baseline, next)) {
    return baseline;
  }
  persistCounts(next);
  dispatchUpdate(next, updatedSlug);
  return next;
}

function normalizeSlug(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
}

function isTrackedSlug(slug) {
  return TRACKED_SLUGS.includes(slug);
}

export function getNotificationCounts() {
  return loadCounts();
}

export function getTotalNotificationCount() {
  const counts = loadCounts();
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

export function incrementAcquisitionNotifications(slug, amount = 1) {
  const normalized = normalizeSlug(slug);
  if (!isTrackedSlug(normalized)) return getNotificationCounts();
  const increment = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
  if (!increment) return getNotificationCounts();
  return updateCounts(counts => ({
    ...counts,
    [normalized]: (counts[normalized] || 0) + Math.floor(increment)
  }), normalized);
}

export function resetAcquisitionNotifications(slug) {
  const normalized = normalizeSlug(slug);
  if (!isTrackedSlug(normalized)) return getNotificationCounts();
  return updateCounts(counts => ({
    ...counts,
    [normalized]: 0
  }), normalized);
}

if (typeof window !== 'undefined') {
  ensureStorage();
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    const next = parseCounts(event.newValue);
    if (countsEqual(memoryCounts, next)) return;
    memoryCounts = { ...next };
    dispatchUpdate(next, null);
  });
}
