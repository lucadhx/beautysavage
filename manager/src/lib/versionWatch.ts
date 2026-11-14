import * as React from 'react';

/**
 * NOUVELLE VERSION EN LIGNE — le Manager ouvert ne le savait jamais.
 *
 * Un onglet (ou l'icône posée sur l'écran d'accueil d'un iPhone) garde en
 * mémoire le code chargé à son ouverture, parfois des jours. Le menu vit dans
 * ce code : une page ajoutée par un déploiement (« Membres des formations »,
 * 2026-11-12) restait donc INVISIBLE pour l'institut, qui travaillait sur la
 * version de la veille sans aucun signe. Vu dans les journaux : un iPhone
 * servi en version périmée jusqu'au 2026-11-14, 6 h 22.
 *
 * Le remède ne demande rien au serveur : `index.html` (servi en `no-cache`)
 * nomme le script d'entrée, dont le nom porte l'empreinte du build. S'il
 * diffère de celui qui tourne, une version plus récente est en ligne.
 *
 * En développement (Vite), aucun script `/assets/index-*.js` : tout est inerte.
 */
const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;
const MIN_INTERVAL_MS = 60_000;
const POLL_MS = 5 * 60_000;

export function runningEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!script) return null;
  const match = new URL(script.src, window.location.href).pathname.match(ENTRY_RE);
  return match ? match[0] : null;
}

export async function deployedEntry(): Promise<string | null> {
  const response = await fetch(`/?version-check=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return null;
  const match = (await response.text()).match(ENTRY_RE);
  return match ? match[0] : null;
}

/** Vrai dès qu'un build plus récent que celui en mémoire est en ligne. */
export function useNewVersionAvailable(): boolean {
  const [stale, setStale] = React.useState(false);
  React.useEffect(() => {
    const running = runningEntry();
    if (!running) return undefined;
    let last = 0;
    let cancelled = false;
    const check = async () => {
      if (cancelled || Date.now() - last < MIN_INTERVAL_MS) return;
      last = Date.now();
      try {
        const deployed = await deployedEntry();
        if (!cancelled && deployed && deployed !== running) setStale(true);
      } catch { /* hors ligne : on réessaiera */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
  return stale;
}

/**
 * Rechargement après un morceau de code introuvable (déploiement entre-temps).
 * Autorisé une fois par minute, et non plus « une fois par session » : sur
 * iPhone une session dure des jours, et le second déploiement ne récupérait plus.
 */
export function mayReloadForMissingChunk(): boolean {
  const KEY = 'manager.chunk.reload';
  try {
    const previous = Number(sessionStorage.getItem(KEY) || 0);
    if (Number.isFinite(previous) && Date.now() - previous < MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* stockage refusé : on recharge quand même, une fois */ }
  return true;
}
