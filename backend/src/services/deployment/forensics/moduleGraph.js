/**
 * ══ LE GRAPHE DE MODULES RÉELLEMENT CHARGÉ PAR CE PROCESS ══════════════════
 *
 * ── POURQUOI CE MODULE EXISTE (LA FAUTE DE LA V1) ──────────────────────────
 *
 * La V1 du diagnostic posait une prémisse : « `backend/src` est le seul dossier
 * dont une modification relance le service ». Elle surveillait donc `src`, et
 * rien d'autre.
 *
 * La MESURE l'a invalidée. Sous `node --watch`, le critère de redémarrage n'est
 * pas « le fichier est sous `src` », c'est :
 *
 *     LE FICHIER APPARTIENT AU GRAPHE DE MODULES CHARGÉ.
 *
 * Peu importe où il vit. Un module importé depuis `backend/`, depuis un dossier
 * partagé du dépôt, ou depuis `node_modules`, provoque exactement le même
 * « Restarting 'src/server.js' ». Et symétriquement, un fichier SOUS `src` mais
 * jamais importé n'en provoque AUCUN.
 *
 * Les deux moitiés de l'erreur se compensaient à l'affichage et se cumulaient
 * en réalité :
 *
 *     surveillé mais inerte   182 fichiers de `src` hors graphe (bruit possible)
 *     chargé mais AVEUGLE     879 fichiers CJS de `node_modules` (angle mort)
 *
 * C'est ce second chiffre qui explique l'incident : le backend a redémarré, et
 * la V1 ne regardait aucun des 879 fichiers susceptibles de l'avoir causé.
 *
 * ── TROIS SOURCES, PARCE QU'AUCUNE NE SUFFIT SEULE ─────────────────────────
 *
 *   S1  TRAVERSÉE STATIQUE depuis le point d'entrée.
 *       Seule source capable de voir les modules chargés AVANT nous. Un
 *       `registerHooks` posé dans le graphe arrive toujours trop tard : ESM
 *       résout TOUT l'arbre statique avant d'évaluer la moindre ligne, donc
 *       avant que le crochet n'existe. Mesuré, pas supposé.
 *
 *   S2  CACHE CommonJS (`createRequire(...).cache`).
 *       Lisible à tout instant, sans contrainte d'ordre, et c'est LUI qui
 *       porte l'angle mort : tout `node_modules` chargé y figure, y compris
 *       les paquets tirés depuis de l'ESM par l'interopérabilité.
 *
 *   S3  `module.registerHooks()` — les imports DYNAMIQUES postérieurs.
 *       Ce code en fait beaucoup (`await import(...)` un peu partout). Le
 *       crochet ne rattrape pas le passé, mais il voit l'avenir. Optionnel :
 *       absent des Node antérieurs à 22.15, et son absence dégrade sans casser.
 *
 * L'union des trois est le graphe. Aucune n'est redondante, et l'on nomme la
 * provenance de chaque entrée — un diagnostic qui ne sait pas d'où il tient un
 * fait ne permet pas de contester ce fait.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
 *
 * Il n'écrit rien, ne surveille rien, n'importe aucun module du projet. Il ne
 * dépend que de `node:` — pour pouvoir être chargé n'importe quand sans rien
 * ajouter au graphe qu'il prétend décrire.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodeModule, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** `backend/src` */
export const SRC = path.resolve(ICI, '../../..');
/** `backend` */
export const BACKEND = path.resolve(SRC, '..');
/** La racine du projet (au-dessus de `backend`) — `SB Auto 06`. */
export const REPO = path.resolve(BACKEND, '..');

/**
 * OÙ VIT UN FICHIER — le vocabulaire du rapport, et rien de plus.
 *
 * La zone ne décide RIEN : un module de `node_modules` provoque le même
 * redémarrage qu'un module de `src`. Elle sert à lire un rapport, à décider
 * s'il faut hacher, et à ne pas noyer l'exploitant.
 */
export const ZONES = Object.freeze({
  BACKEND_SRC: 'backend/src',
  BACKEND_ROOT: 'backend/*',
  REPO: 'repo/*',
  NODE_MODULES: 'node_modules',
  EXTERNAL: 'external',
});

/** Extensions qu'un graphe de modules peut porter. */
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs'];

/**
 * LES SPÉCIFICATEURS D'IMPORT, LUS SANS PARSEUR.
 *
 * Une expression régulière plutôt qu'un AST, et c'est un choix : ajouter un
 * analyseur syntaxique ferait entrer une dépendance dans le processus même
 * qu'on observe. Le prix est connu — un `import` cité dans un commentaire peut
 * être compté — et il est acceptable : une entrée EN TROP dans le graphe
 * produit au pire une surveillance inutile, jamais un faux coupable, puisque
 * le rapport n'accuse que les fichiers qui ont RÉELLEMENT changé.
 */
const SPECIFICATEUR = new RegExp(
  '(?:^|[^\\w.])(?:'
  + 'import\\s+(?:[\\s\\S]*?)\\s*from\\s*'   // import x from '…'
  + '|import\\s*'                             // import '…'
  + '|export\\s+(?:[\\s\\S]*?)\\s*from\\s*'   // export … from '…'
  + '|import\\s*\\(\\s*'                      // import('…')
  + '|require\\s*\\(\\s*'                     // require('…')
  + ')[\'"]([^\'"]+)[\'"]',
  'g',
);

/** Le chemin RÉEL, jonctions Windows résolues. Voir `realpathsComparés`. */
export function cheminReel(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

export function zoneDe(absolu) {
  const p = path.normalize(absolu);
  if (p.includes(`${path.sep}node_modules${path.sep}`)) return ZONES.NODE_MODULES;
  if (p.startsWith(SRC + path.sep)) return ZONES.BACKEND_SRC;
  if (p.startsWith(BACKEND + path.sep)) return ZONES.BACKEND_ROOT;
  if (p.startsWith(REPO + path.sep)) return ZONES.REPO;
  return ZONES.EXTERNAL;
}

/** Un chemin lisible dans un rapport, toujours relatif à la racine du projet. */
export function chemineRelatif(absolu) {
  const rel = path.relative(REPO, absolu);
  return (rel.startsWith('..') ? absolu : rel).replace(/\\/g, '/');
}

/* -------------------------------------------------------------------------- */
/*  S3 — LES IMPORTS DYNAMIQUES POSTÉRIEURS                                   */
/* -------------------------------------------------------------------------- */

/**
 * PLAFONNÉ, PARCE QU'UN OBSERVATEUR NE DOIT PAS FUIR.
 *
 * Un crochet qui accumule sans borne dans un process de développement qui vit
 * des heures finirait par peser plus que ce qu'il observe. Le graphe réel de ce
 * backend tient en quelques milliers d'entrées ; au-delà, on cesse d'ajouter et
 * on le DIT dans le rapport plutôt que de tronquer en silence.
 */
const PLAFOND_DYNAMIQUE = 5000;
const dynamiques = new Set();
let crochetPose = false;
let crochetDebordement = false;

/**
 * POSE le crochet de résolution — idempotent, et sans effet de bord.
 *
 * Le crochet APPELLE `next()` et rend son résultat inchangé : il observe la
 * résolution, il ne la modifie pas. Un crochet qui déciderait quoi que ce soit
 * changerait le graphe qu'il prétend mesurer.
 */
export function observerImportsDynamiques() {
  if (crochetPose) return { pose: true, deja: true };
  if (typeof nodeModule.registerHooks !== 'function') {
    return { pose: false, raison: 'registerHooks indisponible (Node < 22.15)' };
  }
  try {
    nodeModule.registerHooks({
      resolve(specificateur, contexte, suivant) {
        const resultat = suivant(specificateur, contexte);
        try {
          if (typeof resultat?.url === 'string' && resultat.url.startsWith('file:')) {
            if (dynamiques.size < PLAFOND_DYNAMIQUE) dynamiques.add(fileURLToPath(resultat.url));
            else crochetDebordement = true;
          }
        } catch { /* un observateur ne casse jamais une résolution */ }
        return resultat;
      },
    });
    crochetPose = true;
    return { pose: true };
  } catch (err) {
    return { pose: false, raison: err?.message ?? String(err) };
  }
}

/* -------------------------------------------------------------------------- */
/*  S1 — LA TRAVERSÉE STATIQUE                                                */
/* -------------------------------------------------------------------------- */

function resoudreRelatif(depuis, specificateur) {
  if (!specificateur.startsWith('.')) return null;
  const base = path.resolve(path.dirname(depuis), specificateur);
  for (const suffixe of EXTENSIONS) {
    const candidat = base + suffixe.replace('/', path.sep);
    try { if (fs.statSync(candidat).isFile()) return candidat; } catch { /* suivant */ }
  }
  return null;
}

/**
 * LE GRAPHE STATIQUE depuis un point d'entrée.
 *
 * On ne suit QUE les spécificateurs relatifs : un paquet `node_modules` a sa
 * propre résolution (exports, conditions, main), qu'on ne réimplémentera pas
 * ici — c'est exactement le rôle de S2, qui n'a pas à deviner puisqu'il lit ce
 * qui a été VRAIMENT chargé.
 */
export function grapheStatique(pointEntree, { plafond = 5000 } = {}) {
  const vus = new Set();
  const pile = [pointEntree];
  while (pile.length && vus.size < plafond) {
    const fichier = path.normalize(pile.pop());
    if (vus.has(fichier)) continue;
    vus.add(fichier);
    if (fichier.endsWith('.json')) continue;

    let code;
    try { code = fs.readFileSync(fichier, 'utf8'); } catch { continue; }
    for (const trouve of code.matchAll(SPECIFICATEUR)) {
      const cible = resoudreRelatif(fichier, trouve[1]);
      if (cible && !vus.has(path.normalize(cible))) pile.push(cible);
    }
  }
  return vus;
}

/** Le point d'entrée réel du process — `src/server.js` en exploitation. */
export function pointEntree() {
  const argv = process.argv[1];
  if (argv) {
    try { if (fs.statSync(argv).isFile()) return path.resolve(argv); } catch { /* repli */ }
  }
  return path.join(SRC, 'server.js');
}

/* -------------------------------------------------------------------------- */
/*  L'UNION                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * CONSTRUIT le graphe des fichiers LOCAUX chargés par ce process.
 *
 * Rend une `Map` chemin absolu → `{ realpath, zone, sources }`. `sources` nomme
 * les preuves : `static`, `cjs`, `dynamic`. Un fichier vu par plusieurs sources
 * les porte toutes — et un fichier vu par une seule reste dans le graphe : on
 * réunit, on ne recoupe pas. Exiger deux témoins reviendrait à ignorer
 * précisément l'angle mort qu'une seule source sait couvrir.
 */
export function construireGrapheCharge({ entree = pointEntree() } = {}) {
  const graphe = new Map();
  const ajouter = (absolu, source) => {
    if (!absolu || typeof absolu !== 'string') return;
    const p = path.normalize(absolu);
    // Les modules internes (`node:fs`) n'ont pas de fichier à surveiller.
    if (!path.isAbsolute(p)) return;
    const existant = graphe.get(p);
    if (existant) { existant.sources.add(source); return; }
    graphe.set(p, { realpath: cheminReel(p), zone: zoneDe(p), sources: new Set([source]) });
  };

  // S1 — la traversée statique.
  let statiques = 0;
  try {
    for (const f of grapheStatique(entree)) { ajouter(f, 'static'); statiques += 1; }
  } catch { /* une source qui échoue en laisse deux autres */ }

  // S2 — le cache CommonJS : l'angle mort de la V1.
  let cjs = 0;
  try {
    const require_ = createRequire(import.meta.url);
    for (const cle of Object.keys(require_.cache)) { ajouter(cle, 'cjs'); cjs += 1; }
  } catch { /* idem */ }

  // S3 — les imports dynamiques observés depuis la pose du crochet.
  for (const f of dynamiques) ajouter(f, 'dynamic');

  const parZone = {};
  for (const info of graphe.values()) parZone[info.zone] = (parZone[info.zone] ?? 0) + 1;

  return {
    graphe,
    stats: {
      total: graphe.size,
      parZone,
      sources: { statiques, cjs, dynamiques: dynamiques.size },
      crochetPose,
      crochetDebordement,
      entree: chemineRelatif(entree),
    },
  };
}

/**
 * LES RACINES À SURVEILLER — peu nombreuses, et calculées, jamais devinées.
 *
 * ══ POURQUOI DES RACINES ET NON UN VEILLEUR PAR FICHIER ═════════════════════
 *
 * Le graphe compte plus d'un millier de fichiers. Un `fs.watch` par fichier,
 * c'est un millier de descripteurs — sur un poste de développement, c'est le
 * genre de coût qui finit par faire désactiver le diagnostic.
 *
 * On surveille donc RÉCURSIVEMENT un petit nombre de dossiers englobants, et
 * l'on FILTRE chaque événement par appartenance au graphe. C'est exactement ce
 * que fait le surveillant de Node lui-même — mesuré : un fichier non importé
 * sous `src` ne provoque aucun redémarrage, donc Node filtre lui aussi.
 *
 * ── LE FILTRE EST CE QUI ÉVITE LES FAUX COUPABLES ──────────────────────────
 *
 * Sans lui, `backend/logs/` (que ce module écrit lui-même) et les 182 fichiers
 * de `src` hors graphe entreraient dans le rapport. Un diagnostic qui accuse un
 * fichier inerte est pire qu'un diagnostic muet : on corrige le mauvais endroit.
 */
export function racinesDeSurveillance(graphe) {
  const racines = new Set();
  const modulesNode = new Set();

  for (const [absolu, info] of graphe) {
    const reel = info.realpath;
    if (info.zone === ZONES.NODE_MODULES) {
      /**
       * UNE SEULE RACINE PAR ARBRE `node_modules`, RÉCURSIVE.
       *
       * 879 fichiers y sont chargés, répartis dans 123 paquets. Poser une
       * racine par paquet donnerait 123 veilleurs pour la même information
       * qu'un seul — et n'en couvrirait aucun de plus.
       */
      const marque = `${path.sep}node_modules${path.sep}`;
      const i = reel.indexOf(marque);
      if (i > 0) modulesNode.add(reel.slice(0, i + marque.length - 1));
      continue;
    }
    /**
     * ON SURVEILLE LE CHEMIN RÉEL, PAS LE CHEMIN LOGIQUE.
     *
     * Mesuré : derrière une jonction Windows, Node résout le module à son
     * chemin RÉEL et redémarre quand la CIBLE change. Une surveillance
     * récursive de `backend/src` ne traverse pas la jonction — elle ne verrait
     * donc jamais l'écriture qui a pourtant relancé le service.
     */
    racines.add(path.dirname(reel));
  }

  // Effondrement : un dossier couvert par un ancêtre déjà surveillé est retiré.
  const triees = [...racines].sort((a, b) => a.length - b.length);
  const minimales = [];
  for (const r of triees) {
    if (!minimales.some((m) => r === m || r.startsWith(m + path.sep))) minimales.push(r);
  }

  /**
   * PAS DEUX VEILLEURS SUR LE MÊME ARBRE.
   *
   * Si une racine de projet englobe déjà un `node_modules` (cas d'un point
   * d'entrée posé à la racine du backend), la racine dédiée ferait doublon :
   * chaque écriture arriverait deux fois, et le rapport compterait deux
   * événements là où il ne s'en est produit qu'un.
   */
  const couvert = (p) => minimales.some((m) => p === m || p.startsWith(m + path.sep));
  const modulesRetenus = [...modulesNode].filter((m) => !couvert(m));

  return {
    projet: minimales,
    modulesNode: modulesRetenus,
    modulesNodeCouverts: [...modulesNode].filter(couvert),
    toutes: [...minimales, ...modulesRetenus],
  };
}

export default {
  BACKEND, REPO, SRC, ZONES,
  cheminReel, chemineRelatif, construireGrapheCharge, grapheStatique,
  observerImportsDynamiques, pointEntree, racinesDeSurveillance, zoneDe,
};
