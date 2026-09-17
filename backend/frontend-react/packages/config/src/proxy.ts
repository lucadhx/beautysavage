// Chemins backend à proxifier en dev (same-origin, pas de CORS). Source unique partagée par
// les deux apps Vite. ⚠️ /auth est hors /api (monté sur /auth dans app.js) ; /uploads sert les médias.
export const PROXY_PATHS = ['/api', '/auth', '/uploads'] as const;

export const DEFAULT_PROXY_TARGET = 'http://localhost:3000';

export interface ProxyEntry {
  target: string;
  changeOrigin: boolean;
  secure: boolean;
}

/** Construit la map de proxy Vite : chaque chemin → même cible backend. */
export function buildProxyMap(target: string = DEFAULT_PROXY_TARGET): Record<string, ProxyEntry> {
  const opts: ProxyEntry = { target, changeOrigin: true, secure: false };
  return Object.fromEntries(PROXY_PATHS.map((path) => [path, opts]));
}
