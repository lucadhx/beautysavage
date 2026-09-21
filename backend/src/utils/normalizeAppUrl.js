/**
 * Normalise et valide une URL d'application (origine publique).
 *
 * Règle retenue : on stocke UNIQUEMENT des origines (scheme + host + port),
 * sans chemin, query ni fragment. C'est plus simple et plus sûr (ces URL
 * servent de base pour construire des liens, résoudre les médias, et comme
 * origines CORS).
 *
 *   https://api.domaine.com/      -> https://api.domaine.com
 *   http://localhost:6060         -> http://localhost:6060
 *   https://domaine.com/api/foo   -> refusé (chemin interdit)
 *
 * @throws {Error} message explicite en français si l'URL est invalide.
 * @returns {string} l'origine normalisée (sans slash final).
 */
export function normalizeAppUrl(input) {
  if (typeof input !== 'string') throw new Error('URL requise');
  const raw = input.trim();
  if (!raw) throw new Error("L'URL ne peut pas être vide");
  if (/\s/.test(raw)) throw new Error("L'URL ne doit pas contenir d'espace");
  if (raw.length > 2048) throw new Error('URL trop longue');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL invalide (format absolu attendu, ex: https://domaine.com)');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Protocole non autorisé : seuls http:// et https:// sont acceptés');
  }
  if (url.username || url.password) {
    throw new Error("URL avec identifiants intégrés refusée");
  }
  if (url.pathname && url.pathname !== '/') {
    throw new Error("L'URL doit être une origine sans chemin (ex: https://api.domaine.com)");
  }
  if (url.search || url.hash) {
    throw new Error("L'URL ne doit pas contenir de paramètres ni de fragment");
  }

  return url.origin; // scheme + host + port, sans slash final
}

/** Variante sans exception : renvoie l'origine normalisée ou null. */
export function safeNormalizeAppUrl(input) {
  try {
    return normalizeAppUrl(input);
  } catch {
    return null;
  }
}

export default normalizeAppUrl;
