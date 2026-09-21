import { API_ROOT } from './api';

/**
 * Résout une URL de média (source UNIQUE — ne pas dupliquer).
 *
 * Uploads stockés en chemin RELATIF (`/uploads/x.webp`). Sur le site déployé,
 * Nginx proxifie `/uploads/` en MÊME ORIGINE : le relatif suffit. En dev, on
 * préfixe avec `backendUrl` (config réseau) ou `VITE_API_URL`.
 *
 * Garde-fou MIXED-CONTENT : une ancienne valeur absolue `http://localhost:6060/…`
 * ne doit jamais être émise depuis une page HTTPS (bloquée par le navigateur) →
 * on la ramène à son chemin relatif (même origine → Nginx).
 */
function isHttpsPage(): boolean {
  return typeof window !== 'undefined' && window.location?.protocol === 'https:';
}

function isLocalOrInsecure(host: string, protocol: string): boolean {
  return protocol === 'http:' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function resolvePreviewMediaUrl(url?: string | null, backendUrl?: string): string {
  if (!url) return '';

  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
    if (url.startsWith('data:')) return url;
    if (isHttpsPage()) {
      try {
        const u = new URL(url);
        if (isLocalOrInsecure(u.hostname, u.protocol)) return `${u.pathname}${u.search}`;
      } catch {
        /* URL malformée : laissée telle quelle */
      }
    }
    return url;
  }

  let base = (backendUrl || API_ROOT || '').replace(/\/+$/, '');
  if (base && isHttpsPage() && /^http:\/\//i.test(base)) base = ''; // pas de http sur page https
  if (!base) return url.startsWith('/') ? url : `/${url}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}
