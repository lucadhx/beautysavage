const SITE_STATUS_ENDPOINT = '/api/site-status';
const CACHE_TTL_MS = 10000;

let cachedStatus = null;
let cachedAt = 0;

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'suspended') return 'suspended';
  if (candidate === 'maintenance') return 'maintenance';
  return 'active';
}

function normalizePayload(payload = {}) {
  return {
    status: normalizeStatus(payload?.status),
    reason: String(payload?.reason || '').trim(),
    eta: String(payload?.eta || '').trim(),
    startedAt: payload?.startedAt || null,
    updatedAt: payload?.updatedAt || null
  };
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

export function isSiteSuspended(statusPayload) {
  return normalizeStatus(statusPayload?.status) === 'suspended';
}

export function isSiteMaintenance(statusPayload) {
  return normalizeStatus(statusPayload?.status) === 'maintenance';
}

export function isSiteBlockedForUser(statusPayload, user) {
  const status = normalizeStatus(statusPayload?.status);
  if (status === 'suspended') return true;
  if (status === 'maintenance') {
    return normalizeRole(user?.role) !== 'dev';
  }
  return false;
}

export async function getSiteStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }
  try {
    const response = await fetch(SITE_STATUS_ENDPOINT, {
      credentials: 'include'
    });
    const payload = await response.json().catch(() => ({}));
    const normalized = normalizePayload(payload);
    cachedStatus = normalized;
    cachedAt = now;
    return cachedStatus;
  } catch (error) {
    console.error('Erreur lecture statut site public', error);
    return { status: 'active', reason: '', eta: '', startedAt: null, updatedAt: null };
  }
}

export function clearSiteStatusCache() {
  cachedStatus = null;
  cachedAt = 0;
}
