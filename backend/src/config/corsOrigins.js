import { config } from './env.js';
import { safeNormalizeAppUrl } from '../utils/normalizeAppUrl.js';

/**
 * Origines CORS autorisées = origines du .env (secours/sécurité, toujours
 * conservées) ∪ origines configurées dynamiquement (managerUrl, websiteUrl du
 * singleton SystemConfiguration). Mise en cache mémoire, rafraîchie au bootstrap
 * et après chaque modification réseau — aucune requête MongoDB par requête HTTP.
 */
let dynamicOrigins = [];

export function setDynamicOrigins(list) {
  dynamicOrigins = [...new Set(list.map(safeNormalizeAppUrl).filter(Boolean))];
}

export function getAllowedOrigins() {
  return [...new Set([...config.corsOrigins, ...dynamicOrigins])];
}

export function isOriginAllowed(origin) {
  return getAllowedOrigins().includes(origin);
}

/** Recharge les origines dynamiques depuis le singleton (best-effort). */
export async function refreshCorsOrigins() {
  try {
    const [{ SystemConfiguration }, { getSingleton }] = await Promise.all([
      import('../models/SystemConfiguration.model.js'),
      import('../utils/singleton.js'),
    ]);
    const cfg = await getSingleton(SystemConfiguration);
    const net = cfg.network || {};
    setDynamicOrigins([net.managerUrl, net.websiteUrl]);
  } catch {
    // MongoDB pas encore prêt / erreur : on garde les origines du .env comme secours.
  }
}
