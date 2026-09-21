/**
 * VISIBILITÉ, CLARTÉ, ET PLUS AUCUN TIRET CADRATIN.
 *
 * ══ TROIS CORRECTIONS DEMANDÉES, ET POURQUOI ELLES VONT ENSEMBLE ════════════
 *
 * 1. L'ANGLE DE LA VISIBILITÉ. L'accueil parlait de compréhension et de
 *    contact, et sautait l'étape qui les précède : être TROUVÉ. Une entreprise
 *    sans site n'apparaît pas dans les résultats de recherche, et un site mal
 *    construit y descend. C'est la première chose qu'un commerçant veut
 *    entendre, et elle manquait. L'accueil raconte désormais la suite complète :
 *    on vous trouve, on vous comprend, on vous contacte.
 *
 * 2. LES CHAPITRES ÉTAIENT ABSTRAITS. « Ce depuis quoi vous pilotez /
 *    L'environnement d'où vous tenez votre présence digitale et vos contenus »
 *    ne dit RIEN à un restaurateur. Il ne sait pas ce qu'est un « environnement »
 *    ni une « présence digitale », et il ne peut pas deviner ce qu'il pourra
 *    changer lui-même. Le texte nomme maintenant les choses : ses prestations,
 *    ses tarifs, ses photos, son logo, ses couleurs.
 *
 * 3. LES TIRETS CADRATINS. Ils ponctuaient une phrase sur trois. C'est une
 *    ponctuation d'essai, pas de site commercial : elle allonge la phrase et
 *    oblige à la relire. Aucun ne subsiste dans le contenu public.
 *
 * ══ CETTE MIGRATION ÉCRASE, ET C'EST SA DIFFÉRENCE ══════════════════════════
 *
 * `2026-08-27-accueil-conversion` n'écrivait QUE les champs vides : elle
 * initialisait. Celle-ci CORRIGE un texte déjà en ligne, elle doit donc le
 * remplacer. Elle ne touche que les champs qu'elle NOMME, un par un, et
 * affiche l'avant et l'après avant d'écrire quoi que ce soit.
 *
 *     npm run fix:textes            (simulation, rien n'est écrit)
 *     npm run fix:textes:apply      (écriture)
 *
 * Rejouée après une retouche au Manager, elle réécraserait cette retouche :
 * c'est le prix d'une correction, et la raison pour laquelle la simulation
 * montre systématiquement ce qu'elle remplace.
 *
 * ══ CE QUE CE TEXTE AFFIRME SUR GOOGLE ══════════════════════════════════════
 *
 * « Sans site, vous n'apparaissez pas dans les résultats de recherche » est
 * vrai au sens du référencement naturel : sans page, il n'y a rien à indexer.
 * « Un site rapide, à jour et bien structuré monte dans le classement » l'est
 * aussi, et ce sont exactement les critères publiés par Google.
 *
 * Ce que le texte NE dit PAS, et ne dira pas : aucune promesse de position,
 * aucun délai, aucun « première page garantie ». C'est invérifiable, et ce
 * serait la première chose qu'un client viendrait nous opposer.
 */
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { Company } from '../../models/Company.model.js';
import { HomeContent } from '../../models/HomeContent.model.js';
import { Chapter } from '../../models/Chapter.model.js';
import { SitePage } from '../../models/SitePage.model.js';
import { getSingleton } from '../../utils/singleton.js';

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);

let changements = 0;
/** Affiche l'avant/après d'un champ, et le remplace si `--apply`. */
function poser(objet, chemin, valeur, etiquette) {
  const parties = chemin.split('.');
  let cible = objet;
  for (const p of parties.slice(0, -1)) cible = cible?.[p];
  const cle = parties.at(-1);
  const avant = cible?.[cle] ?? '';
  if (String(avant) === String(valeur)) return;
  changements += 1;
  log(`  ${APPLY ? '✎' : '·'} ${etiquette}`);
  log(`      avant : ${String(avant).replace(/\s+/g, ' ').slice(0, 110)}`);
  log(`      après : ${String(valeur).replace(/\s+/g, ' ').slice(0, 110)}`);
  if (cible) cible[cle] = valeur;
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. L'ACCUEIL — la suite « trouvé, compris, contacté »
   ══════════════════════════════════════════════════════════════════════════ */

const POSITIONNEMENT = "Nous ne partons pas d'un modèle que l'on habille à vos couleurs. "
  + "Nous partons de votre entreprise, de son métier, de sa clientèle et de sa personnalité, "
  + "et nous en tirons une présence qui ne ressemble à aucune autre. C'est plus long. "
  + "C'est aussi ce qui vous rend reconnaissable par celui qui vous cherchait.";

async function corrigerAccueil() {
  const doc = await getSingleton(HomeContent);
  const h = doc.hero;
  const o = doc.outcomes;

  poser(h, 'title', 'Soyez trouvé sur Google, et compris en 30 secondes.', 'hero.title');
  poser(
    h, 'subtitle',
    "Une entreprise sans site n'apparaît pas dans les résultats de recherche. Avec un site "
    + "rapide, clair et bien construit, vous remontez dans Google, vos clients comprennent ce "
    + "que vous faites, et ils vous contactent.",
    'hero.subtitle',
  );

  /**
   * LA PREMIÈRE RASSURANCE PARLE DE GOOGLE, et elle a pris la place de
   * « Aucun modèle réutilisé » : la différenciation a sa section entière plus
   * bas, alors que la visibilité n'était nulle part.
   */
  const preuves = [
    'Optimisé pour Google dès la mise en ligne',
    'Vous modifiez textes et photos vous-même',
    'Pensé pour le mobile d’abord',
  ];
  preuves.forEach((texte, i) => {
    if (h.proofs?.[i]) poser(h.proofs[i], 'text', texte, `hero.proofs[${i}]`);
  });
  if (h.proofs?.[0]) poser(h.proofs[0], 'icon', 'Search', 'hero.proofs[0].icon');

  poser(o, 'title', 'Être trouvé, être compris, être contacté', 'outcomes.title');
  poser(
    o, 'lead',
    "Un site vitrine n'est pas une plaquette en ligne. C'est votre premier vendeur : il vous "
    + "rend visible sur Google, il explique ce que vous faites, et il prend le rendez-vous.",
    'outcomes.lead',
  );

  /**
   * LES TROIS RÉSULTATS SUIVENT L'ENTONNOIR, dans son ordre réel. Le premier
   * volet était « on vous comprend » : il supposait le visiteur déjà arrivé,
   * c'est-à-dire l'étape la plus difficile déjà franchie.
   */
  const resultats = [
    {
      icon: 'Search',
      value: '',
      title: 'On vous trouve sur Google',
      text: "Sans site, vous n'apparaissez pas dans les résultats de recherche. Avec un site "
        + "rapide, à jour et bien structuré, vous montez dans le classement.",
    },
    {
      icon: 'Clock',
      value: '30 s',
      title: 'On vous comprend tout de suite',
      text: 'Ce que vous faites, pour qui, et comment vous joindre. Visible sans défiler, sur '
        + 'téléphone comme sur ordinateur.',
    },
    {
      icon: 'Send',
      value: '',
      title: 'On vous contacte',
      text: "Un bouton d'appel à chaque étape, un formulaire court, et la demande arrive "
        + 'directement dans votre boîte mail.',
    },
  ];
  resultats.forEach((r, i) => {
    const item = o.items?.[i];
    if (!item) return;
    poser(item, 'icon', r.icon, `outcomes.items[${i}].icon`);
    poser(item, 'value', r.value, `outcomes.items[${i}].value`);
    poser(item, 'title', r.title, `outcomes.items[${i}].title`);
    poser(item, 'text', r.text, `outcomes.items[${i}].text`);
  });

  poser(doc.positioning, 'text', POSITIONNEMENT, 'positioning.text');

  if (doc.trust?.items?.[3]) {
    poser(
      doc.trust.items[3], 'text',
      "Si votre projet n'est pas pour nous, nous vous le disons franchement, et nous vous "
      + 'orientons ailleurs.',
      'trust.items[3].text',
    );
  }
  poser(
    doc.invitation, 'text',
    'Nous concevons un nombre volontairement limité de projets par an. Dites-nous ce que vous '
    + 'faites et ce que vous visez. Nous vous dirons franchement si nous sommes les bons.',
    'invitation.text',
  );

  if (APPLY) await doc.save();
}

/* ══════════════════════════════════════════════════════════════════════════════
   2. LA FICHE ENTREPRISE
   ══════════════════════════════════════════════════════════════════════════ */

async function corrigerEntreprise() {
  const doc = await getSingleton(Company);
  poser(doc, 'homeIntro', POSITIONNEMENT, 'company.homeIntro');
  if (APPLY) await doc.save();
}

/* ══════════════════════════════════════════════════════════════════════════════
   3. LES CHAPITRES — nommer les choses
   ══════════════════════════════════════════════════════════════════════════ */

const CHAPITRES = {
  conception: {
    lead: "Votre site part de votre entreprise, pas d'un modèle. Avant de dessiner quoi que ce "
      + 'soit, nous regardons ce que vous faites, pour qui, et ce qui vous distingue.',
    items: [
      {
        title: 'Comprendre votre métier',
        text: 'Ce que vous vendez, à qui, et comment vos clients choisissent. Un site juste '
          + "commence par une lecture juste de votre activité.",
      },
      {
        title: "Une identité qui n'est qu'à vous",
        text: 'Vos couleurs, votre typographie, vos images et votre façon de parler. Rien qui '
          + "soit repris d'un site fait pour quelqu'un d'autre.",
      },
      {
        title: 'Des parcours pensés pour vos clients',
        text: "Où placer le bouton d'appel, les tarifs, le formulaire. Nous dessinons autour de "
          + 'ce que vos clients cherchent vraiment.',
      },
    ],
  },

  /**
   * LE CHAPITRE QUI POSAIT PROBLÈME.
   *
   * Le chapô disait « Deux espaces, une seule architecture. L'un se visite,
   * l'autre se pilote. » Personne, hors du métier, ne sait ce qu'est un
   * « espace » ni ce qu'on « pilote ». On nomme les deux choses que le client
   * reçoit réellement, et ce qu'il pourra changer dans la seconde.
   */
  architecture: {
    lead: 'Vous recevez deux choses : le site que vos clients visitent, et l’espace privé '
      + 'depuis lequel vous le modifiez vous-même.',
    items: [
      {
        title: 'Le site que vos clients voient',
        text: 'Vos prestations, vos tarifs, vos photos, vos horaires et vos coordonnées. Tout '
          + 'ce qui aide un visiteur à décider de vous appeler.',
      },
      {
        title: 'Votre espace privé',
        text: 'Vous y changez vos prestations et vos tarifs, vos photos et vos textes, votre '
          + 'logo et vos couleurs. Vous ajoutez une page, vous en retirez une. Depuis votre '
          + "navigateur, sans nous appeler et sans écrire une ligne de code.",
      },
      {
        title: 'Les deux conçus ensemble',
        text: "Votre espace privé n'est pas un outil ajouté après coup. Il est dessiné en même "
          + 'temps que le site, pour que tout ce que vous modifiez sorte toujours bien.',
      },
    ],
  },

  experience: {
    lead: 'Quatre étapes, dans cet ordre. Chacune se termine avant que la suivante ne commence, '
      + 'et vous savez à tout moment où en est votre projet.',
    items: [
      {
        title: 'Découvrir votre entreprise',
        text: 'Votre activité, vos clients, ce que vous attendez du site, et ce que vous ne '
          + 'voulez surtout pas.',
      },
      {
        title: 'Choisir votre identité visuelle',
        text: 'Logo, couleurs, typographie et style des photos. Tout est arrêté à cette étape, '
          + "et n'est plus rediscuté ensuite.",
      },
      {
        title: 'Dessiner et développer',
        text: 'Les pages, les parcours, le référencement Google et votre espace privé. Vous '
          + "suivez l'avancement au fur et à mesure.",
      },
      {
        title: 'Mettre en ligne et vous former',
        text: 'Mise en ligne, prise en main de votre espace privé, et accompagnement jusqu’à ce '
          + 'que vous soyez autonome.',
      },
    ],
  },
};

async function corrigerChapitres() {
  for (const [slug, source] of Object.entries(CHAPITRES)) {
    const doc = await Chapter.findOne({ slug });
    if (!doc) { log(`  · « ${slug} » introuvable, ignoré.`); continue; }
    poser(doc, 'lead', source.lead, `${slug}.lead`);
    source.items.forEach((it, i) => {
      const volet = doc.items?.[i];
      // On ne touche NI l'icône NI le label : ils sont typographiques, ils ont
      // été relus, et rien dans la demande ne les concerne.
      if (!volet) return;
      poser(volet, 'title', it.title, `${slug}.items[${i}].title`);
      poser(volet, 'text', it.text, `${slug}.items[${i}].text`);
    });
    if (APPLY) await doc.save();
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   4. LA PAGE « QUI SOMMES-NOUS »
   ══════════════════════════════════════════════════════════════════════════ */

async function corrigerPage() {
  const doc = await SitePage.findOne({ slug: 'qui-sommes-nous' });
  if (!doc) { log('  · page introuvable, ignorée.'); return; }

  const bloc = (type) => doc.blocks.find((b) => b.type === type);

  const entete = bloc('HEADING');
  if (entete) {
    poser(
      entete, 'subtitle',
      'Nous concevons un nombre volontairement limité de projets par an. C’est ce qui permet de '
      + 'passer du temps sur le vôtre, et de vous répondre le jour même.',
      'page.HEADING.subtitle',
    );
  }

  const texte = bloc('RICH_TEXT');
  if (texte) {
    poser(
      texte, 'html',
      '<p>La plupart des sites vitrines sont produits en série : un modèle, une palette, un logo '
      + 'déposé dessus. Le résultat fonctionne, et il ne ressemble à personne, surtout pas à '
      + 'l’entreprise dont il porte le nom.</p>'
      + '<p>Nous travaillons dans l’autre sens. Nous commençons par comprendre ce que vous '
      + 'faites, à qui vous le vendez et ce qui vous distingue, puis nous en tirons une présence '
      + 'qui n’existait pas avant. C’est plus long. C’est aussi la seule façon d’obtenir un site '
      + 'que vos clients reconnaissent comme le vôtre.</p>',
      'page.RICH_TEXT.html',
    );
  }

  const equipe = bloc('TEAM');
  if (equipe?.items?.[0]) {
    poser(
      equipe.items[0], 'text',
      'Je conçois et je développe chaque site de L.Y Solution, de la première conversation à la '
      + 'mise en ligne. Pas de sous-traitance, pas de modèle repris d’un projet précédent : la '
      + 'personne à qui vous parlez est celle qui dessine votre présence.\n\n'
      + 'Chaque site est livré avec son espace privé. Vous y modifiez vos prestations, vos '
      + 'tarifs, vos photos, vos textes, votre logo et vos couleurs, sans passer par moi. C’est '
      + 'ce à quoi je tiens le plus : un site que son propriétaire ne peut pas faire évoluer '
      + 'cesse d’être à jour au bout de six mois, et cesse alors de servir à quoi que ce soit.\n\n'
      + 'Je travaille sur un nombre volontairement limité de projets par an. Si le vôtre n’est '
      + 'pas pour moi, je vous le dirai, et je vous orienterai ailleurs.',
      'page.TEAM.items[0].text',
    );
  }

  if (APPLY) await doc.save();
}

/* ══════════════════════════════════════════════════════════════════════════════
   5. PILOTE
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
  log(`\nVISIBILITÉ, CLARTÉ, TIRETS — ${APPLY ? 'ÉCRITURE' : 'SIMULATION (aucune écriture)'}\n`);
  await connectDatabase();
  try {
    log('1. Accueil');
    await corrigerAccueil();
    log('\n2. Fiche entreprise');
    await corrigerEntreprise();
    log('\n3. Chapitres');
    await corrigerChapitres();
    log('\n4. Page « Qui sommes-nous »');
    await corrigerPage();
  } finally {
    await disconnectDatabase();
  }
  log(`\n${changements} champ(s) ${APPLY ? 'réécrits' : 'à réécrire'}.`);
  if (!APPLY) log('Relancez avec --apply pour écrire.');
}

await main();
