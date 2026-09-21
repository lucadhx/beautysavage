/* Tests STRUCTURELS de l'architecture de défilement du manager.
 *
 * Ils ne rendent rien : ils lisent les sources et vérifient les invariants qui
 * ont coûté cher à établir. Un défilement cassé sur mobile ne se voit pas dans
 * un test unitaire de logique métier — il se voit dans une combinaison de
 * classes CSS. Ces règles la figent.
 *
 * L'INVARIANT CENTRAL : le document est le SEUL propriétaire du défilement
 * vertical du manager. Tout autre conteneur vertical défilant est local,
 * volontaire, et contenu (`overscroll-contain`).
 *
 * Runner autonome. Lancement : npm run test */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const SRC = fileURLToPath(new URL('..', import.meta.url));

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

const lire = (p) => readFileSync(join(SRC, p), 'utf8');

/**
 * Blanchit les commentaires en préservant les sauts de ligne.
 *
 * Sans ça, une explication qui CITE le motif interdit (« l'ancien layout portait
 * `overflow-hidden` ») ferait échouer la règle qu'elle documente : le test
 * interdirait d'expliquer ce qu'on a corrigé.
 */
function codeSeul(texte) {
  const garderLignes = (m) => m.replace(/[^\n]/g, ' ');
  return texte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, garderLignes)
    .replace(/\/\*[\s\S]*?\*\//g, garderLignes)
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, avant) => avant + ' '.repeat(m.length - avant.length));
}

/** Toutes les sources du manager, chemins relatifs à `src/`. */
function sources() {
  const out = [];
  const marcher = (dir) => {
    for (const nom of readdirSync(dir)) {
      const p = join(dir, nom);
      if (statSync(p).isDirectory()) marcher(p);
      else if (/\.tsx?$/.test(nom)) out.push(relative(SRC, p).split(sep).join('/'));
    }
  };
  marcher(SRC);
  return out;
}
const FICHIERS = sources();

/** Lignes de CODE d'un fichier (commentaires blanchis), avec leur numéro. */
const lignes = (p) => codeSeul(lire(p)).split('\n').map((texte, i) => ({ n: i + 1, texte }));

/** Toutes les lignes du manager qui satisfont un motif. */
function partout(motif, filtre = () => true) {
  const trouves = [];
  for (const f of FICHIERS.filter(filtre)) {
    for (const l of lignes(f)) if (motif.test(l.texte)) trouves.push(`${f}:${l.n}`);
  }
  return trouves;
}

// ═══════════════════════════════════════════════════════════════════════════
section('Socle CSS — hauteur de viewport');
// ═══════════════════════════════════════════════════════════════════════════
{
  const css = lire('index.css');

  check(
    'html/body/#root ne sont plus verrouillés à `height: 100%`',
    !/html,\s*\n?\s*body,\s*\n?\s*#root\s*\{[^}]*height:\s*100%/.test(css),
    'un `#root` haut d’un viewport COURANT sous un layout haut de 100vh (viewport LARGE) '
      + 'donne au document un défilement résiduel : le double défilement mobile.'
  );

  check('la variable de viewport est déclarée', /--m-viewport-h:\s*100vh/.test(css));
  check(
    '`100dvh` sous @supports, avec `100vh` en repli',
    /@supports \(height: 100dvh\)[\s\S]*--m-viewport-h:\s*100dvh/.test(css)
  );
  check('body suit la hauteur du viewport visible', /body\s*\{[^}]*min-height:\s*var\(--m-viewport-h\)/.test(css));
  check('#root suit la hauteur du viewport visible', /#root\s*\{[^}]*min-height:\s*var\(--m-viewport-h\)/.test(css));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Un seul propriétaire du défilement');
// ═══════════════════════════════════════════════════════════════════════════
{
  const code = codeSeul(lire('components/layout/AppLayout.tsx'));

  check(
    'le layout ne se verrouille plus à `h-screen`',
    !/\bh-screen\b/.test(code),
    '`100vh` = viewport barre d’adresse rétractée : le layout dépasse l’écran visible.'
  );
  check(
    'le layout mesure `min-h-[var(--m-viewport-h)]`',
    /min-h-\[var\(--m-viewport-h\)\]/.test(code)
  );
  check(
    'aucun `overflow-hidden` sur les conteneurs du layout',
    !/\boverflow-hidden\b/.test(code),
    'un ancêtre `overflow: hidden` annule tout `position: sticky` en dessous.'
  );
  check(
    'AUCUN conteneur défilant vertical dans le layout — le document défile',
    !/\boverflow-(?:y-)?(?:auto|scroll)\b/.test(code),
    'le <main> en `overflow-y-auto` était le second propriétaire du défilement.'
  );
  check(
    'la colonne principale porte `min-w-0` (pas de débordement horizontal global)',
    /\bmin-w-0\b/.test(code)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section('Barre du haut collante');
// ═══════════════════════════════════════════════════════════════════════════
{
  const layout = lire('components/layout/AppLayout.tsx');

  check('la barre du haut vit dans un <header>', /<header\b/.test(layout));
  check(
    '<header> est `sticky top-0`',
    /<header[^>]*className="[^"]*\bsticky\b[^"]*\btop-0\b/.test(layout)
  );
  check(
    '<header> porte un fond opaque (sinon le contenu défile par transparence)',
    /<header[^>]*className="[^"]*\bbg-background\b/.test(layout)
  );
  check(
    '<header> se place sous le tiroir (z-40) et les modales (z-50)',
    /<header[^>]*className="[^"]*\bz-30\b/.test(layout)
  );
  check(
    'le bandeau de suspension est DANS le bloc collant',
    /<header[\s\S]*<SuspensionBanner\s*\/>[\s\S]*<\/header>/.test(layout),
    'sinon il défile hors de vue sur desktop, où il restait visible en permanence.'
  );
  check(
    'la sidebar desktop est épinglée par `sticky`, pas par un ancêtre défilant',
    /sticky top-0 h-\[var\(--m-viewport-h\)\]/.test(layout)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section('Verrou de défilement — aucun fantôme possible');
// ═══════════════════════════════════════════════════════════════════════════
{
  const fautifs = partout(
    /document\.body\.style\.(overflow|position)/,
    (f) => f !== 'lib/scrollLock.ts'
  );
  check(
    'un SEUL module touche au défilement du body',
    fautifs.length === 0,
    fautifs.join(', ')
  );

  const layout = lire('components/layout/AppLayout.tsx');
  check('le tiroir mobile verrouille le défilement', /useScrollLock\(mobileOpen\)/.test(layout));
  check(
    'le tiroir se referme à tout changement de route',
    /setMobileOpen\(false\);?\s*\n\s*\},\s*\[pathname\]\)/.test(layout),
    'sinon un retour navigateur laisse le tiroir ouvert ET le verrou posé.'
  );

  check('les modales partagées utilisent le verrou partagé', /useScrollLock\(open\)/.test(lire('components/ui/dialog.tsx')));

  // Toute surface `fixed inset-0` de premier plan doit geler la page derrière.
  const surfaces = [
    'components/ui/dialog.tsx',
    'pages/dev/deployment/ReportModal.tsx',
    'pages/dev/deployment/RemovalDialog.tsx',
  ];
  for (const f of surfaces) {
    check(`${f} pose un verrou`, /useScrollLock\(/.test(lire(f)));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('Défilements imbriqués — locaux, volontaires, contenus');
// ═══════════════════════════════════════════════════════════════════════════
{
  /*
    Chaque conteneur vertical défilant restant est un défilement LOCAL assumé
    (navigation de la sidebar, corps de modale, liste bornée). Il doit porter
    `overscroll-contain` : sans lui, arriver en butée rend la main au document
    et le geste « saute » d'un conteneur à l'autre — exactement la sensation de
    défilement capturé qu'on a supprimée.
  */
  const sansContainment = [];
  for (const f of FICHIERS) {
    for (const l of lignes(f)) {
      if (!/\boverflow-(?:y-)?(?:auto|scroll)\b/.test(l.texte)) continue;
      if (/\boverscroll-contain\b/.test(l.texte)) continue;
      sansContainment.push(`${f}:${l.n}`);
    }
  }
  check(
    'tout défilement vertical imbriqué porte `overscroll-contain`',
    sansContainment.length === 0,
    sansContainment.join(', ')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section('Viewport mobile — plus aucune hypothèse `100vh`');
// ═══════════════════════════════════════════════════════════════════════════
{
  const vh = partout(/\b(?:min-h|max-h|h)-screen\b|\[\d+(?:\.\d+)?vh\]|:\s*\d+vh\b/);
  check(
    'aucune hauteur en `vh` brut dans les sources',
    vh.length === 0,
    `${vh.join(', ')} — utiliser var(--m-viewport-h), qui vaut 100dvh quand il existe.`
  );

  const vw = partout(/\bw-screen\b|\[\d+(?:\.\d+)?vw\]/);
  check(
    'aucune largeur en `vw` (source classique de débordement horizontal)',
    vw.length === 0,
    vw.join(', ')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
section('Gestes tactiles — rien ne doit être absorbé');
// ═══════════════════════════════════════════════════════════════════════════
{
  /*
    `touch-none` retire au navigateur TOUT défilement au-dessus de l'élément.
    C'est acceptable UNIQUEMENT sur une poignée de manipulation directe, dont
    la surface est petite et le déplacement bidirectionnel — jamais sur une
    surface de contenu, où il transforme le geste de l'utilisateur en clic mort.

    Seule exception admise, et elle est motivée dans le fichier : les zones de
    signature posées sur l'aperçu PDF. Elles se déplacent au doigt dans les deux
    axes ; leur frame parente est en `touch-pan-y`, donc la page reste défilable
    partout ailleurs sur l'aperçu.
  */
  const EXCEPTIONS_TACTILES = ['components/contracts/SignatureZoneEditor.tsx'];
  const bloquants = partout(
    /\btouch-none\b/,
    (f) => !EXCEPTIONS_TACTILES.includes(f)
  );
  check(
    'aucun `touch-action: none` sur une surface de contenu',
    bloquants.length === 0,
    `${bloquants.join(', ')} — un comparateur ou un aperçu doit utiliser \`touch-pan-y\`.`
  );

  /*
    LE COMPARATEUR AVANT/APRÈS N'EXISTE PAS DANS TOUS LES PROJETS.

    Il vient du moteur d'origine ; un projet qui ne vend pas une prestation
    « avant/après » ne l'embarque pas. Le lire EN DUR faisait donc planter la
    recette entière (`ENOENT`, sortie 1 avant même le récapitulatif) sur ces
    projets-là — un test mort qui emportait avec lui toutes les règles suivantes
    du fichier, et surtout les vingt-six autres recettes enchaînées derrière lui
    par `npm test`. Un fichier absent n'est pas une régression de défilement.

    La règle, elle, reste universelle : un comparateur À POIGNÉE, s'il existe,
    ne doit jamais confisquer le défilement vertical de la page. On la vérifie
    quand le composant est là, et on dit qu'elle est sans objet sinon — plutôt
    que de la déclarer verte sans l'avoir contrôlée.
  */
  const COMPARATEUR = 'components/BeforeAfterSlider.tsx';
  if (FICHIERS.includes(COMPARATEUR)) {
    const slider = lire(COMPARATEUR);
    check('le comparateur laisse passer le défilement vertical', /\btouch-pan-y\b/.test(slider));
    check(
      'le comparateur relâche la poignée quand le navigateur prend le geste',
      /onPointerCancel=\{stop\}/.test(slider)
    );
  } else {
    console.log('  – comparateur avant/après absent de ce projet : règle sans objet');
  }

  const preventions = partout(/addEventListener\(\s*['"](?:touchmove|wheel)['"]/);
  check(
    'aucun écouteur global `touchmove`/`wheel` ne s’interpose',
    preventions.length === 0,
    preventions.join(', ')
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
