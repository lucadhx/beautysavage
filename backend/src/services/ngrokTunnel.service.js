import { config } from '../config/env.js';

/**
 * Détection AUTOMATIQUE du tunnel ngrok local — le chaînon manquant du dev.
 *
 * En production, l'URL publique du backend est écrite par le moteur de
 * déploiement (`runtime_config` → `https://api.<domaine>`). En développement,
 * elle était SAISIE À LA MAIN dans le Manager après chaque redémarrage de
 * ngrok — exactement le geste que ce module supprime : ngrok expose une API
 * locale d'inspection (`http://127.0.0.1:4040/api/tunnels`) qui donne l'URL
 * publique courante du tunnel. On la lit, on ne la devine jamais.
 *
 * Règles :
 *  - JAMAIS utilisé en PROD (`config.isProd`) — l'appelant garde ce garde-fou ;
 *  - on ne retient qu'un tunnel HTTPS qui pointe vers NOTRE port backend
 *    (un tunnel vers 6071/6062 est celui du Manager/vitrine, pas de l'API) ;
 *  - cache court : la carte Manager et la réconciliation peuvent interroger
 *    plusieurs fois par minute — pas la peine de marteler l'API locale ;
 *  - échec silencieux : ngrok absent n'est PAS une erreur, c'est « pas de
 *    tunnel » (le dev sans webhook reste un cas d'usage normal).
 */

const NGROK_API_URL = (process.env.NGROK_API_URL || 'http://127.0.0.1:4040').replace(/\/+$/, '');
const FETCH_TIMEOUT_MS = 1_500;
const CACHE_TTL_MS = 10_000;

let cache = { at: 0, url: null };

/** Le tunnel vise-t-il notre backend local (et pas un autre service) ? */
function targetsBackendPort(tunnel, port) {
  const addr = String(tunnel?.config?.addr || '');
  // Formes observées : "http://localhost:6070", "localhost:6070", "6070".
  return addr.endsWith(`:${port}`) || addr === String(port);
}

/**
 * URL publique HTTPS du tunnel ngrok qui expose le backend, ou `null`.
 * Ne lève JAMAIS. Résultat mis en cache ~10 s.
 *
 * @param {{port?: number, force?: boolean}} [opts]
 * @returns {Promise<string|null>}
 */
export async function detectNgrokPublicUrl({ port = config.port, force = false } = {}) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_TTL_MS) return cache.url;

  let url = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${NGROK_API_URL}/api/tunnels`, { signal: controller.signal });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const tunnels = Array.isArray(body?.tunnels) ? body.tunnels : [];
      const match = tunnels.find(
        (t) => String(t?.public_url || '').startsWith('https://') && targetsBackendPort(t, port)
      );
      url = match ? String(match.public_url).replace(/\/+$/, '') : null;
    }
  } catch {
    url = null; // ngrok absent/arrêté : silence, pas d'erreur
  } finally {
    clearTimeout(timer);
  }

  cache = { at: now, url };
  return url;
}

/** Vide le cache (tests, et bascule d'URL détectée). */
export function resetNgrokCache() {
  cache = { at: 0, url: null };
}
