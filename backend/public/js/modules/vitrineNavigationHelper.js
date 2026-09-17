const VITRINE_NAV_EVENT = 'vitrine:navigate';

export function requestVitrineNavigation(slug, options = {}) {
  if (!slug) return;
  const normalized = String(slug || '').trim().toLowerCase();
  if (!normalized) return;
  if (typeof window === 'undefined') return;
  const detail = {
    slug: normalized,
    source: options.source || 'module',
    skipThrottle: Boolean(options.skipThrottle)
    ,
    query: options.query || null
  };
  console.log('[VITRINE NAV REQUEST]', detail);
  window.dispatchEvent(new CustomEvent(VITRINE_NAV_EVENT, { detail }));
}

export const VITRINE_NAV_EVENT_NAME = VITRINE_NAV_EVENT;
