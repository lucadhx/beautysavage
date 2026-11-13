/**
 * FICHES STRUCTURÉES — le contenu des descriptions rangé à sa place (2026-11-13).
 *
 *   node src/scripts/seed-fiches-structurees-2026-11-13.js            → simulation
 *   node src/scripts/seed-fiches-structurees-2026-11-13.js --apply    → écrit
 *   options : --backup <fichier.json> (état d'avant, conseillé avec --apply)
 *             --db <nom> (base visée ; sinon celle de l'environnement ENV)
 *
 * FORMATIONS : programme, « la formation comprend », durée / niveau / prérequis
 * / format, et « Bon à savoir » (paiement en 3 fois, avantage fournisseur, kit)
 * passent dans leurs champs ; la description garde l'accroche, resserrée.
 *
 * PRESTATIONS : la description ne change pas, sauf les paragraphes qui
 * CHANGENT DE PLACE — « ⚠️ À noter », « 📅 remplissage 2/3 semaines »,
 * « ⏳ Tenue », « À prévoir en supplément » — repris en « Bon à savoir » ou en
 * chiffre clé « Tenue ». Rien d'autre n'est retiré.
 *
 * Idempotent : une fiche déjà traitée (marqueurs absents) n'est pas réécrite.
 * Pilote brut (aucun modèle Mongoose : pas d'index créé en passant).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const apply = process.argv.includes('--apply');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

/* ── Les formations ─────────────────────────────────────────────────────────── */

const KLARNA = (mensualite) => `Paiement en 3 fois sans frais via Klarna : 3 mensualités de ${mensualite}.`;
const FOURNISSEUR = 'Avantage fournisseur : -20 % sur ta première commande.';
const HORS_KIT = 'Tarif hors kit : possibilité d’ajouter le kit de formation en supplément.';
const p = (text) => `<p>${text}</p>`;

export const TRAININGS = {
  'formation-korean-lash-lift-teinture': {
    description: p('Une journée pour maîtriser une technique précise, naturelle et durable.')
      + p('Que tu sois débutante ou professionnelle, cette formation te donne les bases et les clés pour réaliser un Korean Lash Lift dans son véritable ADN. 🤍'),
    training: {
      format: 'Coaching individuel', durationLabel: '1 journée', level: 'Débutant à professionnel', prerequisites: 'Aucun',
      program: [{ title: '', items: [
        'Théorie & compréhension de la technique', 'Préparation du cil', 'Maîtrise des différentes étapes du Korean Lash Lift',
        'Gestion des temps de pose', 'Démonstration complète', 'Pratique sur modèle', 'Obtenir un résultat naturel, propre & durable',
        'Comprendre les erreurs fréquentes & savoir les corriger', 'Conseils clients & valorisation de tes résultats 📸',
      ] }],
      includes: [
        { icon: 'livret', label: 'Livret de formation PDF' }, { icon: 'certificat', label: 'Certificat de formation' },
        { icon: 'suivi', label: 'Suivi post-formation via WhatsApp' }, { icon: 'pause', label: 'Petit-déjeuner offert à ton arrivée' },
      ],
    },
    additionalInfo: [KLARNA('166,67 €'), FOURNISSEUR, HORS_KIT],
  },
  'extensions-de-cils': {
    description: p('Apprends à créer et maîtriser tes propres bouquets Volume Russe, même si tu n’as jamais pratiqué cette technique. 🖤')
      + p('Cette formation est destinée aux professionnelles ayant déjà été formées aux extensions de cils et maîtrisant les bases de la pose, mais souhaitant apprendre le Volume Russe fait main.'),
    training: {
      format: 'Coaching individuel', durationLabel: '1 journée + ½ journée', level: 'Initiation au Volume Russe',
      prerequisites: 'Avoir été formée aux extensions de cils et maîtriser les bases de la pose',
      program: [{ title: '', items: [
        'Rappel des fondamentaux de l’extension de cils', 'Création des bouquets faits main', 'Maîtrise de l’ouverture & de la régularité',
        'Placement & direction des bouquets', 'Travail de la densité', 'Adaptation de la technique à chaque regard',
        'Erreurs fréquentes & corrections', 'Démonstration complète', 'Mise en pratique',
      ] }],
      includes: [
        { icon: 'livret', label: 'Livret de formation PDF' }, { icon: 'certificat', label: 'Certificat de formation' },
        { icon: 'suivi', label: 'Accompagnement post-formation' }, { icon: 'pause', label: 'Petit-déjeuner offert chaque matin' },
      ],
    },
    additionalInfo: ['Cette formation s’adresse aux personnes n’ayant jamais pratiqué le Volume Russe fait main.', KLARNA('216,67 €'), FOURNISSEUR],
  },
  'formation-extensions-de-cils': {
    description: p('Deux techniques complémentaires, deux jours pour apprendre à les maîtriser et être capable de proposer ces prestations à vos clientes. 🤍')
      + p('Cette formation complète vous permet d’acquérir les bases techniques nécessaires pour réaliser des poses propres, harmonieuses et adaptées à chaque regard.'),
    training: {
      format: 'Coaching individuel', durationLabel: '2 jours', level: 'Débutant à professionnel', prerequisites: 'Aucun',
      program: [
        { title: 'Cil à cil', items: [
          'Théorie & bases de l’extension de cils', 'Analyse du regard & diagnostic cliente', 'Préparation de la cliente et des cils',
          'Isolation des cils naturels', 'Placement & direction des extensions', 'Gestion du point de colle',
          'Construction d’une pose harmonieuse et équilibrée', 'Démonstration complète', 'Pratique sur modèle',
        ] },
        { title: 'Volume russe préfait', items: [
          'Compréhension de la technique', 'Analyse du regard & diagnostic', 'Préparation de la cliente', 'Isolation des cils naturels',
          'Placement, direction & adaptation des bouquets', 'Gestion du point de colle', 'Construction d’une pose harmonieuse',
          'Démonstration complète', 'Pratique sur modèle',
        ] },
      ],
      includes: [
        { icon: 'livret', label: 'Livret de formation PDF' }, { icon: 'certificat', label: 'Certificat de formation' },
        { icon: 'suivi', label: 'Accompagnement post-formation' }, { icon: 'pause', label: 'Petit-déjeuner offert chaque matin' },
      ],
    },
    additionalInfo: [KLARNA('266,67 €'), FOURNISSEUR, HORS_KIT],
  },
  'pack-formation-complet': {
    description: p('La formation complète pour maîtriser les techniques essentielles de l’embellissement du regard et développer une offre complète dans ton activité. 🤍')
      + p('Un parcours de 3 jours pour apprendre à réaliser des prestations propres, naturelles et professionnelles, du Lash Lift aux extensions de cils.')
      + p('Un parcours complet pour développer plusieurs prestations et construire une véritable offre autour du regard. 🖤'),
    training: {
      format: 'Coaching individuel', durationLabel: '3 jours', level: 'Débutant', prerequisites: 'Aucun',
      program: [
        { title: 'Korean Lash Lift & Teinture', items: ['Théorie & compréhension de la technique', 'Maîtrise des différentes étapes', 'Gestion des temps de pose', 'Démonstration & pratique sur modèle'] },
        { title: 'Extensions — Cil à cil', items: ['Bases de l’extension de cils', 'Analyse du regard & diagnostic', 'Isolation, placement & direction', 'Gestion du point de colle', 'Construction d’une pose harmonieuse', 'Démonstration & pratique sur modèle'] },
        { title: 'Volume russe préfait', items: ['Compréhension de la technique', 'Placement & direction des bouquets', 'Adaptation au regard', 'Travail de la densité', 'Démonstration & pratique sur modèle'] },
      ],
      includes: [
        { icon: 'livret', label: 'Livret(s) de formation PDF' }, { icon: 'certificat', label: 'Certificat(s) de formation' },
        { icon: 'suivi', label: 'Accompagnement post-formation' }, { icon: 'pause', label: 'Petit-déjeuner offert chaque matin' },
      ],
    },
    additionalInfo: [KLARNA('383,33 €'), FOURNISSEUR, 'Tarif hors kit : possibilité d’ajouter le ou les kits de formation en supplément.'],
  },
  'perfectionnement-korean-lash-lift-teinture': {
    description: p('Une demi-journée pour perfectionner ta technique, gagner en confiance et obtenir des résultats précis et durables.')
      + p('Que tu aies déjà été formée en présentiel ou en ligne, mais que tu rencontres encore des difficultés dans ta pratique, ce perfectionnement te permet de retravailler ta méthode et de maîtriser chaque étape avec plus de précision. 🤍'),
    training: {
      format: 'Coaching individuel', durationLabel: '½ journée', level: 'Professionnel déjà formé',
      prerequisites: 'Avoir déjà suivi une formation Korean Lash Lift, en présentiel ou en ligne',
      program: [{ title: '', items: [
        'Révision des étapes clés du Korean Lash Lift', 'Analyse de ta méthode et de tes gestes techniques',
        'Démonstration complète réalisée par mes soins sur un premier modèle', 'Pratique encadrée sur deux modèles',
        'Maîtrise complète de la technique et du protocole', 'Ajustement des gestes techniques & correction des erreurs',
        'Conseils personnalisés pour gagner en précision, en confiance et en régularité 📸',
      ] }],
      includes: [
        { icon: 'livret', label: 'Livret de formation PDF' }, { icon: 'certificat', label: 'Certificat de perfectionnement' },
        { icon: 'suivi', label: 'Suivi post-formation via WhatsApp' }, { icon: 'pause', label: 'Petit-déjeuner offert à ton arrivée' },
      ],
    },
    additionalInfo: [KLARNA('83,33 €'), FOURNISSEUR, HORS_KIT],
  },
  'formation-en-ligne-korean-lash-lift-teinture': {
    description: p('Maîtrise une technique innovante pour sublimer le regard avec un résultat naturel, précis et durable.')
      + p('Que tu sois débutante ou professionnelle, cette formation te transmet les connaissances et les techniques essentielles pour réaliser un Korean Lash Lift dans les règles de l’art.')
      + p('Beauty Savage Academy — forme-toi à ton rythme, développe ton expertise et fais évoluer ton activité.'),
    training: {
      format: 'Formation en ligne', durationLabel: 'À ton rythme', level: 'Débutant à professionnel', prerequisites: 'Aucun',
      program: [{ title: '', items: [
        'Théorie & compréhension de la technique Korean Lash Lift', 'Présentation du matériel et des produits nécessaires',
        'Analyse du regard et adaptation selon la nature des cils',
        'Protocole complet : préparation du cil, placement des shields, application des produits, fixation et teinture',
        'Démonstration complète de la prestation sur modèle', 'Finalisation et conseils d’entretien après prestation',
      ] }],
      includes: [
        { icon: 'livret', label: 'Livret pédagogique PDF' }, { icon: 'certificat', label: 'Certificat de formation' },
        { icon: 'acces', label: 'Accès à vie à ton espace de formation' }, { icon: 'video', label: 'Vidéos 24h/24, à ton rythme' },
        { icon: 'maj', label: 'Accès aux mises à jour pédagogiques' },
      ],
    },
    additionalInfo: ['-20 % sur ta première commande auprès de notre fournisseur partenaire, avec code promo.', 'Paiement en 3 fois sans frais avec Klarna, sous réserve d’éligibilité.'],
  },
  'boost-reseau-sociaux': {
    description: p('Construis une image qui te ressemble.')
      + p('Les réseaux sociaux sont aujourd’hui un véritable outil pour développer son activité. Pourtant, trouver son identité visuelle, savoir quoi publier et créer une communication cohérente n’est pas toujours évident.')
      + p('Cet accompagnement a été pensé pour t’aider à affirmer ton identité professionnelle, créer ton propre univers et apprendre à valoriser ton travail à travers les réseaux sociaux.')
      + p('L’idée : t’aider à développer une présence en ligne qui te ressemble et à faire des réseaux sociaux un véritable atout pour ton activité.')
      + p('💌 Une question ? Tu peux me contacter directement par mail ou sur Instagram. Je serai ravie d’échanger avec toi !'),
    training: {
      format: 'Accompagnement individuel', durationLabel: '3 mois',
      includes: [
        { icon: 'appel', label: 'Un premier rendez-vous téléphonique pour faire le point' },
        { icon: 'livret', label: 'Un livret pédagogique avec conseils et outils concrets' },
        { icon: 'suivi', label: 'Un suivi individuel sur WhatsApp pendant 3 mois' },
        { icon: 'appel', label: '3 rendez-vous téléphoniques individuels, un par mois' },
      ],
    },
    additionalInfo: ['Possibilité de régler ton accompagnement en 3 fois sans frais avec Klarna.'],
  },
};

/* ── Les prestations : paragraphes qui changent de place ───────────────────── */

const PEDICURE = ['Cette prestation ne comprend pas le travail des callosités.'];
const DEPOSE_EXT = 'Dépose extérieure : la dépose d’un semi-permanent réalisé dans un autre salon est à ajouter à la prestation lors de la réservation.';
const REMPLISSAGE = [
  'Jusqu’à 2 semaines après votre pose : remplissage 2 semaines. Au-delà, sélectionnez le remplissage 3 semaines lors de la prise de rendez-vous.',
  'Pour un remplissage, il doit rester suffisamment d’extensions sur les cils naturels. Si la pose est trop clairsemée, une nouvelle pose pourra être nécessaire.',
];
const PACK_SUPPLEMENT = ['À prévoir en supplément : pour une French, une dépose extérieure ou une dépose réalisée au salon, sélectionnez la prestation complémentaire correspondante afin de prévoir le temps nécessaire au rendez-vous.'];

const MOVED = ['⚠️', '📅', '⏳', 'À prévoir en supplément', 'Si vous souhaitez ensuite réaliser'];

export const SERVICES = {
  'korean-lash-lift': { longevity: '6 à 8 semaines', additionalInfo: ['Tenue selon le cycle naturel de vos cils ; la teinture s’estompe progressivement au fil des semaines.'] },
  'korean-lash-lift-2': { longevity: '6 à 8 semaines', additionalInfo: ['Tenue selon le cycle naturel de vos cils.'] },
  'pose-regard-pure': { longevity: '3 à 4 semaines', additionalInfo: ['Un entretien régulier est recommandé pour conserver une belle densité au fil du cycle naturel des cils.'] },
  'extensions-pose-signature': { longevity: '3 à 4 semaines', additionalInfo: ['Des remplissages réguliers sont recommandés pour conserver une belle densité au fil du cycle naturel des cils.'] },
  'pedicure-express-semi-permanent': { additionalInfo: [...PEDICURE, DEPOSE_EXT] },
  'pedicure-russe-semi-permanent': { additionalInfo: [...PEDICURE, DEPOSE_EXT] },
  'pedicure-russe': { additionalInfo: ['Cette prestation ne comprend pas le travail des callosités, ni de pose de vernis ou de semi-permanent.'] },
  'depose-du-salon-pedicure-russe-semi-permanent': { additionalInfo: PEDICURE },
  'depose-du-salon-pedicure-express-semi-permanent': { additionalInfo: PEDICURE },
  'depose-exterieur-pedicure-express-semi-permanent': { additionalInfo: PEDICURE },
  'depose-exterieur-pedicure-russe-semi-permanent': { additionalInfo: PEDICURE },
  'depose-semi-permanent': { additionalInfo: [
    'Cette prestation ne comprend pas de pédicure, de travail des cuticules, de mise en forme ou de nouvelle pose.',
    'Pour une nouvelle prestation ensuite, sélectionnez la prestation correspondante lors de votre réservation.',
  ] },
  'pack-korean-glow': { additionalInfo: PACK_SUPPLEMENT },
  'pack-signature': { additionalInfo: PACK_SUPPLEMENT },
  'pack-elegance': { additionalInfo: PACK_SUPPLEMENT },
  ...Object.fromEntries(['remplissage-2-semaines', 'remplissage-2-semaines-2', 'remplissage-2-semaines-3', 'remplissage-2-semaines-4', 'remplissage-2-semaines-5',
    'remplissage-3-semaines', 'remplissage-3-semaines-2', 'remplissage-3-semaines-3', 'remplissage-3-semaines-4', 'remplissage-3-semaines-5']
    .map((slug) => [slug, { additionalInfo: REMPLISSAGE }])),
};

/* ── Le découpage en paragraphes ───────────────────────────────────────────── */

const textOf = (html) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Retire les paragraphes (p / div) dont le texte commence par un marqueur « qui change de place ». */
export function withoutMovedParagraphs(html) {
  const blocks = String(html || '').split(/(<(?:p|div)\b[^>]*>[\s\S]*?<\/(?:p|div)>)/i);
  const removed = [];
  const kept = blocks.filter((block) => {
    if (!/^<(p|div)\b/i.test(block)) return true;
    const text = textOf(block);
    if (MOVED.some((marker) => text.startsWith(marker))) { removed.push(text); return false; }
    return true;
  });
  // Les paragraphes vides laissés en fin de texte (« <div><br></div> ») partent avec.
  let out = kept.join('');
  out = out.replace(/(\s*<(p|div)\b[^>]*>(\s|<br\s*\/?>|&nbsp;)*<\/\2>\s*)+$/i, '').trim();
  return { html: out, removed };
}

/* ── Exécution ─────────────────────────────────────────────────────────────── */

async function main() {
  require('dotenv').config();
  const { MongoClient } = require('mongodb');
  const env = String(process.env.ENV || 'TEST').toUpperCase();
  const dbName = arg('--db') || (env === 'PROD' ? process.env.DB_PROD : process.env.DB_TEST);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db(dbName).collection('commerceproducts');
  console.log(`${apply ? 'APPLICATION' : 'SIMULATION'} sur la base « ${dbName} » (ENV=${env})`);
  const backup = [];
  let changed = 0;

  for (const [slug, spec] of Object.entries(TRAININGS)) {
    const doc = await col.findOne({ slug });
    if (!doc) { console.log(`  · ${slug} : absent`); continue; }
    if (Array.isArray(doc.training?.program) && doc.training.program.length) { console.log(`  · ${slug} : déjà structurée`); continue; }
    const training = { ...(doc.training || {}), ...spec.training };
    backup.push({ slug, description: doc.description, training: doc.training, additionalInfo: doc.additionalInfo, service: doc.service });
    console.log(`  ✓ ${slug} : description ${textOf(doc.description || '').length} → ${textOf(spec.description).length} car., programme ${(spec.training.program || []).reduce((n, s) => n + s.items.length, 0)} points, ${spec.training.includes.length} inclus, ${spec.additionalInfo.length} bon à savoir`);
    if (apply) await col.updateOne({ _id: doc._id }, { $set: { description: spec.description, training, additionalInfo: spec.additionalInfo, updatedAt: new Date() } });
    changed += 1;
  }

  for (const [slug, spec] of Object.entries(SERVICES)) {
    const doc = await col.findOne({ slug });
    if (!doc) { console.log(`  · ${slug} : absent`); continue; }
    const { html, removed } = withoutMovedParagraphs(doc.description);
    if (!removed.length) { console.log(`  · ${slug} : rien à déplacer (déjà fait ?)`); continue; }
    backup.push({ slug, description: doc.description, training: doc.training, additionalInfo: doc.additionalInfo, service: doc.service });
    const set = { description: html, additionalInfo: spec.additionalInfo, updatedAt: new Date() };
    if (spec.longevity) set.service = { ...(doc.service || {}), longevity: spec.longevity };
    console.log(`  ✓ ${slug} : ${removed.length} paragraphe(s) déplacé(s) [${removed.map((t) => t.slice(0, 40)).join(' | ')}]${spec.longevity ? ` · tenue ${spec.longevity}` : ''}`);
    if (apply) await col.updateOne({ _id: doc._id }, { $set: set });
    changed += 1;
  }

  const file = arg('--backup');
  if (file && backup.length) { fs.writeFileSync(file, JSON.stringify(backup, null, 1)); console.log(`Sauvegarde de l'état d'avant : ${file}`); }
  console.log(`${changed} fiche(s) ${apply ? 'mises à jour' : 'à mettre à jour'}.`);
  await client.close();
}

if (process.argv[1] && process.argv[1].endsWith('seed-fiches-structurees-2026-11-13.js')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
