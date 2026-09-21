/** Miroir client de backend/src/utils/normalizeAppUrl.js (validation + aperçu). */
export type NormalizeResult = { ok: true; value: string } | { ok: false; error: string };

export function normalizeAppUrl(input: string): NormalizeResult {
  const raw = (input || '').trim();
  if (!raw) return { ok: false, error: "L'URL ne peut pas être vide" };
  if (/\s/.test(raw)) return { ok: false, error: "L'URL ne doit pas contenir d'espace" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'URL invalide (ex: https://domaine.com)' };
  }
  if (!['http:', 'https:'].includes(url.protocol))
    return { ok: false, error: 'Seuls http:// et https:// sont autorisés' };
  if (url.username || url.password) return { ok: false, error: 'URL avec identifiants refusée' };
  if (url.pathname && url.pathname !== '/')
    return { ok: false, error: 'Origine sans chemin attendue (ex: https://api.domaine.com)' };
  if (url.search || url.hash) return { ok: false, error: 'Pas de paramètres ni de fragment' };
  return { ok: true, value: url.origin };
}
