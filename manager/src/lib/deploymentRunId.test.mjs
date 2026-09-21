/**
 * ══ L'IDENTIFIANT DE RUN ÉTRANGER — LA GARDE, ÉPROUVÉE ══════════════════════
 *
 * L'incident : le backend de ce projet a reçu QUATRE fois
 *
 *     GET /api/deployment/runs/4543fbf7-869c-4d4f-b385-a1869abcceae/stream?since=0
 *
 * alors qu'un run d'ici est un ObjectId Mongo. Un identifiant d'un autre
 * produit de l'écosystème s'était donc glissé dans le client — et son refus
 * (401/404) se lisait comme une session invalide, envoyant chercher un défaut
 * d'authentification là où il n'y en avait pas.
 *
 * Cette recette éprouve les deux frontières où la valeur peut entrer :
 * le STOCKAGE persistant et le RÉSEAU.
 *
 * Runner autonome : aucun navigateur, aucune base, aucun réseau.
 */
import assert from 'node:assert';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

/** Un `Storage` conforme, en mémoire — même surface que celle du navigateur. */
function faireStockage(initial = {}) {
  const donnees = new Map(Object.entries(initial));
  return {
    get length() { return donnees.size; },
    key: (i) => [...donnees.keys()][i] ?? null,
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => { donnees.set(k, String(v)); },
    removeItem: (k) => { donnees.delete(k); },
    _donnees: donnees,
  };
}

const UUID_INCIDENT = '4543fbf7-869c-4d4f-b385-a1869abcceae';
const OBJECT_ID = '6a822d103467347307c8fda8';

/**
 * L'IDENTITÉ DE BUILD EST POSÉE AVANT L'IMPORT.
 *
 * Le préfixe de mémoire est désormais CLOISONNÉ PAR PROJET (les managers du
 * parc partagent l'origine `localhost:6071`, donc le même stockage). Sans
 * identité injectée, le module repart d'un espace de noms jetable — correct en
 * production, mais impossible à éprouver. On fixe donc la clé, comme le fait
 * `vite.config.ts` au build.
 */
globalThis.__PROJECT_KEY__ = 'projet-de-recette';

const { estRunIdDeCeProjet, purgerRunsEtrangers, PREFIXE_MEMOIRE } = await import('./deploymentRunId.ts');

/** Le préfixe d'un AUTRE projet du parc, dans LE MÊME stockage d'origine. */
const PREFIXE_VOISIN = 'projet-voisin.deployment.run.';

globalThis.sessionStorage = faireStockage({
  [`${PREFIXE_MEMOIRE}DEPROVISION.t-1`]: UUID_INCIDENT,
  [`${PREFIXE_MEMOIRE}DELETE.t-2`]: OBJECT_ID,
  [`${PREFIXE_VOISIN}DEPROVISION.t-9`]: UUID_INCIDENT,
  'autre.cle.sans.rapport': UUID_INCIDENT,
});
globalThis.localStorage = faireStockage({
  [`${PREFIXE_MEMOIRE}DEPROVISION.t-3`]: 'pas-un-identifiant',
  'manager.token': 'jeton-a-preserver',
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1 · La forme canonique d’un run de CE projet');
{
  check('un ObjectId Mongo est accepté', estRunIdDeCeProjet(OBJECT_ID) === true);
  check('l’UUID de l’incident est REFUSÉ', estRunIdDeCeProjet(UUID_INCIDENT) === false);
  check('…comme tout UUID en général',
    estRunIdDeCeProjet('7d0dadd6-dff6-4cbb-ac89-05d710ce7c85') === false);
  check('une chaîne vide est refusée', estRunIdDeCeProjet('') === false);
  check('un non-texte est refusé',
    estRunIdDeCeProjet(null) === false && estRunIdDeCeProjet(undefined) === false
    && estRunIdDeCeProjet(42) === false && estRunIdDeCeProjet({}) === false);
  check('un ObjectId tronqué est refusé', estRunIdDeCeProjet(OBJECT_ID.slice(0, 23)) === false);
  check('…et un ObjectId rallongé aussi', estRunIdDeCeProjet(`${OBJECT_ID}a`) === false);
  check('la casse hexadécimale est tolérée', estRunIdDeCeProjet(OBJECT_ID.toUpperCase()) === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2 · La purge retire l’étranger, et RIEN d’autre');
{
  const { retires } = purgerRunsEtrangers();

  check('l’entrée portant l’UUID de l’incident est retirée',
    retires.includes(`${PREFIXE_MEMOIRE}DEPROVISION.t-1`)
    && globalThis.sessionStorage.getItem(`${PREFIXE_MEMOIRE}DEPROVISION.t-1`) === null);
  check('une valeur illisible est retirée elle aussi',
    globalThis.localStorage.getItem(`${PREFIXE_MEMOIRE}DEPROVISION.t-3`) === null);
  check('l’entrée d’un AUTRE PROJET n’est jamais touchée — la purge s’arrête à son périmètre',
    globalThis.sessionStorage.getItem(`${PREFIXE_VOISIN}DEPROVISION.t-9`) === UUID_INCIDENT);

  /**
   * CE QUE LA PURGE NE DOIT SURTOUT PAS FAIRE.
   *
   * Retirer un run VALIDE ferait disparaître la reprise d'opération — le
   * comportement qu'on veut garder. Et toucher au jeton transformerait un
   * correctif de suivi en déconnexion : exactement le symptôme d'origine.
   */
  check('un run VALIDE est conservé — la reprise reste possible',
    globalThis.sessionStorage.getItem(`${PREFIXE_MEMOIRE}DELETE.t-2`) === OBJECT_ID);
  check('une clé sans rapport n’est jamais touchée',
    globalThis.sessionStorage.getItem('autre.cle.sans.rapport') === UUID_INCIDENT);
  check('LE JETON DE SESSION EST INTACT — une purge n’est pas une déconnexion',
    globalThis.localStorage.getItem('manager.token') === 'jeton-a-preserver');

  const second = purgerRunsEtrangers();
  check('une seconde purge n’a plus rien à retirer (idempotente)', second.retires.length === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3 · Un stockage indisponible ne casse pas le démarrage');
{
  const casse = {
    get length() { throw new Error('stockage refusé'); },
    key: () => { throw new Error('stockage refusé'); },
    getItem: () => { throw new Error('stockage refusé'); },
    removeItem: () => { throw new Error('stockage refusé'); },
  };
  const avant = { session: globalThis.sessionStorage, local: globalThis.localStorage };
  globalThis.sessionStorage = casse;
  globalThis.localStorage = casse;
  let leve = null;
  try { purgerRunsEtrangers(); } catch (err) { leve = err; }
  check('la purge ne lève jamais (navigation privée, quota, refus)', leve === null);
  globalThis.sessionStorage = avant.session;
  globalThis.localStorage = avant.local;
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4 · La frontière RÉSEAU refuse l’identifiant étranger');
{
  /**
   * On éprouve le CHEMIN, pas une copie de la règle : le garde du client HTTP
   * est une fonction pure sur l'adresse demandée. On la rejoue telle qu'elle
   * est écrite dans `api.ts`, et l'on vérifie qu'elle discrimine.
   */
  const motif = /^\/deployment\/runs\/([^/?]+)/;
  const refuse = (chemin) => {
    const m = motif.exec(chemin);
    if (!m) return false;
    return !estRunIdDeCeProjet(decodeURIComponent(m[1]));
  };

  check('l’adresse EXACTE de l’incident est refusée',
    refuse(`/deployment/runs/${UUID_INCIDENT}/stream?since=0`) === true);
  check('…y compris sans le flux', refuse(`/deployment/runs/${UUID_INCIDENT}`) === true);
  check('…et même encodée', refuse(`/deployment/runs/${encodeURIComponent(UUID_INCIDENT)}`) === true);
  check('un run LÉGITIME passe', refuse(`/deployment/runs/${OBJECT_ID}`) === false);
  check('la liste des runs n’est pas concernée', refuse('/deployment/runs') === false);
  check('…ni le reste du plan de déploiement',
    refuse('/deployment/deploy/stream') === false && refuse('/deployment/vps-session') === false);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5 · Le client et le stockage partagent UNE SEULE règle');
{
  /**
   * Deux frontières, deux appels — mais une seule définition. Si l'une des deux
   * se mettait à juger différemment, un identifiant refusé au réseau pourrait
   * rester en mémoire (ou l'inverse), et le défaut reviendrait par la porte
   * restée ouverte.
   */
  const fs = await import('node:fs/promises');
  const api = await fs.readFile(new URL('./api.ts', import.meta.url), 'utf8');
  const dialog = await fs.readFile(
    new URL('../pages/dev/deployment/RemovalDialog.tsx', import.meta.url), 'utf8',
  );
  const main = await fs.readFile(new URL('../main.tsx', import.meta.url), 'utf8');

  check('le client HTTP importe la règle commune',
    /estRunIdDeCeProjet/.test(api) && /from '@\/lib\/deploymentRunId'/.test(api));
  check('…et l’applique au point de sortie unique', /refuserRunEtranger\(path\)/.test(api));
  check('l’écran qui restaure un run l’applique aussi',
    /estRunIdDeCeProjet\(memorise\)/.test(dialog));
  check('…et oublie l’entrée refusée plutôt que de la relire sans fin',
    /!estRunIdDeCeProjet\(memorise\)\)\s*\{[\s\S]{0,120}oublierRun/.test(dialog));
  check('la purge tourne AVANT le premier rendu',
    /purgerRunsEtrangers\(\);/.test(main)
    && main.indexOf('purgerRunsEtrangers();') < main.indexOf('createRoot'));

  assert.ok(true);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
