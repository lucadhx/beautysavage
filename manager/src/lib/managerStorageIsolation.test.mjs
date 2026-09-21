/**
 * ══ DEUX PROJETS, UNE ORIGINE, DEUX STOCKAGES ══════════════════════════════
 *
 * ── L'INCIDENT ────────────────────────────────────────────────────────────
 *
 * Le régime DEV canonique sert TOUS les managers de la fabrique sur la même
 * origine, `http://localhost:6071` (voir `vite.config.ts`). Or une origine est
 * exactement le périmètre d'isolation de `localStorage`.
 *
 * Les quatre projets du parc écrivaient donc leur état sous des clés IDENTIQUES
 * et globales : `manager.company.cache`, `manager.session.token`,
 * `sb_federation_state`, `deployment.run.*`. Ouvrir le manager de FJ Services
 * après celui de KleenPro faisait démarrer FJ avec le nom, le logo et le
 * favicon de KleenPro — hydratés SYNCHRONEMENT au premier rendu, et jamais
 * effacés en cas de panne d'API.
 *
 * ── CE QUE CETTE RECETTE PROUVE, ET COMMENT ───────────────────────────────
 *
 * Pas une chaîne de caractères : un COMPORTEMENT. On monte UN seul stockage —
 * celui de l'origine partagée — on y fait écrire le « projet A », puis on
 * recharge la résolution de clés en « projet B » et l'on vérifie que B ne lit
 * RIEN de ce que A a écrit.
 *
 * L'identité de build (`__PROJECT_KEY__`) est posée sur `globalThis` : sous
 * Node, un identifiant global se lit comme la constante que Vite injecte au
 * build. On exerce donc la VRAIE fonction de résolution, pas une imitation.
 *
 * Runner autonome : aucun navigateur, aucune base, aucun réseau.
 */
import assert from 'node:assert';
import fs from 'node:fs/promises';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

/** Un `Storage` conforme, en mémoire — LE stockage de l'origine partagée. */
function faireStockage() {
  const donnees = new Map();
  return {
    get length() { return donnees.size; },
    key: (i) => [...donnees.keys()][i] ?? null,
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => { donnees.set(k, String(v)); },
    removeItem: (k) => { donnees.delete(k); },
    clear: () => donnees.clear(),
    _cles: () => [...donnees.keys()],
  };
}

/**
 * Charge la résolution de clés COMME SI le build était celui de `cle`.
 *
 * Le module fige `PROJECT_KEY` à l'import : on casse donc le cache ESM par la
 * requête, faute de quoi le second projet relirait la clé du premier — ce qui
 * ferait passer la recette pour de mauvaises raisons.
 */
async function chargerPour(cle, marqueur) {
  if (cle === null) delete globalThis.__PROJECT_KEY__;
  else globalThis.__PROJECT_KEY__ = cle;
  const url = new URL(`./projectIdentity.ts?projet=${marqueur}`, import.meta.url);
  return import(url.href);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Un projet ne lit pas le stockage d’un autre');
{
  const stockage = faireStockage();

  const A = await chargerPour('kleenpro', 'a');
  const B = await chargerPour('fj-services-06', 'b');

  check('chaque projet dérive sa propre clé', A.PROJECT_KEY === 'kleenpro' && B.PROJECT_KEY === 'fj-services-06');

  /** Les quatre états réellement propres à un projet. */
  const SUFFIXES = [
    'manager.company.cache',
    'manager.session.token',
    'federation.state',
    'deployment.run.deprovision.6a8c6cfd22243d05d0a366d2',
  ];

  // KleenPro travaille : il écrit son identité, son jeton, son état.
  for (const s of SUFFIXES) stockage.setItem(A.cleProjet(s), `secret-kleenpro:${s}`);
  check(`KleenPro a bien écrit ses ${SUFFIXES.length} entrées`, stockage.length === SUFFIXES.length);

  // FJ Services ouvre son manager sur LA MÊME origine.
  const luParFj = SUFFIXES.map((s) => stockage.getItem(B.cleProjet(s)));
  check('FJ ne lit AUCUNE des entrées de KleenPro', luParFj.every((v) => v === null));

  // Et réciproquement : FJ écrit, KleenPro ne voit rien de neuf.
  for (const s of SUFFIXES) stockage.setItem(B.cleProjet(s), `secret-fj:${s}`);
  check('les deux jeux coexistent sans se recouvrir', stockage.length === SUFFIXES.length * 2);
  check('KleenPro relit les SIENNES, inchangées',
    SUFFIXES.every((s) => stockage.getItem(A.cleProjet(s)) === `secret-kleenpro:${s}`));
  check('…et FJ les siennes',
    SUFFIXES.every((s) => stockage.getItem(B.cleProjet(s)) === `secret-fj:${s}`));

  // Aucune clé nue ne subsiste : c'est la forme qui a produit l'incident.
  check('aucune clé n’est écrite sans préfixe de projet',
    stockage._cles().every((k) => k.startsWith('kleenpro.') || k.startsWith('fj-services-06.')));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Sans identité de build : isolé, JAMAIS partagé');
{
  /**
   * Le repli ne doit pas être un espace de noms global. S'il l'était, un build
   * mal configuré recréerait l'incident EN SILENCE — et c'est précisément la
   * façon dont il est né.
   */
  const erreurs = [];
  const consoleReelle = console.error;
  console.error = (...a) => erreurs.push(a.join(' '));
  const X = await chargerPour(null, 'x');
  const Y = await chargerPour(null, 'y');
  console.error = consoleReelle;

  check('deux chargements sans identité ne partagent pas la même clé', X.PROJECT_KEY !== Y.PROJECT_KEY);
  check('…et aucun ne retombe sur la clé nue',
    X.cleProjet('manager.company.cache') !== 'manager.company.cache'
    && Y.cleProjet('manager.company.cache') !== 'manager.company.cache');
  check('…et le repli est ANNONCÉ, pas silencieux',
    erreurs.some((e) => e.includes('__PROJECT_KEY__')));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. L’identité vient du BUILD, et d’une seule autorité');
{
  const vite = await fs.readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  check('le build injecte `__PROJECT_KEY__`', /define:\s*\{[\s\S]{0,200}__PROJECT_KEY__/.test(vite));
  check('…depuis le nom du paquet du manager, réécrit à la duplication',
    /require\('\.\/package\.json'\)\.name/.test(vite) && /replace\(\/-manager\$\//.test(vite));
  check('…et un build sans identité LÈVE au lieu de produire un manager muet',
    /throw new Error\(/.test(vite));

  /**
   * L'IDENTITÉ NE PEUT PAS VENIR D'UNE DONNÉE CLIENT.
   *
   * Le nom de l'entreprise arrive de l'API, APRÈS le premier rendu — c'est
   * exactement la donnée qu'on cloisonne. L'y adosser serait circulaire.
   */
  const identite = await fs.readFile(new URL('./projectIdentity.ts', import.meta.url), 'utf8');
  check('la clé ne dépend d’aucune donnée d’entreprise ni d’API',
    !/company|entreprise\.|api\.|fetch\(/i.test(identite.replace(/\/\*[\s\S]*?\*\//g, '')));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Aucun module ne recompose une clé globale dans son coin');
{
  const CIBLES = [
    ['context/CompanyContext.tsx', 'manager.company.cache'],
    ['lib/api.ts', 'manager.session.token'],
    ['lib/federation.ts', 'federation.state'],
    ['lib/deploymentRunId.ts', 'deployment.run.'],
  ];
  for (const [chemin, suffixe] of CIBLES) {
    const src = await fs.readFile(new URL(`../${chemin}`, import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check(`${chemin} passe par \`cleProjet\``, new RegExp(`cleProjet\\('${suffixe.replace(/[.]/g, '\\.')}'\\)`).test(code));
    /**
     * La chaîne nue ne doit plus servir de CLÉ. Elle peut rester citée dans une
     * purge d'héritage (`api.ts` efface les anciennes clés globales) : on
     * n'interdit donc pas sa présence, on interdit qu'elle soit ASSIGNÉE.
     */
    check(`…et n’assigne plus « ${suffixe} » en clé nue`,
      !new RegExp(`(KEY|CLE|MEMOIRE)\\s*=\\s*['\`]${suffixe.replace(/[.]/g, '\\.')}`).test(code));
  }

  const removal = await fs.readFile(new URL('../pages/dev/deployment/RemovalDialog.tsx', import.meta.url), 'utf8');
  check('RemovalDialog réutilise le préfixe commun, sans le reconstruire',
    /PREFIXE_MEMOIRE/.test(removal) && !/`deployment\.run\.\$\{/.test(removal));

  /**
   * LES CLÉS GLOBALES HÉRITÉES SONT EFFACÉES, JAMAIS MIGRÉES.
   *
   * Migrer une clé globale vers une clé de projet importerait le jeton du
   * DERNIER projet ouvert dans le manager du suivant : la reprise, écrite quand
   * l'origine n'était pas partagée, est devenue le vecteur.
   */
  const api = await fs.readFile(new URL('./api.ts', import.meta.url), 'utf8');
  const apiCode = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('les clés globales héritées sont PURGÉES', /CLES_GLOBALES_HERITEES/.test(apiCode)
    && /removeItem\(morte\)/.test(apiCode));
  check('…et plus jamais recopiées dans la clé courante',
    !/setItem\(TOKEN_KEY,\s*heritee\)/.test(apiCode));
}

assert.ok(true);
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
