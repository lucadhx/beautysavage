/**
 * URL du dépôt GitHub CIBLE d'une duplication — miroir front du validateur
 * backend (`backend/src/utils/githubRepositoryUrl.js`). Module PUR, testable :
 * le backend reste l'autorité, ceci ne sert qu'au retour immédiat du wizard.
 */

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function validateGithubRepositoryUrl(value: string): { valid: boolean; normalized: string | null; error: string | null } {
  const raw = String(value ?? '').trim().replace(/\s+/g, '');
  if (!raw) return { valid: false, normalized: null, error: 'URL du dépôt GitHub requise.' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, normalized: null, error: 'URL invalide — ex. https://github.com/mon-organisation/mon-projet.git' };
  }
  if (url.protocol !== 'https:') return { valid: false, normalized: null, error: 'Seul HTTPS est accepté.' };
  if (url.username || url.password) return { valid: false, normalized: null, error: "L'URL ne doit contenir aucun identifiant ni token." };
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return { valid: false, normalized: null, error: 'Seules les URL github.com sont acceptées.' };
  if (url.search || url.hash) return { valid: false, normalized: null, error: "L'URL ne doit contenir ni paramètres ni fragment." };
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return { valid: false, normalized: null, error: 'URL incomplète — attendu : https://github.com/<propriétaire>/<dépôt>.' };
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner)) return { valid: false, normalized: null, error: 'Propriétaire GitHub invalide.' };
  if (!repo || !REPO_RE.test(repo)) return { valid: false, normalized: null, error: 'Nom de dépôt GitHub invalide.' };
  return { valid: true, normalized: `https://github.com/${owner}/${repo}.git`, error: null };
}
