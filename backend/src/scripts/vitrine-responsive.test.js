/**
 * VITRINE MOBILE ET MOUVEMENT — le formulaire, la scène 3D, les surfaces qui
 * s'inclinent, et le tiroir de navigation.
 *
 * ══ CE QUE CE FICHIER GARDE DU MOTEUR D'ORIGINE ═════════════════════════════
 *
 * La section A — le formulaire de contact — est reprise telle quelle. Elle
 * couvre trois défauts réels et toujours possibles : des champs sous 16 px qui
 * font ZOOMER iOS Safari sans jamais dézoomer, des cibles tactiles trop
 * petites, et un `<select>` dont la plus longue option élargit le document
 * entier parce que la colonne refuse de rétrécir.
 *
 * ══ CE QUI LA REMPLACE, ET POURQUOI ═════════════════════════════════════════
 *
 * Les sections « carrousel » et « avant/après » visaient deux composants qui
 * n'existent plus : ce site n'a ni rail de cartes ni comparateur de photos.
 * Les supprimer sans rien mettre à la place aurait laissé sans garde ce que ce
 * site a de plus risqué à leur place — LE MOUVEMENT.
 *
 * L'accueil porte une scène en trois dimensions, des surfaces qui s'inclinent
 * sous le pointeur et plusieurs animations liées au défilement. Rien de tout
 * cela ne se voit à la relecture d'une capture d'écran, et tout cela peut
 * rendre le site pénible — voire nauséeux — pour quelqu'un qui a demandé moins
 * de mouvement à son système. `prefers-reduced-motion` n'est donc pas une
 * option de confort : c'est une garde, et elle se vérifie.
 *
 * Ces contrôles lisent la SOURCE : il n'y a pas de DOM ici, et la seule chose
 * qui compte est la présence — ou l'absence — des mécanismes en cause.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

/**
 * Le code RENDU, sans les commentaires.
 *
 * Ceux-ci citent volontiers le mécanisme supprimé — c'est même leur rôle : ils
 * expliquent ce qui n'existe plus et pourquoi. Les lire ferait échouer un
 * contrôle d'absence sur un fichier pourtant correct.
 */
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const formulaire = await lire('vitrine/src/components/ContactForm.tsx');
const hero = await lire('vitrine/src/components/HeroBanner.tsx');
const maquette = await lire('vitrine/src/components/DeviceShowcase.tsx');
const tilt = await lire('vitrine/src/components/TiltCard.tsx');
const navbar = await lire('vitrine/src/components/layout/Navbar.tsx');
const accueil = await lire('vitrine/src/pages/HomePage.tsx');
const chapitre = await lire('vitrine/src/pages/ChapterPage.tsx');

/* ────────────────────────────────────────────────────────────────────────── */
section('A. Formulaire de contact — utilisable à 320 px, sans zoom parasite');
{
  check('les champs font 16 px sur mobile (aucun zoom iOS)',
    /text-base sm:text-sm/.test(formulaire));
  check('…et la cible tactile est garantie', /min-h-\[44px\]/.test(formulaire));
  check('le bouton d’envoi tient 48 px', /min-h-\[48px\][\s\S]{0,120}w-full/.test(formulaire));

  // Un champ hors écran ne doit jamais élargir le document.
  check('le honeypot ne peut plus créer de défilement horizontal',
    !/left-\[-9999px\]/.test(sansCommentaires(formulaire))
    && /clipPath: 'inset\(50%\)'/.test(formulaire));

  check('le textarea ne dépasse jamais sa carte', /max-w-full resize-y/.test(formulaire));

  check('deux colonnes seulement à partir de 640 px', /grid gap-4 sm:grid-cols-2/.test(formulaire));
  check('clavier e-mail sur mobile', /inputMode="email"/.test(formulaire));
  check('pavé numérique pour le téléphone', /inputMode="tel"/.test(formulaire));

  /**
   * `w-full` fixe la largeur souhaitée ; `min-w-0` supprime le minimum
   * intrinsèque — celui de la plus longue option d'un `<select>`, qui
   * empêchait la colonne de rétrécir et poussait la page horizontalement.
   * Sans le second, le premier ne suffit pas.
   */
  const classesChamp = formulaire.match(/const fieldStyle\s*=([\s\S]*?);\n/)?.[1] ?? '';
  check('les champs occupent toute la largeur', /\bw-full\b/.test(classesChamp));
  check('…et peuvent rétrécir sous leur largeur intrinsèque (min-w-0)',
    /\bmin-w-0\b/.test(classesChamp));
  check('…les deux sur le MÊME style de champ, pas dispersés dans le fichier',
    classesChamp.length > 0);
  check('les erreurs restent liées à leur champ', /aria-describedby=\{invalid\('name'\)/.test(formulaire));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('A bis. Le formulaire demande ce que le plan de site exige');
{
  check('l’entreprise est un CHAMP, pas une ligne du message',
    /name="companyName"/.test(formulaire));
  check('…et l’activité aussi', /name="activity"/.test(formulaire));
  check('l’entreprise est renseignée par autocomplétion',
    /autoComplete="organization"/.test(formulaire));
  check('les deux nouveaux champs portent leur erreur',
    /contact-company-error/.test(formulaire) && /contact-activity-error/.test(formulaire));
  /**
   * LE MOT « DEVIS » EST BANNI DE CETTE PAGE, et c'est une décision du plan de
   * site plutôt qu'une préférence de rédaction : « Présenter mon projet »
   * plutôt que « Demander un devis ». Un libellé se réécrit vite et se réécrit
   * mal ; on le verrouille là où il compte.
   */
  const contactPage = sansCommentaires(await lire('vitrine/src/pages/ContactPage.tsx'));
  check('aucun « devis » dans la page de présentation de projet',
    !/devis/i.test(contactPage));
  /**
   * Sur le CODE RENDU, comme partout ici : le commentaire de tête de la page
   * NOMME la carte du moteur d'origine pour expliquer pourquoi elle n'y est
   * plus. Le lire ferait échouer un contrôle d'absence sur un fichier
   * précisément correct.
   */
  check('…et aucune carte tierce n’y est chargée',
    !/google\.com\/maps/i.test(contactPage) && !/<iframe/.test(contactPage));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('B. La maquette d’appareils — la démonstration, pas la métaphore');
{
  /**
   * ══ CE QUE CETTE SECTION ÉPROUVAIT AVANT ══════════════════════════════════
   *
   * Une scène en trois dimensions : un monolithe en fil de fer tournant sur
   * une grille en perspective, incliné par le pointeur. Elle a été REMPLACÉE
   * par un écran d'ordinateur et un téléphone montrant un faux site
   * responsive — parce qu'un prospect qui se demande « ces gens peuvent-ils me
   * faire un site » regardait un cube et devait traduire.
   *
   * Les assertions du pointeur (`requestAnimationFrame`, écouteur passif,
   * frame annulée au démontage) sont tombées avec la parallaxe qu'elles
   * gardaient. Ce n'est pas une régression de couverture : il n'y a plus
   * d'écouteur de pointeur à surveiller. Ce qui reste — et qui compte encore —
   * est vérifié ci-dessous.
   */
  check('la maquette est en CSS pur, sans bibliothèque 3D ni canvas',
    !/three|@react-three|<canvas/.test(maquette));

  // LA garde : un mouvement continu doit pouvoir être coupé.
  check('les animations respectent prefers-reduced-motion',
    /@media \(prefers-reduced-motion: reduce\)/.test(maquette)
    && /animation: none;/.test(maquette));
  check('l’aperçu du Manager peut les figer', /animate = true/.test(maquette));
  check('…et la bannière transmet ce choix à la maquette',
    /animate=\{animate\}/.test(hero));

  /**
   * L'ÉCHELLE SUIT LE CONTENEUR, PAS LA FENÊTRE.
   *
   * Une taille en `vw` aurait suivi la FENÊTRE : dans l'aperçu étroit du
   * Manager — une colonne de 700 px dans une fenêtre de 1900 — la maquette
   * aurait débordé de son cadre. Les unités de conteneur règlent le cas, et
   * le repli en `vw` reste déclaré AVANT pour les moteurs qui les ignorent.
   */
  check('l’échelle est en unités de CONTENEUR', /cqw/.test(maquette));
  check('…déclarée derrière un @supports', /@supports \(container-type: inline-size\)/.test(maquette));
  check('…et précédée d’un repli en vw', /clamp\([^)]*vw/.test(maquette));

  /**
   * LE CONTENU DU FAUX SITE EST UN ARGUMENT DE VENTE — donc éditable.
   *
   * Selon qu'on démarche des restaurateurs ou des artisans, la maquette doit
   * dire « Réserver une table » ou « Demander un devis ». Un libellé écrit ici
   * demanderait un déploiement pour changer de cible commerciale.
   */
  const maquetteNue = sansCommentaires(maquette);
  check('le contenu du faux site entre par les props',
    /content: ShowcaseContent/.test(maquetteNue));
  check('…et la bannière le lui passe depuis les données',
    /showcase\?\? \{\}|showcase \?\? \{\}/.test(sansCommentaires(hero)));
  check('la maquette est invisible aux lecteurs d’écran là où elle est décorative',
    /aria-hidden="true"/.test(maquette));

  /**
   * LES DEUX COMPOSANTS SONT PARTAGÉS AVEC LE MANAGER — mêmes trois règles.
   * L'alias `@/` désigne un dossier différent selon qui compile, et les noms
   * de couleur Tailwind sont câblés sur `--m-*` d'un côté, `--v-*` de l'autre.
   */
  for (const [nom, src] of [['la bannière', hero], ['la maquette', maquette]]) {
    const nu = sansCommentaires(src);
    check(`${nom} : aucun import en \`@/…\` (l’alias diffère selon l’application)`,
      !/from '@\//.test(nu));
    check(`${nom} : aucune couleur Tailwind (les jetons diffèrent selon l’application)`,
      !/(bg|text|border)-(background|foreground|primary|accent|muted)\b/.test(nu));
  }
  check('les couleurs passent par les jetons `--v-*`',
    /var\(--v-background\)/.test(hero) && /var\(--v-accent\)/.test(maquette));

  /**
   * ── LA BANNIÈRE NE PEUT PAS RENDRE UN `<Link>` ELLE-MÊME ─────────────────
   *
   * `react-router-dom` est présent dans les deux applications, mais leurs
   * ROUTEURS ne le sont pas : un `<Link>` rendu dans le Manager, hors de son
   * routeur, lève. La bannière reçoit donc un rendu de lien, et l'aperçu passe
   * le rendu inerte.
   */
  // Sur le code NU : le commentaire du composant nomme `react-router-dom`
  // pour expliquer pourquoi il ne l'importe pas — ce qui ferait échouer un
  // contrôle d'absence sur un fichier pourtant correct.
  check('la bannière n’importe pas react-router', !/react-router/.test(sansCommentaires(hero)));
  check('…elle reçoit un rendu de lien', /renderLink/.test(hero));
  check('…et la vitrine lui passe un vrai `<Link>`', /renderLink=\{/.test(accueil));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('C. Les surfaces qui s’inclinent — jamais au doigt, jamais en sourdine');
{
  check('l’inclinaison est désactivée au tactile',
    /matchMedia\('\(pointer: fine\)'\)\.matches/.test(tilt));
  check('…et quand moins de mouvement est demandé',
    /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(tilt));
  check('le suivi passe par requestAnimationFrame', /requestAnimationFrame/.test(tilt));
  check('…et écrit des variables CSS, jamais un état par pixel',
    /style\.setProperty\('--tilt-/.test(tilt));
  check('la carte se remet à plat quand le pointeur sort', /onPointerLeave=\{reset\}/.test(tilt));
  check('la frame en attente est annulée au démontage', /cancelAnimationFrame/.test(tilt));
  check('l’amplitude reste sous le seuil de déformation',
    /amplitude = 6/.test(tilt));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('D. Les animations de défilement s’effacent elles aussi');
{
  check('l’accueil consulte prefers-reduced-motion', /useReducedMotion/.test(accueil));
  check('…et le chapitre aussi', /useReducedMotion/.test(chapitre));
  check('la parallaxe de l’image de tête est conditionnelle',
    /sobre \? \{ opacity: 0\.18 \} :/.test(chapitre));
  check('le trait des étapes ne se trace pas en mode sobre',
    /sobre\s*\n?\s*\?\s*\{ background: 'var\(--v-accent\)' \}/.test(chapitre));
  check('la dérive latérale des principes est conditionnelle',
    /style=\{sobre \? undefined : \{ x \}\}/.test(accueil));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('E. Le tiroir de navigation — hors de l’en-tête, et refermé à temps');
{
  /**
   * L'en-tête porte `backdrop-filter` : tout descendant devient membre de son
   * contexte de composition, et un `position: fixed` posé dedans se cadre sur
   * L'EN-TÊTE au lieu de la fenêtre. Le tiroir occupait alors la hauteur de la
   * barre. `createPortal` le monte à la racine, où `fixed` veut dire ce qu'il
   * dit.
   */
  check('le tiroir est monté dans un portail', /createPortal\(/.test(navbar));
  check('…à la racine du document', /document\.body,/.test(navbar));
  check('une navigation le referme', /setTiroir\(false\), \[location\.pathname\]/.test(navbar));
  check('le défilement de la page est verrouillé pendant l’ouverture',
    /useScrollLock\(tiroir\)/.test(navbar));
  check('la cible d’ouverture porte un nom accessible',
    /aria-label="Ouvrir le menu"/.test(navbar));
  check('…et celle de fermeture aussi', /aria-label="Fermer le menu"/.test(navbar));

  /**
   * LA BARRE NE CHANGE PAS DE HAUTEUR AU DÉFILEMENT. Une barre qui se rétracte
   * fait sauter tout ce qu'elle surplombe au premier pixel défilé, et ce saut
   * se rejoue à chaque remontée. Seul le fond varie.
   */
  check('la hauteur de la barre est constante', /h-20/.test(navbar));
  check('…seuls le fond et la bordure changent',
    /transition-\[background-color,border-color\]/.test(navbar));
  check('les entrées viennent des données, pas d’une liste écrite ici',
    /data\?\.chapters/.test(navbar) && /data\?\.pages/.test(navbar));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('F. Le récit a une FIN — le dernier chapitre ne renvoie pas au premier');
{
  /**
   * LE DÉFAUT QUE CETTE GARDE FERME.
   *
   * « Chapitre suivant » se calculait avec un modulo : arrivé au dernier
   * chapitre, il renvoyait au PREMIER. Une progression devenait un carrousel,
   * et le bloc annonçait comme une suite ce qui était un retour en arrière.
   *
   * Le modulo est la façon naturelle d'écrire ce calcul — c'est bien pour cela
   * qu'il faut le refuser explicitement : quelqu'un le réintroduira en
   * cherchant à « boucler proprement ».
   */
  const chapitreNu = sansCommentaires(chapitre);
  check('aucun modulo sur la liste des chapitres',
    !/%\s*tous\.length/.test(chapitreNu));
  check('le dernier chapitre n’a pas de suivant',
    /index \+ 1 < tous\.length/.test(chapitreNu));
  check('…et le bloc n’est rendu que s’il y en a un',
    chapitreNu.includes('{suivant && ('));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('G. Aucune animation ne se déclenche sur une boîte que l’animation vide');
{
  /**
   * LE DÉFAUT QUE CETTE GARDE FERME, ET IL NE SE VOYAIT QUE SUR PETIT ÉCRAN.
   *
   * Les trois mots barrés du positionnement ne l'étaient plus en dessous de
   * 1280 px. La barre portait son propre `whileInView`, et son état de départ
   * — `scaleX(0)` — réduisait sa boîte à 0 × 1 pixel. Aucun navigateur ne
   * signale l'intersection d'un élément d'aire nulle : l'observateur se
   * taisait, l'animation ne partait pas, la boîte restait nulle.
   *
   * Le seuil de 1280 px n'était l'écho d'aucun point de rupture : c'était une
   * COURSE au montage, entre la première mesure de l'observateur et
   * l'application de l'état initial, qui tournait favorablement quand la page
   * était large. Un développeur sur grand écran ne pouvait pas le voir.
   *
   * On vérifie donc que la barre ne déclare NI observateur NI état propre, et
   * qu'elle passe par les variantes héritées du `li` — le seul des deux qui
   * garde une aire réelle en toutes circonstances.
   */
  const accueilNu = sansCommentaires(accueil);
  const barre = accueilNu.slice(accueilNu.indexOf('const BARRE'));
  const spanBarre = accueilNu.slice(
    accueilNu.indexOf('<motion.span'),
    accueilNu.indexOf('/>', accueilNu.indexOf('<motion.span'))
  );

  check('la barre n’observe plus le défilement elle-même',
    !/whileInView/.test(spanBarre) && !/viewport=/.test(spanBarre));
  check('…et ne fixe plus d’état de départ qui viderait sa boîte',
    !/initial=/.test(spanBarre) && !/scaleX:\s*0/.test(spanBarre));
  check('elle hérite de variantes nommées', /variants=\{BARRE\}/.test(spanBarre));
  check('les variantes de la barre existent, avec les deux états',
    /cache:\s*\{\s*scaleX:\s*0/.test(barre) && /visible:\s*\{\s*scaleX:\s*1/.test(barre));
  check('c’est le mot — jamais la barre — qui déclenche',
    /variants=\{MOT\}[\s\S]{0,220}?whileInView/.test(accueilNu));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
