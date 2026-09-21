/* PARITÉ DES LIMITES — le Manager et le backend disent le MÊME nombre.
 *
 * ══ LE DÉFAUT QUE CETTE RECETTE FIGE ═══════════════════════════════════════
 *
 * Une même règle métier — « combien de chiffres clés sur l'accueil » — portait
 * trois valeurs différentes : quatre dans la graine, trois dans le validateur,
 * trois dans l'écran. Aucune n'était absurde ; c'est leur dispersion qui l'était.
 * Le propriétaire ouvrait un écran déjà invalide et l'apprenait au moment
 * d'enregistrer, dans un message anglais.
 *
 * Corriger les trois fichiers une fois n'empêche pas de recommencer. Cette
 * recette lit les DEUX sources et compare, nombre par nombre. Elle échoue si
 * l'une bouge sans l'autre — y compris si l'une gagne une clé que l'autre
 * ignore, ce qui est la façon dont la dérive commence réellement.
 *
 * ══ POURQUOI ELLE VIT DANS LE MANAGER ══════════════════════════════════════
 *
 * Parce que c'est le Manager qui porte le MIROIR. Le backend est l'autorité :
 * il n'a pas à savoir qu'une interface le recopie. La charge de rester aligné
 * revient à celui qui copie.
 *
 * Runner autonome. Lancement : npm run test */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as MIROIR from '@/config/limits';

const { KEY_FIGURE_LIMITS, HOME_CONTENT_LIMITS } = MIROIR;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

/* ══════════════════════════════════════════════════════════════════════════
   LIRE L'AUTORITÉ — sans l'importer
   ══════════════════════════════════════════════════════════════════════════

   `contentLimits.js` est un module du backend : l'importer depuis ici lierait
   la recette du Manager à la résolution de modules d'une autre application.
   On lit donc le FICHIER et on en évalue les deux littéraux, qui ne dépendent
   de rien (aucun import, aucun appel).                                        */

const AUTORITE = fileURLToPath(
  new URL('../../../backend/src/utils/contentLimits.js', import.meta.url),
);

const source = readFileSync(AUTORITE, 'utf8');

/** Extrait `export const NOM = Object.freeze({ … });` et l'évalue. */
function litteral(nom) {
  const debut = source.indexOf(`export const ${nom} = Object.freeze(`);
  if (debut < 0) throw new Error(`${nom} introuvable dans ${AUTORITE}`);
  const ouvrant = source.indexOf('(', debut);
  let profondeur = 0;
  for (let i = ouvrant; i < source.length; i += 1) {
    if (source[i] === '(') profondeur += 1;
    else if (source[i] === ')') {
      profondeur -= 1;
      if (profondeur === 0) {
        // eslint-disable-next-line no-eval
        return (0, eval)(`(${source.slice(ouvrant + 1, i)})`);
      }
    }
  }
  throw new Error(`littéral ${nom} non refermé`);
}

/** Aplatit un objet imbriqué en { 'a.b.c': 3 } — la comparaison porte sur les FEUILLES. */
function aplatir(objet, prefixe = '') {
  const out = {};
  for (const [cle, valeur] of Object.entries(objet)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (valeur && typeof valeur === 'object') Object.assign(out, aplatir(valeur, chemin));
    else out[chemin] = valeur;
  }
  return out;
}

function comparer(nom, cote, backend) {
  section(`${nom} — miroir du Manager vs autorité du backend`);
  const a = aplatir(cote);
  const b = aplatir(backend);
  const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  const manquantes = cles.filter((k) => !(k in a));
  const surnumeraires = cles.filter((k) => !(k in b));
  check(
    'aucune limite déclarée par le backend n’est absente du Manager',
    manquantes.length === 0,
    manquantes.join(', '),
  );
  check(
    'aucune limite du Manager n’est inconnue du backend',
    surnumeraires.length === 0,
    surnumeraires.join(', '),
  );

  const divergentes = cles.filter((k) => k in a && k in b && a[k] !== b[k]);
  check(
    'toutes les valeurs communes sont identiques',
    divergentes.length === 0,
    divergentes.map((k) => `${k}: manager=${a[k]} · backend=${b[k]}`).join('\n      '),
  );
}

/**
 * ON ÉNUMÈRE LES EXPORTS — on ne les nomme pas un par un.
 *
 * Une liste écrite à la main aurait le défaut de tout registre manuel : la
 * table ajoutée demain n'y serait pas, et la recette la déclarerait alignée
 * sans l'avoir regardée. Le contrôle porte donc sur l'ENSEMBLE des tables
 * `*_LIMITS`, des deux côtés — y compris sur leur existence même.
 */
const NOM_TABLE = /^[A-Z][A-Z0-9_]*_LIMITS$/;

/**
 * `MEDIA_LIMITS` a une AUTRE autorité — `services/media/mediaPolicy.js`, qui
 * s'exprime en octets. Elle est contrôlée plus bas, contre sa propre source.
 * La recopier dans `contentLimits.js` créerait un troisième registre, ce que
 * cette recette existe précisément pour empêcher.
 */
const AUTRE_AUTORITE = new Set(['MEDIA_LIMITS']);

const cotesManager = Object.keys(MIROIR)
  .filter((k) => NOM_TABLE.test(k) && !AUTRE_AUTORITE.has(k)).sort();
const cotesBackend = [...source.matchAll(/export const ([A-Z][A-Z0-9_]*_LIMITS)\b/g)]
  .map((m) => m[1]).sort();

section('Les deux côtés déclarent les MÊMES tables');
check(
  `aucune table du backend n’est absente du Manager (${cotesBackend.length} tables)`,
  cotesBackend.every((n) => cotesManager.includes(n)),
  cotesBackend.filter((n) => !cotesManager.includes(n)).join(', '),
);
check(
  'aucune table du Manager n’est inconnue du backend',
  cotesManager.every((n) => cotesBackend.includes(n)),
  cotesManager.filter((n) => !cotesBackend.includes(n)).join(', '),
);

for (const nom of cotesBackend.filter((n) => cotesManager.includes(n))) {
  comparer(nom, MIROIR[nom], litteral(nom));
}

/* ══════════════════════════════════════════════════════════════════════════
   LA RÈGLE MÉTIER TIENT AUSSI FACE À LA VITRINE
   ══════════════════════════════════════════════════════════════════════════

   Les cardinalités ne sont pas des préférences : ce sont des contraintes de
   RENDU. Si la vitrine change sa grille sans que les limites suivent, la
   correction d'aujourd'hui redevient le bug d'hier — une tuile publiée qui
   ne s'affiche nulle part, ou une grille trouée.                              */

section('Les cardinalités correspondent à ce que la vitrine dessine');

const VITRINE = fileURLToPath(new URL('../../../vitrine/src/', import.meta.url));
const lireVitrine = (p) => readFileSync(new URL(p, `file://${VITRINE.replace(/\\/g, '/')}`), 'utf8');

const accueil = lireVitrine('pages/HomePage.tsx');
const showcase = lireVitrine('components/DeviceShowcase.tsx');

/**
 * Le nombre MAXIMAL de colonnes que sait dessiner une section.
 *
 * On prend le maximum et non « la dernière classe rencontrée » : les bandes à
 * filet choisissent leurs colonnes selon le nombre d'éléments
 * (`COLONNES_BANDE`), et plusieurs valeurs cohabitent donc dans le fichier. Ce
 * qui doit correspondre à la limite, c'est le plafond.
 */
function colonnesMax(portee) {
  const m = /(?:sm|md|lg):grid-cols-(\d+)/g;
  let max = null;
  let x = m.exec(portee);
  while (x) { max = Math.max(max ?? 0, Number(x[1])); x = m.exec(portee); }
  return max;
}

/** Le corps d'une fonction de rendu, isolé pour ne pas mordre sur la suivante. */
function corps(nomFonction) {
  const i = accueil.indexOf(`function ${nomFonction}(`);
  if (i < 0) return '';
  const j = accueil.indexOf('\n}', i);
  return accueil.slice(i, j < 0 ? i + 4000 : j);
}

/*
  « Principes » et « Confiance » partagent `COLONNES_BANDE` : leur plafond se
  lit dans la table, pas dans leur corps.
*/
const bande = colonnesMax(accueil.slice(
  accueil.indexOf('const COLONNES_BANDE'),
  accueil.indexOf('function classesBande'),
));

check(
  `la bande à filet monte à ${KEY_FIGURE_LIMITS.maxItems} colonnes`,
  bande === KEY_FIGURE_LIMITS.maxItems,
  `grille=${bande} · limite=${KEY_FIGURE_LIMITS.maxItems}`,
);
check(
  `…et c’est aussi le plafond des engagements (${HOME_CONTENT_LIMITS.trust.items.maxItems})`,
  bande === HOME_CONTENT_LIMITS.trust.items.maxItems,
  `grille=${bande} · limite=${HOME_CONTENT_LIMITS.trust.items.maxItems}`,
);
check(
  `« Résultats » dessine ${HOME_CONTENT_LIMITS.outcomes.items.maxItems} colonnes`,
  colonnesMax(corps('Resultats')) === HOME_CONTENT_LIMITS.outcomes.items.maxItems,
  `grille=${colonnesMax(corps('Resultats'))} · limite=${HOME_CONTENT_LIMITS.outcomes.items.maxItems}`,
);
check(
  'les deux bandes à filet passent bien par la table de colonnes',
  /classesBande\(mots\.length\)/.test(accueil) && /classesBande\(items\.length\)/.test(accueil),
  'une section garde une grille figée : elle se trouera au premier compte impair.',
);

/*
  La maquette, elle, COUPE (`slice`). C'est justement pourquoi le serveur doit
  refuser : sans refus, la coupe reste silencieuse.
*/
/*
  ON PREND LE PLUS GRAND, PAS LE DERNIER.

  La maquette est dessinée DEUX fois — un ordinateur et un téléphone — et le
  téléphone n'affiche volontairement que deux tuiles là où l'ordinateur en
  montre trois. Lire « la dernière coupe rencontrée » faisait donc dépendre la
  recette de l'ORDRE des deux composants dans le fichier : une réorganisation
  sans conséquence la rendait rouge.

  Ce que la limite doit égaler, c'est le maximum : au-delà, une tuile ne
  s'affiche NULLE PART.
*/
const coupes = [...showcase.matchAll(/(navItems|cards)\s*\?\?\s*\[\]\)\.slice\(0,\s*(\d+)\)/g)]
  .reduce((acc, m) => ({ ...acc, [m[1]]: Math.max(acc[m[1]] ?? 0, Number(m[2])) }), {});

check(
  `le menu de la maquette est coupé à ${HOME_CONTENT_LIMITS.showcase.navItems.maxItems}`,
  coupes.navItems === HOME_CONTENT_LIMITS.showcase.navItems.maxItems,
  `slice=${coupes.navItems} · limite=${HOME_CONTENT_LIMITS.showcase.navItems.maxItems}`,
);
check(
  `les tuiles de la maquette sont coupées à ${HOME_CONTENT_LIMITS.showcase.cards.maxItems}`,
  coupes.cards === HOME_CONTENT_LIMITS.showcase.cards.maxItems,
  `slice=${coupes.cards} · limite=${HOME_CONTENT_LIMITS.showcase.cards.maxItems}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   LES LIMITES DE MÉDIAS ONT LEUR PROPRE AUTORITÉ
   ══════════════════════════════════════════════════════════════════════════

   `MEDIA_LIMITS` ne vit pas dans `contentLimits.js` : sa source est
   `services/media/mediaPolicy.js`, qui l'exprime en OCTETS. La recopier dans
   le registre de contenu créerait un troisième endroit où la même règle
   s'écrit — exactement ce que ce fichier existe pour empêcher.                */

section('MEDIA_LIMITS — miroir de la politique de médias du backend');

{
  const POLITIQUE = fileURLToPath(
    new URL('../../../backend/src/services/media/mediaPolicy.js', import.meta.url),
  );
  const src = readFileSync(POLITIQUE, 'utf8');

  /* `maxInputBytes: 12 * 1024 * 1024` — on lit le facteur, pas le produit. */
  const octets = {};
  const bloc = src.slice(src.indexOf('MEDIA_POLICIES'), src.indexOf('/** Repli'));
  const RX = /'?([\w-]+)'?\s*:\s*\{[^}]*maxInputBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/g;
  let m = RX.exec(bloc);
  while (m) { octets[m[1]] = Number(m[2]); m = RX.exec(bloc); }

  const defaut = /DEFAUT[\s\S]{0,200}?maxInputBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);

  const types = [...new Set([...Object.keys(octets), ...Object.keys(MIROIR.MEDIA_LIMITS)])].sort();
  const manquants = types.filter((t) => !(t in MIROIR.MEDIA_LIMITS));
  const inconnus = types.filter((t) => !(t in octets));
  const divergents = types.filter(
    (t) => t in octets && t in MIROIR.MEDIA_LIMITS && octets[t] !== MIROIR.MEDIA_LIMITS[t].maxMo,
  );

  check(
    `chaque type de média du backend est connu de l'écran (${types.length} types)`,
    manquants.length === 0,
    manquants.join(', '),
  );
  check('aucun type inventé côté écran', inconnus.length === 0, inconnus.join(', '));
  check(
    'les plafonds annoncés sont ceux que le serveur applique',
    divergents.length === 0,
    divergents
      .map((t) => `${t}: écran=${MIROIR.MEDIA_LIMITS[t].maxMo} Mo · backend=${octets[t]} Mo`)
      .join('\n      '),
  );
  check(
    "le repli de l'écran est celui du backend",
    defaut !== null && Number(defaut[1]) === MIROIR.MEDIA_DEFAULT_MAX_MO,
    `écran=${MIROIR.MEDIA_DEFAULT_MAX_MO} · backend=${defaut ? defaut[1] : '?'}`,
  );
}

console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
