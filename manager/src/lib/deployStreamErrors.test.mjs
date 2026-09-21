/* Un REFUS du serveur n'est pas une panne réseau.
 *
 * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
 * Quand le backend refuse d'ouvrir le flux de déploiement (400 + JSON), le
 * lecteur NDJSON ne retenait que le message et perdait le `code`. L'écran de
 * déploiement, lui, mappait TOUTE erreur d'itération sur « OFFLINE » : le
 * Manager affichait « Serveur momentanément injoignable — Le service n'a pas
 * répondu » alors que le serveur venait précisément de répondre, et
 * d'expliquer pourquoi il refusait.
 *
 * Module PUR. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// `api.ts` lit le jeton dans localStorage : on le stube avant l'import.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const REFUSAL = {
  success: false,
  code: 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED',
  message: 'Impossible de lancer le déploiement : Source Git non commitée.',
  details: {
    code: 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED',
    scope: 'local',
    pipelineExecuted: false,
    files: [{ path: 'backend/src/serveur.js', state: 'modifié' }],
  },
};

/** Réponse HTTP simulée, au strict nécessaire pour `streamNdjson`. */
function fakeResponse({ ok, status, body = null, text = '' }) {
  return { ok, status, body, text: async () => text };
}

/** Corps NDJSON lisible, pour le cas nominal. */
function ndjsonBody(lines) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(`${JSON.stringify(l)}\n`));
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
    }),
  };
}

const { streamNdjson, ApiError, OFFLINE_STATUS } = await import('./api.ts');

/** Consomme le générateur et rend l'erreur levée (ou null). */
async function drain(gen) {
  try {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of gen) { /* on ne garde rien */ }
    return null;
  } catch (err) {
    return err;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Refus argumenté du serveur (400 + JSON)');
{
  globalThis.fetch = async () => fakeResponse({ ok: false, status: 400, text: JSON.stringify(REFUSAL) });
  const err = await drain(streamNdjson('/deployment/deploy/stream', {}));

  check('une erreur est levée', err instanceof ApiError);
  check('le statut HTTP réel est conservé', err.status === 400);
  check('…et n’est SURTOUT PAS « hors ligne »', err.status !== OFFLINE_STATUS);
  check('le code métier du backend est conservé',
    err.code === 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED');
  check('le message du backend est conservé',
    err.message === 'Impossible de lancer le déploiement : Source Git non commitée.');
  check('les détails (fichiers fautifs) voyagent avec l’erreur',
    err.details?.files?.length === 1 && err.details.pipelineExecuted === false);

  // Le refus survient à la PREMIÈRE lecture : le générateur n'a rien produit.
  // C'est ce qui permet à l'écran de ne jamais afficher de checklist live.
  const gen = streamNdjson('/deployment/deploy/stream', {});
  const first = await gen.next().catch((e) => ({ threw: e }));
  check('le générateur lève dès la première lecture, sans rien émettre',
    first.threw instanceof ApiError && first.value === undefined);
}

section('2. Le cas OFFLINE reste distinct (non-régression)');
{
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const err = await drain(streamNdjson('/deployment/deploy/stream', {}));
  check('une panne réseau donne bien OFFLINE_STATUS', err instanceof ApiError && err.status === OFFLINE_STATUS);

  /**
   * ══ CETTE ASSERTION ENCODAIT UN MONDE ANTÉRIEUR ═══════════════════════════
   *
   * Elle exigeait `err.code === undefined`. Depuis, `BACKEND_INJOIGNABLE` a été
   * introduit — un code TECHNIQUE, qui a sa propre entrée dans `serverErrors`
   * et que le dialogue de retrait consomme pour nommer la panne. La règle
   * défendue ici n'a jamais été « aucun code » : c'était « aucun code MÉTIER »,
   * c'est-à-dire ne pas habiller une panne réseau en refus argumenté.
   *
   * Elle échouait donc sur du produit correct — et son échec est resté INVISIBLE
   * pendant tout ce temps, parce qu'un test antérieur de la chaîne `&&` plantait
   * au chargement et que ce fichier ne tournait plus du tout.
   *
   * On dit maintenant la règle telle qu'elle est, et on la RESSERRE : le code
   * doit être exactement le marqueur de panne, et jamais le refus métier que la
   * section 1 vient d'éprouver. Un code inventé échoue toujours.
   */
  check('…le code dit la PANNE, pas une explication métier',
    err.code === 'BACKEND_INJOIGNABLE');
  check('…et surtout jamais le refus argumenté du serveur',
    err.code !== REFUSAL.code);
}

section('3. Corps non-JSON : on ne prétend pas comprendre (non-régression)');
{
  globalThis.fetch = async () => fakeResponse({ ok: false, status: 502, text: '<html>Bad Gateway</html>' });
  const err = await drain(streamNdjson('/deployment/deploy/stream', {}));
  check('le statut est conservé', err.status === 502);
  check('message générique, sans code', err.message === 'Erreur serveur' && err.code === undefined);
}

section('4. Flux nominal : les évènements passent (non-régression)');
{
  const events = [
    { type: 'deployment.started', version: 'abc1234' },
    { type: 'step.started', stepId: 'ssh.connect' },
    { type: 'deployment.report_ready', ok: true, deploymentRunId: 'r-1' },
  ];
  globalThis.fetch = async () => fakeResponse({ ok: true, status: 200, body: ndjsonBody(events) });
  const seen = [];
  for await (const e of streamNdjson('/deployment/deploy/stream', {})) seen.push(e);
  check('les 3 évènements sont restitués, dans l’ordre',
    seen.length === 3 && seen[0].type === 'deployment.started' && seen[2].type === 'deployment.report_ready');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Le message affiché est le VRAI message');
{
  const { humanizeError } = await import('../pages/dev/deployment/friendly.ts');
  const shown = humanizeError('PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED', REFUSAL.message);
  const offline = humanizeError('OFFLINE');

  check('titre : « Impossible de lancer le déploiement »',
    shown.title === 'Impossible de lancer le déploiement');
  check('cause : « Source Git non commitée. »', shown.cause === 'Source Git non commitée.');
  check('solution : committer puis réessayer',
    /Committez vos modifications puis réessayez/.test(shown.solution));
  check('AUCUN « Serveur momentanément injoignable »',
    shown.title !== offline.title && !/injoignable|n’a pas répondu/.test(`${shown.title} ${shown.cause}`));
  check('le cas OFFLINE reste inchangé pour les vraies pannes',
    offline.title === 'Serveur momentanément injoignable');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
