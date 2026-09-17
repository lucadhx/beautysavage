// S1 — Validation & normalisation des URLs de domaine (SystemConfiguration / DomainResolver).
// Module PUR (aucune dépendance DB) → testable isolément.
//
// Règles (PARTIE 4 de la mission) :
//   - http(s) uniquement
//   - HTTPS obligatoire SAUF hôtes de dev (localhost / 127.0.0.1 / ::1 / *.local / *.ngrok*)
//   - jamais de slash final
//   - ni query (?) ni fragment (#)
//   - une seule URL « propre » canonique en sortie

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i;

/**
 * Un hôte est-il considéré « dev / local » (HTTP toléré) ?
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLocalOrDevHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (LOCAL_HOST_RE.test(host)) return true;
  if (host.endsWith('.local')) return true;
  if (host.endsWith('.localhost')) return true;
  // Tunnels de développement (ngrok & dérivés) : HTTPS de toute façon, mais tolérés.
  if (host.includes('ngrok')) return true;
  return false;
}

/**
 * Valide et normalise une URL de domaine.
 * @param {string} raw
 * @param {{ allowInsecure?: boolean, label?: string }} [opts]
 *   allowInsecure : force la tolérance HTTP (ex. seed dev) — par défaut, déduit de l'hôte.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function normalizeDomainUrl(raw, opts = {}) {
  const label = opts.label || 'URL';
  const candidate = String(raw == null ? '' : raw).trim();
  if (!candidate) {
    return { ok: false, error: `${label} requise.` };
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: `${label} invalide (format attendu : https://exemple.fr).` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `${label} doit utiliser http(s).` };
  }

  if (url.search || url.hash) {
    return { ok: false, error: `${label} ne doit contenir ni paramètre (?) ni ancre (#).` };
  }

  if (!url.hostname) {
    return { ok: false, error: `${label} doit comporter un domaine.` };
  }

  const insecureTolerated = opts.allowInsecure === true || isLocalOrDevHost(url.hostname);
  if (url.protocol === 'http:' && !insecureTolerated) {
    return { ok: false, error: `${label} doit être en HTTPS (hors localhost/dev).` };
  }

  // Reconstruction canonique : protocole + hôte (host = hostname[:port]) + chemin sans slash final.
  const path = url.pathname.replace(/\/+$/, '');
  const value = `${url.protocol}//${url.host}${path}`;
  return { ok: true, value };
}

/**
 * Variante « best effort » : retourne la valeur normalisée ou null (sans throw).
 * @param {string} raw
 * @param {object} [opts]
 * @returns {string|null}
 */
export function safeNormalizeDomainUrl(raw, opts = {}) {
  const res = normalizeDomainUrl(raw, opts);
  return res.ok ? res.value : null;
}

/**
 * Retire le slash final d'une base déjà fiable (sans validation de protocole).
 * Utilisé pour les valeurs de fallback env (NGROK, localhost).
 * @param {string} raw
 * @returns {string}
 */
export function stripTrailingSlash(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
}
