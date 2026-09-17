// RX-RUN-2 — Helpers PURS partagés par les lanceurs officiels (dev/start/build). Testables sans process.
// Règle : le flag React est INJECTÉ par le script (jamais via .env). dev/start = React ON ; --vanilla = OFF.

/** true si l'argv demande le rollback Vanilla. */
export function isVanilla(argv = []) {
  return argv.includes('--vanilla');
}

/** Valeur du flag REACT_OFFICIAL_FRONTEND à injecter selon l'argv. */
export function reactFlagFor(argv = []) {
  return isVanilla(argv) ? 'false' : 'true';
}

/**
 * Construit l'environnement d'exécution en injectant le flag React. NE MODIFIE PAS le .env : renvoie un
 * nouvel objet. NODE_ENV est préservé (défaut 'development' seulement si absent — laisse la prod décider).
 */
export function envWithReactFlag(baseEnv = {}, argv = []) {
  return {
    ...baseEnv,
    REACT_OFFICIAL_FRONTEND: reactFlagFor(argv),
    NODE_ENV: baseEnv.NODE_ENV || 'development',
  };
}

/** Port d'écoute résolu (défaut 3000). */
export function resolvePort(baseEnv = {}) {
  const p = Number(baseEnv.PORT);
  return Number.isFinite(p) && p > 0 ? p : 3000;
}

/** URLs à afficher au lancement (parité dev/deploy). */
export function launchUrls(port = 3000) {
  const base = `http://localhost:${port}`;
  return [`${base}/app`, `${base}/manager`, `${base}/api/site-status`];
}

/** Bannière lisible (mode + URLs). Aucun secret. */
export function banner({ mode, port }) {
  const lines = [
    '',
    `BeautySavage — ${mode === 'vanilla' ? 'VANILLA (rollback, React OFF)' : 'React OFFICIEL (ON)'}`,
    ...launchUrls(port).map((u) => `  → ${u}`),
    '',
  ];
  return lines.join('\n');
}
