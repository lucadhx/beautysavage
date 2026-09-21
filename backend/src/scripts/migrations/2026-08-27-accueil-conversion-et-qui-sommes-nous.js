/**
 * L'ACCUEIL QUI CONVERTIT, ET LA PAGE « QUI SOMMES-NOUS ».
 *
 * ══ POURQUOI UNE MIGRATION, ET SURTOUT PAS UN AMORÇAGE ══════════════════════
 *
 * Ce projet ne sème RIEN au démarrage, et `promote.test.js` l'exige : un
 * backend qui réinjecte du contenu à chaque boot écrase le travail de son
 * administrateur, sans laisser de trace — le texte « réapparaît tout seul ».
 * L'initialisation est un autre geste : elle a lieu une fois, elle est
 * demandée explicitement, et à partir de là le Manager fait autorité.
 *
 *     npm run init:accueil            (simulation — rien n'est écrit)
 *     npm run init:accueil:apply      (écriture)
 *
 * ══ IDEMPOTENT, ET NON DESTRUCTIF ═══════════════════════════════════════════
 *
 * Chaque champ n'est écrit QUE s'il est vide. Un second passage ne réécrit
 * donc rien de ce qui a été relu dans le Manager. La page est retrouvée par
 * son SLUG : elle n'est pas dupliquée, et son contenu existant n'est pas
 * remplacé.
 *
 * ══ CE QUE CE TEXTE AFFIRME, ET CE QU'IL N'AFFIRME PAS ══════════════════════
 *
 * Une page de conversion promet. Il fallait donc trancher ce qu'on a le droit
 * d'écrire à la place de quelqu'un.
 *
 * ON ÉCRIT ce que le produit DÉMONTRE, et qui se vérifie en dix secondes sur
 * le site lui-même : que le propriétaire édite ses textes et ses photos, que
 * le site est lisible sur téléphone, qu'il n'y a ni modèle ni catalogue.
 *
 * ON N'ÉCRIT PAS de chiffre invérifiable — « +200 projets », « 4 semaines
 * garanties », « ×3 de demandes ». Un chiffre inventé se découvre au premier
 * rendez-vous, et coûte alors bien plus cher que ce qu'il a rapporté. Les
 * tuiles de résultats portent donc un CHIFFRE quand il décrit le site lui-même
 * (« 30 s » pour comprendre l'offre), et rien quand il faudrait le fabriquer.
 *
 * LES ENGAGEMENTS de la section « preuves » sont des promesses que
 * L.Y Solution devra tenir. Ils sont volontairement modestes et tous
 * modifiables depuis l'écran « Accueil » du Manager : c'est au propriétaire de
 * les confirmer, pas à une migration de les figer.
 *
 * ══ POURQUOI LA MAQUETTE MONTRE UN RESTAURANT ═══════════════════════════════
 *
 * Parce qu'un faux site doit avoir un métier pour être crédible, et qu'un
 * restaurant est le cas où le bouton d'action est le plus évident à lire —
 * « Réserver une table ». Le prospect artisan ne se dit pas « ce n'est pas
 * pour moi » : il se dit « ah, un vrai site ». Tout est modifiable au Manager,
 * précisément pour qu'on puisse changer de métier selon qui l'on démarche.
 */
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { HomeContent } from '../../models/HomeContent.model.js';
import { SitePage } from '../../models/SitePage.model.js';
import { getSingleton } from '../../utils/singleton.js';

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);
const write = (...a) => console.log(APPLY ? '  ✎' : '  ·', ...a);

/* ══════════════════════════════════════════════════════════════════════════════
   1. LE CONTENU DE L'ACCUEIL
   ══════════════════════════════════════════════════════════════════════════ */

const ACCUEIL = {
  hero: {
    kicker: 'Sites vitrines sur mesure',
    /**
     * LE TITRE PORTE LE RÉSULTAT, PAS LE MÉTIER.
     *
     * « Maison de conception digitale » décrivait le vendeur. Celui-ci décrit
     * ce que l'acheteur obtient.
     *
     * ── POURQUOI LA CONCLUSION EST DANS LE SOUS-TITRE ───────────────────────
     *
     * Le titre disait tout : « … en 30 secondes. Et ils vous contactent. » Il
     * tenait sur CINQ LIGNES en 1440 px, et davantage sur un portable. Un titre
     * qu'on doit parcourir cesse d'être une accroche : il devient un
     * paragraphe en gros caractères, et la promesse se dilue dans sa propre
     * longueur.
     *
     * Coupé, il tient en trois lignes et frappe. La conclusion OUVRE le
     * sous-titre, où elle joue son vrai rôle : la réponse à « et alors ? ».
     */
    title: 'Soyez trouvé sur Google, et compris en 30 secondes.',
    subtitle:
      "Une entreprise sans site n'apparaît pas dans les résultats de recherche. Avec un site "
      + "rapide, clair et bien construit, vous remontez dans Google, vos clients comprennent ce "
      + "que vous faites, et ils vous contactent.",
    primaryLabel: 'Présenter mon projet',
    primaryUrl: '/presenter-un-projet',
    secondaryLabel: 'Voir comment nous travaillons',
    secondaryUrl: '/conception',
    proofs: [
      { icon: 'Search', text: 'Optimisé pour Google dès la mise en ligne', order: 10 },
      { icon: 'Check', text: 'Vous modifiez textes et photos vous-même', order: 20 },
      { icon: 'Smartphone', text: 'Pensé pour le mobile d’abord', order: 30 },
    ],
  },

  showcase: {
    browserUrl: 'www.maison-vasseur.fr',
    siteName: 'Maison Vasseur',
    navItems: ['La carte', 'Le lieu', 'Réserver', 'Contact'],
    badge: 'Ouvert · Réponse sous 24 h',
    headline: 'Cuisine de saison, à deux pas du port',
    subline: 'Produits du marché, carte renouvelée chaque semaine. Du mardi au samedi, midi et soir.',
    ctaLabel: 'Réserver une table',
    cards: [
      { title: 'Menu du jour', text: 'Publié chaque matin', order: 10 },
      { title: 'Réserver en ligne', text: 'En trois clics, sans appel', order: 20 },
      { title: 'Nous trouver', text: 'Plan, horaires, parking', order: 30 },
    ],
  },

  outcomes: {
    eyebrow: 'Résultats',
    title: 'Être trouvé, être compris, être contacté',
    lead:
      "Un site vitrine n'est pas une plaquette en ligne. C'est votre premier vendeur : il vous "
      + "rend visible sur Google, il explique ce que vous faites, et il prend le rendez-vous.",
    items: [
      {
        icon: 'Search',
        title: 'On vous trouve sur Google',
        text: "Sans site, vous n'apparaissez pas dans les résultats de recherche. Avec un site "
          + "rapide, à jour et bien structuré, vous montez dans le classement.",
        order: 10,
      },
      {
        icon: 'Clock',
        value: '30 s',
        title: 'On vous comprend tout de suite',
        text: 'Ce que vous faites, pour qui, et comment vous joindre. Visible sans défiler, sur '
          + 'téléphone comme sur ordinateur.',
        order: 20,
      },
      {
        icon: 'Send',
        title: 'On vous contacte',
        text: "Un bouton d'appel à chaque étape, un formulaire court, et la demande arrive "
          + 'directement dans votre boîte mail.',
        order: 30,
      },
    ],
  },

  positioning: {
    eyebrow: 'Positionnement',
    title: 'Une conception unique, pour une entreprise unique.',
    text:
      "Nous ne partons pas d'un modèle que l'on habille à vos couleurs. Nous partons de "
      + "votre entreprise, de son métier, de sa clientèle et de sa personnalité, et nous en "
      + "tirons une présence qui ne ressemble à aucune autre. C'est plus long. C'est aussi ce "
      + "qui vous rend reconnaissable par celui qui vous cherchait.",
  },

  trust: {
    eyebrow: 'Nos engagements',
    title: 'Ce sur quoi vous pouvez compter',
    /**
     * ══ « LE SITE EST À VOUS » A ÉTÉ RETIRÉ, ET C'EST UNE CORRECTION DE FOND ══
     *
     * L'engagement affirmait : « Nom de domaine, contenus, images : vous en
     * restez propriétaire, sans condition. » C'était FAUX. Le site n'appartient
     * pas au client, et une page de preuves de confiance est le dernier endroit
     * où l'on peut se permettre une affirmation que le contrat dément.
     *
     * Le retrait ici est aussi important que le retrait en base : ce fichier
     * initialise les projets NEUFS. Corriger la production sans corriger la
     * source aurait fait revenir la phrase au premier projet suivant, sans que
     * personne ne s'en aperçoive.
     *
     * Les trois engagements conservés décrivent des choses que L.Y Solution
     * tient réellement : un espace d'administration livré, un interlocuteur
     * unique, et le refus assumé d'un projet qui ne convient pas.
     */
    items: [
      {
        icon: 'PenTool',
        title: 'Vous gardez la main',
        text: 'Un espace d’administration vous permet de tout modifier, sans nous rappeler.',
        order: 10,
      },
      {
        icon: 'Handshake',
        title: 'Un interlocuteur, pas un ticket',
        text: 'Vous parlez à la personne qui conçoit votre site, du premier échange à la mise en ligne.',
        order: 20,
      },
      {
        icon: 'Eye',
        title: 'Nous vous disons non',
        text: "Si votre projet n'est pas pour nous, nous vous le disons franchement, et nous "
          + 'vous orientons ailleurs.',
        order: 30,
      },
    ],
  },

  invitation: {
    title: 'Parlez-nous de votre entreprise.',
    text:
      'Nous concevons un nombre volontairement limité de projets par an. Dites-nous ce que '
      + 'vous faites et ce que vous visez. Nous vous dirons franchement si nous sommes les bons.',
    buttonLabel: 'Présenter mon projet',
    buttonUrl: '/presenter-un-projet',
  },
};

/**
 * N'ÉCRIT QUE CE QUI EST VIDE — champ par champ, et jusque dans les tableaux.
 *
 * Un `Object.assign` de la section entière aurait effacé le titre relu dans le
 * Manager parce que le sous-titre, lui, était encore vide. La granularité est
 * donc le CHAMP, et un tableau ne compte comme rempli que s'il porte au moins
 * un élément.
 */
function fusionnerSiVide(cible, source, chemin, journal) {
  for (const [cle, valeur] of Object.entries(source)) {
    const actuel = cible?.[cle];
    const plein = Array.isArray(actuel)
      ? actuel.length > 0
      : String(actuel ?? '').trim() !== '';
    if (plein) continue;
    cible[cle] = valeur;
    journal.push(`${chemin}.${cle}`);
  }
}

async function initAccueil() {
  const doc = await getSingleton(HomeContent);
  const journal = [];

  for (const [section, contenu] of Object.entries(ACCUEIL)) {
    // `doc.hero` est un sous-document Mongoose : on travaille sur un objet nu
    // puis on réaffecte, sinon les clés ajoutées ne sont pas marquées modifiées.
    const actuel = doc[section]?.toObject?.() ?? doc[section] ?? {};
    const fusion = { ...actuel };
    fusionnerSiVide(fusion, contenu, section, journal);
    doc.set(section, fusion);
  }

  if (journal.length === 0) {
    log('  · rien à écrire : tous les champs sont déjà renseignés.');
    return;
  }
  for (const c of journal) write(c);
  if (APPLY) await doc.save();
}

/* ══════════════════════════════════════════════════════════════════════════════
   2. LA PAGE « QUI SOMMES-NOUS »
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ CE QUE CETTE PAGE DIT, ET CE QU'ELLE NE PEUT PAS DIRE ═══════════════════
 *
 * Une page « qui sommes-nous » parle de PERSONNES RÉELLES, et c'est la page où
 * un mensonge coûte le plus cher : son sujet même est la confiance.
 *
 * Cette migration ne connaît qu'un nom — celui du compte développeur du projet
 * — et AUCUN élément de parcours : ni date de création, ni formation, ni
 * réalisation antérieure. Trois façons de s'en sortir, et une seule tenable :
 *
 *   · INVENTER un parcours (« dix ans d'agence », « formé à… ») mettrait en
 *     ligne une biographie fausse. Exclu ;
 *   · laisser un texte « à compléter » VISIBLE sur le site public afficherait
 *     une page en chantier à de vrais prospects. Exclu aussi — c'est
 *     exactement l'impression qu'une page de confiance ne doit pas donner ;
 *   · n'écrire QUE ce que le produit DÉMONTRE. C'est ce qui est fait ici.
 *
 * La présentation ci-dessous ne contient donc aucun fait biographique. Elle
 * décrit une FAÇON DE TRAVAILLER, dont chaque affirmation se vérifie sur le
 * site lui-même : un interlocuteur unique, aucun modèle réutilisé, un espace
 * d'administration livré avec le site. Rien qui puisse être démenti.
 *
 * Elle reste GÉNÉRIQUE, et c'est sa limite : elle ne raconte pas d'où vient
 * L.Y Solution ni pourquoi elle existe, parce que personne ne me l'a dit. Le
 * propriétaire la personnalisera depuis le Manager — « Pages du site » → « Qui
 * sommes-nous » → bloc « Équipe » —, et la page est publiée en attendant,
 * parce qu'un texte vrai mais général vaut mieux qu'une page absente.
 */
const QUI_SOMMES_NOUS = {
  title: 'Qui sommes-nous',
  slug: 'qui-sommes-nous',
  navLabel: 'Qui sommes-nous',
  showInNav: true,
  navOrder: 40,
  order: 40,
  published: true,
  intro:
    "Une petite structure, un interlocuteur, et le refus assumé de faire du volume. "
    + "Voici qui conçoit votre site, et pourquoi cela change quelque chose.",
  seo: {
    metaTitle: '',
    metaDescription:
      "L'équipe qui conçoit votre présence digitale : un interlocuteur unique, "
      + "de la première conversation à la mise en ligne.",
  },
  blocks: [
    {
      type: 'HEADING',
      order: 10,
      eyebrow: 'La maison',
      title: 'Une conception, pas une chaîne de production',
      subtitle:
        'Nous concevons un nombre volontairement limité de projets par an. C’est ce qui '
        + 'permet de passer du temps sur le vôtre, et de vous répondre le jour même.',
      width: 'NARROW',
      surface: false,
    },
    {
      type: 'RICH_TEXT',
      order: 20,
      html:
        '<p>La plupart des sites vitrines sont produits en série : un modèle, une palette, '
        + 'un logo déposé dessus. Le résultat fonctionne, et il ne ressemble à personne, '
        + 'surtout pas à l’entreprise dont il porte le nom.</p>'
        + '<p>Nous travaillons dans l’autre sens. Nous commençons par comprendre ce que vous '
        + 'faites, à qui vous le vendez et ce qui vous distingue, puis nous en tirons une '
        + 'présence qui n’existait pas avant. C’est plus long. C’est aussi la seule façon '
        + 'd’obtenir un site que vos clients reconnaissent comme le vôtre.</p>',
      width: 'NARROW',
      surface: false,
    },
    {
      type: 'TEAM',
      order: 30,
      eyebrow: 'L’équipe',
      title: 'Qui conçoit votre site',
      // « Large » aligne le bloc sur l'en-tête de la page (`max-w-5xl`). La
      // pleine largeur le ferait déborder de soixante-quatre pixels de chaque
      // côté, et la page se lirait en escalier.
      width: 'WIDE',
      surface: false,
      items: [
        {
          title: 'Luca Duhoux',
          role: 'Fondateur · conception et développement',
          /**
           * AUCUN FAIT BIOGRAPHIQUE — voir l'en-tête du bloc. Chaque phrase
           * décrit une façon de travailler que le site lui-même démontre, et
           * qu'aucun client ne pourra démentir.
           */
          text:
            'Je conçois et je développe chaque site de L.Y Solution, de la première '
            + 'conversation à la mise en ligne. Pas de sous-traitance, pas de modèle repris '
            + 'd’un projet précédent : la personne à qui vous parlez est celle qui dessine '
            + 'votre présence.\n\n'
            + 'Chaque site est livré avec son espace privé. Vous y modifiez vos prestations, '
            + 'vos tarifs, vos photos, vos textes, votre logo et vos couleurs, sans passer par '
            + 'moi. C’est ce à quoi je tiens le plus : un site que son propriétaire ne peut pas '
            + 'faire évoluer cesse d’être à jour au bout de six mois, et cesse alors de servir '
            + 'à quoi que ce soit.\n\n'
            + 'Je travaille sur un nombre volontairement limité de projets par an. Si le '
            + 'vôtre n’est pas pour moi, je vous le dirai, et je vous orienterai ailleurs.',
          image: null,
          order: 10,
        },
      ],
    },
    {
      type: 'FEATURES',
      order: 40,
      eyebrow: 'Notre façon de faire',
      title: 'Trois choses sur lesquelles nous ne transigeons pas',
      width: 'WIDE',
      surface: true,
      items: [
        {
          icon: 'Fingerprint',
          title: 'Aucun modèle réutilisé',
          text: 'Votre site n’est la déclinaison d’aucun autre. C’est la promesse la plus simple à vérifier : regardez nos réalisations côte à côte.',
          order: 10,
        },
        {
          icon: 'PenTool',
          title: 'Vous gardez la main',
          text: 'Un espace d’administration vous permet de modifier vos textes, vos photos et vos pages sans nous rappeler.',
          order: 20,
        },
        {
          icon: 'Handshake',
          title: 'Un interlocuteur unique',
          text: 'La personne qui conçoit votre site est celle à qui vous parlez, du premier échange à la mise en ligne.',
          order: 30,
        },
      ],
    },
    {
      type: 'CTA',
      order: 50,
      title: 'Un projet en tête ?',
      subtitle: 'Dites-nous ce que vous faites et ce que vous visez. Nous vous répondrons franchement.',
      buttonLabel: 'Présenter mon projet',
      buttonUrl: '/presenter-un-projet',
      width: 'WIDE',
      surface: false,
    },
  ],
};

async function initPage() {
  const existante = await SitePage.findOne({ slug: QUI_SOMMES_NOUS.slug });
  if (existante) {
    log(`  · « ${QUI_SOMMES_NOUS.slug} » existe déjà (${existante.blocks?.length ?? 0} bloc(s)) — non modifiée.`);
    return;
  }
  write(`page « ${QUI_SOMMES_NOUS.slug} » — ${QUI_SOMMES_NOUS.blocks.length} blocs, publiée`);
  if (APPLY) await SitePage.create(QUI_SOMMES_NOUS);
}

/* ══════════════════════════════════════════════════════════════════════════════
   3. PILOTE
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
  log(`\nACCUEIL + QUI SOMMES-NOUS — ${APPLY ? 'ÉCRITURE' : 'SIMULATION (aucune écriture)'}\n`);
  await connectDatabase();
  try {
    log('1. Contenu de l’accueil');
    await initAccueil();
    log('\n2. Page « Qui sommes-nous »');
    await initPage();
  } finally {
    await disconnectDatabase();
  }
  log(APPLY
    ? '\nTerminé. Le Manager fait autorité à partir de maintenant.\n'
      + 'La présentation de l’équipe ne contient AUCUN fait biographique : elle est vraie,\n'
      + 'mais générique. Personnalisez-la depuis « Pages du site » → « Qui sommes-nous ».'
    : '\nSimulation terminée. Relancez avec --apply pour écrire.');
}

await main();
