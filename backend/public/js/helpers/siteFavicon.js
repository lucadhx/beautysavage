const MANAGED_ATTR = 'data-site-favicon-managed';
const FAVICON_RELS = ['icon', 'shortcut icon'];

function upsertFaviconLink(head, rel, href) {
  let link = head.querySelector(`link[rel="${rel}"][${MANAGED_ATTR}="true"]`);
  if (!link) {
    link = head.querySelector(`link[rel="${rel}"]`);
  }
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', rel);
    head.appendChild(link);
  }
  link.setAttribute(MANAGED_ATTR, 'true');
  link.setAttribute('href', href);
}

export function updateSiteFavicon(logoUrl) {
  const href = String(logoUrl || '').trim();
  if (typeof document === 'undefined') return;
  const head = document.head || document.querySelector('head');
  if (!head) return;
  if (!href) {
    head.querySelectorAll(`link[${MANAGED_ATTR}="true"]`).forEach(link => {
      link.setAttribute('href', '/favicon.ico');
    });
    return;
  }
  FAVICON_RELS.forEach(rel => upsertFaviconLink(head, rel, href));
}
