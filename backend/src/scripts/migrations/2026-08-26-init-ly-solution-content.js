/**
 * INITIALISATION DU CONTENU — L.Y SOLUTION.
 *
 * ══ POURQUOI UNE MIGRATION, ET SURTOUT PAS UN AMORÇAGE ══════════════════════
 *
 * Ce projet ne sème RIEN au démarrage, et `promote.test.js` l'exige : un
 * backend qui réinjecte du contenu à chaque boot écrase le travail de son
 * administrateur, sans laisser de trace — le texte « réapparaît tout seul ».
 * L'INITIALISATION d'un projet neuf est un autre geste : elle a lieu une fois,
 * elle est demandée explicitement, et à partir de là le Manager fait autorité.
 *
 *     npm run init:ly                 (simulation — rien n'est écrit)
 *     npm run init:ly:apply           (écriture)
 *     … --assets "<dossier>"          source des visuels
 *     … --medias                      REPREND les visuels déjà en place
 *
 * ══ IDEMPOTENT, MAIS NON DESTRUCTIF ═════════════════════════════════════════
 *
 * Chaque chapitre est retrouvé par son SLUG. Un second passage ne crée donc
 * aucun doublon — et n'efface pas ce qu'un administrateur aurait ajouté à côté.
 * Les chapitres EXISTANTS ne sont pas réécrits : leur texte est celui qu'on a
 * relu dans le Manager, pas celui de ce fichier.
 *
 * ══ D'OÙ VIENT CE CONTENU ═══════════════════════════════════════════════════
 *
 * Du plan de site `LY_Solution_Plan_de_site.pdf` — cinq sections : ACCUEIL,
 * CONCEPTION, ARCHITECTURE, L'EXPÉRIENCE L.Y, PRÉSENTER UN PROJET. Les
 * intitulés, les mots-clés et les deux phrases entre guillemets en sont repris
 * MOT POUR MOT ; les textes d'accompagnement développent ce que le plan résume,
 * sans rien y ajouter qui ne s'y trouve.
 *
 * ══ CE QUE CE FICHIER N'ÉCRIT PAS ═══════════════════════════════════════════
 *
 * Aucune coordonnée. Le plan de site n'en publie aucune, et les inventer —
 * une adresse, un numéro — mettrait en ligne une information fausse sur la page
 * de contact d'une entreprise réelle. Elles se saisissent dans le Manager,
 * « Coordonnées », en une minute.
 *
 * Aucune donnée juridique non plus : SIREN, forme, adresse de facturation
 * viennent du Panel (fiche « Clients »), et les mentions légales en dérivent.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { Company } from '../../models/Company.model.js';
import { Theme } from '../../models/Theme.model.js';
import { Chapter } from '../../models/Chapter.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { MEDIA_CATALOG } from '../../utils/constants.js';
import { importProjectMedia } from '../../services/media/projectMedia.service.js';
import { policyFor } from '../../services/media/mediaPolicy.js';

const APPLY = process.argv.includes('--apply');
const FORCER_MEDIAS = process.argv.includes('--medias');
const argOf = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? null : process.argv[i + 1];
};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(argOf('assets') || path.join(HERE, '../../../../../projets/data/ly solution'));

const log = (...a) => console.log(...a);
const write = (...a) => console.log(APPLY ? '  ✎' : '  ·', ...a);

/* ══════════════════════════════════════════════════════════════════════════════
   1. IDENTITÉ — section « ACCUEIL » du plan de site.
   ══════════════════════════════════════════════════════════════════════════ */

const IDENTITE = {
  name: 'L.Y Solution',
  /**
   * L'ACCROCHE EST CELLE DU PLAN, mot pour mot, ponctuation comprise.
   *
   * « Une présence digitale qui n'appartient qu'à vous. » Elle sert de
   * sous-titre à la bannière ET de slogan dans le titre d'onglet ; la
   * reformuler à un seul des deux endroits ferait diverger le site de
   * lui-même.
   */
  tagline: 'Une présence digitale qui n’appartient qu’à vous.',
  /**
   * LE COMPTEUR DE CLIENTS RESTE À ZÉRO — et c'est le positionnement.
   *
   * Le plan de site refuse explicitement toute section « nos réalisations ».
   * Un compteur « 40+ clients satisfaits » est la même chose sous une autre
   * forme : une preuve par le volume, là où l'argument est la rareté.
   */
  satisfiedClients: 0,
  /**
   * Le texte de positionnement — « pas de modèle, pas de catalogue, pas de
   * déclinaison générique ». L'accueil le pose face aux trois mots barrés :
   * il n'a donc pas à les répéter, il a à dire ce qui vient à leur place.
   */
  homeIntro:
    'Nous ne partons pas d’un modèle que l’on habille à vos couleurs. Nous partons de votre '
    + 'entreprise, de son métier, de sa clientèle et de sa personnalité, et nous en tirons une '
    + 'présence qui ne ressemble à aucune autre. C’est plus long. C’est aussi ce qui vous rend '
    + 'reconnaissable par celui qui vous cherchait.',
  /**
   * LES QUATRE PRINCIPES — « identité, expérience, technologie, maîtrise ».
   *
   * Le plan les donne comme des MOTS-CLÉS, sans glose : « quelques mots-clés
   * seulement ». La glose posée ici tient en une ligne et reste éditable ;
   * l'accueil sait afficher un principe qui n'en a pas.
   */
  keyFigures: [
    { value: 'Identité', label: 'Ce qui vous distingue, avant ce qui vous ressemble.', icon: 'Fingerprint', order: 10 },
    { value: 'Expérience', label: 'Des parcours dessinés autour de vos usages réels.', icon: 'Compass', order: 20 },
    { value: 'Technologie', label: 'Une architecture tenue, sans dette laissée derrière.', icon: 'Cpu', order: 30 },
    { value: 'Maîtrise', label: 'Ce que nous concevons pour vous reste piloté par vous.', icon: 'KeyRound', order: 40 },
  ],
};

/**
 * LA PALETTE — noir, gris profond, blanc cassé.
 *
 * Elle est écrite ici EN PLUS des défauts du modèle, et ce n'est pas une
 * redondance : les défauts ne s'appliquent qu'à un document NEUF. Une base où
 * le thème existe déjà — créé par un premier démarrage antérieur à ce lot —
 * porterait encore le bleu du moteur d'origine, et rien ne le signalerait.
 */
const THEME = {
  colors: {
    background: '#08080a',
    foreground: '#f4f4f5',
    primary: '#ededed',
    /**
     * L'ACCENT VIENT DU LOGO, ET C'EST UNE DÉCISION.
     *
     * Le plan de site demande « noir et gris profond » : c'est la BASE, et
     * elle est tenue — fond, texte, surfaces et filets restent neutres. Mais
     * le logo, lui, porte un dégradé violet-bleu, et un site entièrement gris
     * posé sous ce logo aurait donné deux identités dans le même écran.
     *
     * Le violet ne sert donc qu'aux DÉTAILS : les sur-titres, les filets d'un
     * pixel, la lueur qui suit le pointeur sur une carte, le trait qui se
     * trace le long des étapes. Jamais un aplat, jamais un bouton — ceux-ci
     * restent en blanc cassé sur noir.
     */
    accent: '#7c5cff',
  },
  radius: '0.25rem',
  typography: { headingFont: 'manrope', bodyFont: 'inter' },
};

/* ══════════════════════════════════════════════════════════════════════════════
   2. LES CHAPITRES — sections 02, 03 et 04 du plan de site.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * LES SUR-TITRES SONT NUMÉROTÉS SUR LES CHAPITRES, PAS SUR LE PLAN DE SITE.
 *
 * ══ LE DÉCALAGE QUE CELA CORRIGE ════════════════════════════════════════════
 *
 * Le plan de site numérote SES CINQ SECTIONS : 01 accueil, 02 conception,
 * 03 architecture, 04 l'expérience, 05 présenter un projet. Recopiés tels
 * quels, les chapitres portaient donc 02, 03 et 04 — parce que 01 est la page
 * d'accueil et 05 la page de contact, dont aucune n'est un chapitre.
 *
 * Sur la grille « Comment nous travaillons », le visiteur voyait alors une
 * série commençant à 02, sans jamais rencontrer de 01 : cela se lit comme une
 * carte qui n'a pas chargé. Ces numéros indexaient un document que personne ne
 * lit sur le site.
 *
 * Ils numérotent maintenant ce que la page MONTRE — trois chapitres, 01 à 03.
 * La règle générale : un numéro affiché doit compter les choses visibles, pas
 * les sections d'un document interne.
 *
 * LES ÉTAPES DE « L'EXPÉRIENCE L.Y » gardent leur propre numérotation (01
 * échange → 04 livraison) : elle compte un déroulé dans le temps, et le rendu
 * `STEPS` la dérive de la POSITION des volets, jamais de ce sur-titre.
 */

/**
 * LES SLUGS SONT ÉCRITS, PAS DÉRIVÉS.
 *
 * Le contrôleur dérive le slug du titre à la création — « L'Expérience L.Y »
 * donnerait `l-experience-l-y`, une adresse que personne ne tape et que rien
 * ne rend lisible. On les pose donc explicitement ici, une fois, et le
 * contrôleur ne les touche plus jamais ensuite.
 */
const CHAPITRES = [
  {
    slug: 'conception',
    kicker: '01 / Conception',
    title: 'Conception',
    navLabel: 'Conception',
    lead:
      "Votre site part de votre entreprise, pas d'un modèle. Avant de dessiner quoi que "
      + 'soit, nous regardons ce que vous faites, pour qui, et ce qui vous distingue.',
    layout: 'PILLARS',
    navOrder: 10,
    items: [
      {
        icon: 'Fingerprint',
        label: 'Identité',
        title: 'Comprendre votre métier',
        text:
          'Ce que vous vendez, à qui, et comment vos clients choisissent. Un site juste '
          + 'commence par une lecture juste de votre activité.',
      },
      {
        icon: 'Compass',
        label: 'Direction',
        title: "Une identité qui n'est qu'à vous",
        text:
          'Vos couleurs, votre typographie, vos images et votre façon de parler. Rien qui '
          + 'soit repris d’un site fait pour quelqu’un d’autre.',
      },
      {
        icon: 'Route',
        label: 'Expérience',
        title: 'Des parcours pensés pour vos clients',
        text:
          'Les chemins et les interactions se dessinent autour de ce que vos clients '
          + 'font réellement, pas autour de ce qu’une grille de composants propose.',
      },
    ],
    statement: {
      label: 'Principe',
      text: 'Nous ne choisissons pas un design. Nous créons le vôtre.',
    },
  },
  {
    slug: 'architecture',
    kicker: '02 / Architecture',
    title: 'Architecture',
    navLabel: 'Architecture',
    lead:
      'Vous recevez deux choses : le site que vos clients visitent, et l’espace privé '
      + 'depuis lequel vous le modifiez vous-même.',
    layout: 'SPLIT',
    navOrder: 20,
    items: [
      {
        icon: 'MonitorSmartphone',
        label: 'Espace public',
        title: 'Le site que vos clients voient',
        text:
          'Votre identité, vos contenus, vos services, vos tarifs, vos parcours et vos '
          + 'interactions. Tout ce par quoi votre entreprise se donne à connaître.',
      },
      {
        icon: 'Lock',
        label: 'Espace privé',
        title: 'Votre espace privé',
        text:
          'L’environnement d’où vous tenez votre présence digitale et vos contenus, '
          + 'sans passer par nous et sans écrire une ligne de code.',
      },
      {
        icon: 'Workflow',
        label: 'Le lien',
        title: 'Les deux conçus ensemble',
        text:
          'Les deux espaces ne sont pas deux produits posés côte à côte : ils sont les '
          + 'deux faces d’une même conception, personnalisée de bout en bout.',
      },
    ],
    statement: {
      label: 'Message clé',
      text: 'Ce que nous concevons pour vous reste maîtrisé par vous.',
    },
  },
  {
    slug: 'experience',
    kicker: '03 / L’Expérience L.Y',
    title: 'L’Expérience L.Y',
    navLabel: 'L’Expérience L.Y',
    lead:
      'Quatre étapes, dans cet ordre. Chacune se termine avant que la suivante ne commence, '
      + 'et vous savez à tout moment où en est votre projet.',
    layout: 'STEPS',
    navOrder: 30,
    items: [
      {
        icon: 'MessageSquare',
        label: 'Échange',
        title: 'Découvrir votre entreprise',
        text: 'Votre activité, vos clients, ce que vous attendez du site, et ce que vous ne '
          + 'voulez surtout pas.',
      },
      {
        icon: 'Compass',
        label: 'Direction',
        title: 'Choisir votre identité visuelle',
        text: 'Logo, couleurs, typographie et style des photos. Tout est arrêté à cette étape, '
          + "et n'est plus rediscuté ensuite.",
      },
      {
        icon: 'Code2',
        label: 'Conception',
        title: 'Dessiner et développer',
        text: 'Les pages, les parcours, le référencement Google et votre espace privé. Vous '
          + "suivez l'avancement au fur et à mesure.",
      },
      {
        icon: 'Send',
        label: 'Livraison',
        title: 'Mettre en ligne et vous former',
        text:
          'Mise en ligne, prise en main de votre espace privé, et accompagnement jusqu’à ce '
          + 'que vous soyez autonome.',
      },
    ],
    statement: {
      label: 'Exclusivité',
      text:
        'Notre capacité de conception est volontairement limitée : c’est la condition '
        + 'd’une approche réellement personnalisée.',
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════════════
   3. LES VISUELS
   ══════════════════════════════════════════════════════════════════════════ */

const cacheMedias = new Map();

/** Le descripteur déjà en place, s'il y en a un. */
const dejaPose = (descripteur) => Boolean(descripteur && descripteur.objectKey);

async function importerFichier(relatif, mediaType, { detourer = false } = {}) {
  const cle = `${relatif}|${mediaType}`;
  if (cacheMedias.has(cle)) return cacheMedias.get(cle);

  const chemin = path.join(ASSETS, relatif);
  let octets = await fs.readFile(chemin).catch(() => null);
  if (!octets) {
    log(`  ⚠ visuel introuvable : ${chemin} — champ laissé vide.`);
    cacheMedias.set(cle, null);
    return null;
  }
  /**
   * LE LOGO EST DÉTOURÉ AVANT D'ÊTRE IMPORTÉ — sinon il est INVISIBLE.
   *
   * ══ LE DÉFAUT, ET IL SE VOIT AU PREMIER CHARGEMENT ═══════════════════════
   *
   * `Logo.png` est un carré de 2048 px dont le lettrage n'occupe qu'une bande
   * centrale : au-dessus et en dessous, plus de 700 px de noir. Redimensionné
   * à la hauteur d'une barre de navigation — 32 px — ce lettrage tombe à cinq
   * pixels de haut, perdu au milieu d'un carré vide. Le logo est là, il est
   * chargé, il est juste illisible.
   *
   * Le rognage retire les bords UNIFORMES, quelle que soit leur couleur, et
   * rend une image dont toute la hauteur porte le lettrage. Le fond noir
   * subsiste entre les lettres, et c'est voulu : c'est le fond du logo, pas
   * une marge.
   *
   * `threshold` est bas : le dégradé du symbole passe par des bleus très
   * sombres, et un seuil large les mangerait avec la marge.
   */
  if (detourer) {
    const { default: sharp } = await import('sharp');
    const avant = await sharp(octets).metadata();

    /**
     * ══ 1. LE ROGNAGE — sans lui, le logo est INVISIBLE ══════════════════════
     *
     * `Logo.png` est un carré de 2000 px dont le lettrage n'occupe qu'une
     * bande centrale : au-dessus et en dessous, plus de 800 px de vide.
     * Redimensionné à la hauteur d'une barre de navigation — 32 px — ce
     * lettrage tombe à cinq pixels de haut, perdu au milieu d'un carré. Le
     * logo est là, il est chargé, il est simplement illisible.
     */
    const rogne = await sharp(octets)
      .trim({ threshold: 5 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = rogne.info;

    /**
     * ══ 2. LE FOND NOIR DEVIENT TRANSPARENT ═════════════════════════════════
     *
     * Le rognage règle la taille ; il ne règle pas le fond. Ce logo est un
     * lettrage CLAIR SUR NOIR OPAQUE, et ce noir n'est pas neutre : posé sur
     * le pied de page — dont la surface est décalée d'un cran vers le texte —
     * il dessine un rectangle noir autour du logo.
     *
     * ── POURQUOI LE MAXIMUM DES CANAUX, ET PAS LA LUMINANCE ────────────────
     *
     * La luminance pondère le vert six fois plus que le bleu (0,7152 contre
     * 0,0722). Le symbole de la marque est un dégradé VIOLET ET BLEU, presque
     * sans vert : sa luminance est basse, et une alpha qui en dériverait le
     * rendrait à demi transparent — le lettrage blanc resterait net et
     * l'anneau, lui, s'effacerait. C'est le contraire de ce qu'on veut.
     *
     * `max(r, g, b)` est la VALEUR au sens TSV : elle vaut 0 sur le noir du
     * fond et reste haute sur un bleu saturé. Le fond disparaît, le symbole
     * garde sa densité, et les bords conservent leur anticrénelage au lieu
     * d'être découpés au seuil.
     *
     * ── CE QUE CE CHOIX COÛTE, ET POURQUOI ON L'ASSUME ─────────────────────
     *
     * Le lettrage est BLANC. Rendu transparent, il devient invisible sur un
     * fond clair — un thème clair ferait donc disparaître la moitié du logo.
     * L'alternative (garder le noir opaque) ne casse rien mais pose un pavé
     * noir sur toutes les surfaces qui ne sont pas exactement noires, y
     * compris le pied de page de CE site.
     *
     * On tranche pour la transparence parce que l'identité de L.Y Solution est
     * sombre par définition — c'est l'objet même du plan de site — et qu'un
     * logo blanc sur fond noir est ce que la marque a dessiné. Le jour où un
     * fond clair est nécessaire, c'est une SECONDE déclinaison du logo qu'il
     * faudra, pas un traitement automatique de celle-ci.
     */
    const rgb = rogne.data;
    const alpha = Buffer.allocUnsafe(width * height);
    for (let i = 0, j = 0; j < alpha.length; i += 3, j += 1) {
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      alpha[j] = r > g ? (r > b ? r : b) : (g > b ? g : b);
    }

    const detoure = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer({ resolveWithObject: true });

    octets = detoure.data;
    write(`${relatif} détouré : ${avant.width}×${avant.height} → `
      + `${detoure.info.width}×${detoure.info.height}, fond rendu transparent`);
  }
  if (!APPLY) {
    write(`importerait ${relatif} (${Math.round(octets.length / 1024)} Ko) en « ${mediaType} »`);
    cacheMedias.set(cle, null);
    return null;
  }
  const { maxWidth, format, square } = policyFor(mediaType);
  const res = await importProjectMedia(octets, {
    mediaType, maxWidth, format, square: Boolean(square), createdBy: 'init-ly-solution',
  });
  write(`${relatif} → ${res.filename}${res.deduplicated ? ' (déjà présent)' : ''}`);
  cacheMedias.set(cle, res);
  return res;
}

/**
 * LE MÉDIA D'UN CHAMP — importé s'il manque, laissé en place sinon.
 *
 * Rend `null` quand il n'y a rien à faire : l'appelant ne touche alors pas au
 * champ, ce qui est exactement ce qu'on veut. Un rendu « vide » ne signifie
 * jamais « efface » — aucun appelant n'écrit sur un `null`.
 */
async function mediaSiManquant(descripteurActuel, relatif, mediaType, opts = {}) {
  if (dejaPose(descripteurActuel) && !FORCER_MEDIAS) {
    write(`${relatif} — déjà en place, conservé`);
    return null;
  }
  return importerFichier(relatif, mediaType, opts);
}

/* ══════════════════════════════════════════════════════════════════════════════
   4. ÉCRITURE
   ══════════════════════════════════════════════════════════════════════════ */

async function initEntreprise() {
  const company = await getSingleton(Company);
  company.name = IDENTITE.name;
  company.tagline = IDENTITE.tagline;
  company.homeIntro = IDENTITE.homeIntro;
  company.satisfiedClients = IDENTITE.satisfiedClients;
  company.keyFigures = IDENTITE.keyFigures;

  /**
   * LE CATALOGUE DE MÉDIAS EST POSÉ, MAIS AUCUNE VALEUR N'EST INVENTÉE.
   *
   * On garantit que les six entrées existent et sont dans l'ordre du
   * catalogue — sans quoi l'écran « Coordonnées » afficherait une liste
   * incomplète sur une base créée avant ce lot. Les valeurs déjà saisies sont
   * CONSERVÉES : ce sont des données réelles, ce fichier n'en a aucune.
   */
  const parCle = new Map((company.media ?? []).map((m) => [m.key, m]));
  company.media = MEDIA_CATALOG.map((m, i) => {
    const existant = parCle.get(m.key);
    return {
      key: m.key,
      label: m.label,
      icon: m.icon,
      kind: m.kind,
      value: existant?.value ?? '',
      enabled: Boolean(existant?.value) && (existant?.enabled ?? false),
      order: i,
    };
  });

  const logo = await mediaSiManquant(company.logosMedia?.header, 'Logo.png', 'company-logo', { detourer: true });
  const favicon = await mediaSiManquant(company.logosMedia?.favicon, 'favicon.png', 'company-favicon');
  if (logo) { company.logos.header = logo.url; company.logosMedia.header = logo.descriptor; }
  if (favicon) { company.logos.favicon = favicon.url; company.logosMedia.favicon = favicon.descriptor; }

  /**
   * AUCUNE IMAGE D'ACCUEIL — et c'est le parti pris de la bannière.
   *
   * `HeroBanner` construit une scène en trois dimensions : une grille en
   * perspective et un monolithe en fil de fer. Une photographie posée derrière
   * donnerait deux images superposées et aucune des deux. Le champ reste
   * disponible dans le Manager pour qui voudra en ajouter une : elle se posera
   * alors très en retrait, comme une matière.
   */
  write(`entreprise « ${company.name} » — ${company.keyFigures.length} principes, `
    + `${company.media.filter((m) => m.enabled).length} coordonnée(s) renseignée(s)`);
  if (APPLY) await company.save();
}

async function initTheme() {
  const theme = await getSingleton(Theme);
  Object.assign(theme.colors, THEME.colors);
  theme.radius = THEME.radius;
  theme.typography.headingFont = THEME.typography.headingFont;
  theme.typography.bodyFont = THEME.typography.bodyFont;
  write(`thème — ${Object.values(THEME.colors).join(' · ')} · `
    + `${THEME.typography.headingFont}/${THEME.typography.bodyFont} · rayon ${THEME.radius}`);
  if (APPLY) await theme.save();
}

async function initChapitres() {
  for (const source of CHAPITRES) {
    const existant = await Chapter.findOne({ slug: source.slug });
    if (existant) {
      write(`chapitre « ${source.slug} » — déjà présent, laissé intact`);
      continue;
    }
    write(`chapitre « ${source.slug} » — ${source.layout}, ${source.items.length} volet(s)`);
    if (!APPLY) continue;
    await Chapter.create({
      ...source,
      items: source.items.map((v, i) => ({ ...v, order: (i + 1) * 10 })),
      showInNav: true,
      published: true,
      order: source.navOrder,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   5. PILOTE
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
  log(`\nINITIALISATION L.Y SOLUTION — ${APPLY ? 'ÉCRITURE' : 'SIMULATION (aucune écriture)'}`);
  log(`visuels : ${ASSETS}\n`);

  await connectDatabase();
  try {
    log('1. Entreprise');
    await initEntreprise();
    log('\n2. Thème');
    await initTheme();
    log('\n3. Chapitres');
    await initChapitres();
  } finally {
    await disconnectDatabase();
  }

  log(APPLY
    ? '\nTerminé. Le contenu est en base ; le Manager fait autorité à partir de maintenant.'
    : '\nSimulation terminée. Relancez avec --apply pour écrire.');
}

await main();
