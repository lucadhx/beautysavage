// Seed idempotent de 2 FORMATIONS DISTANCIELLES complètes :
//   - formation (publiée, distanciel) ;
//   - modules vidéo (Chapitre → Leçon avec videoUrl YouTube, titre + description) ;
//   - questionnaire (EvaluationDefinition, sections/questions, actif) ;
//   - rendus = photo avant/après UNIQUEMENT (aucune vidéo).
//
// Idempotent : relançable sans dupliquer. Les chapitres/leçons de CES formations sont réécrits
// (supprimés puis recréés) à chaque exécution — non destructif pour les autres formations.
//
//   node scripts/seedDistancielFormations.js
import 'dotenv/config';
import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import Chapter from '../models/Chapter.js';
import Lesson from '../models/Lesson.js';
import EvaluationDefinition from '../models/EvaluationDefinition.js';

// ── Fabriques questionnaire ────────────────────────────────────────────────────────
const tf = (prompt, correctBoolean, order) => ({ type: 'true_false', prompt, required: true, correctBoolean, order });
const quiz = (prompt, mode, answers, order) => ({
  type: 'quiz',
  prompt,
  required: true,
  mode,
  order,
  answers: answers.map(([text, correct], i) => ({ text, correct, order: i }))
});

// Un seul rendu, photo avant/après, pour toutes les formations distancielles seedées.
const photoDeliverable = [
  {
    type: 'photo_before_after',
    title: 'Photo avant / après',
    description: 'Envoyez une photo nette de votre travail : le regard (ou les sourcils) avant, puis après la prestation.',
    required: true,
    order: 0
  }
];

// ── Définition des 2 formations ────────────────────────────────────────────────────
const FORMATIONS = [
  {
    name: 'Volume Russe — Extensions de Cils (en ligne)',
    price: 490,
    description:
      'Formation distancielle complète au Volume Russe : matériel, sécurité, création des bouquets 3D à 6D, ' +
      'isolation, placement et protocole de pose en cabine. Accès à vie aux vidéos, questionnaire de validation et rendu photo.',
    chapters: [
      {
        title: 'Fondamentaux du Volume Russe',
        description: 'Le matériel indispensable, l’hygiène et l’anatomie du cil naturel.',
        lessons: [
          { title: 'Introduction & matériel', description: 'Tour d’horizon du kit : pinces, cils, colle, primer et coussin de pose.', videoUrl: 'https://www.youtube.com/watch?v=ScMzIvxBSi4', estimatedMinutes: 9, isFree: true },
          { title: 'Anatomie du cil & règles de sécurité', description: 'Cycle de vie du cil, contre-indications et prévention des allergies à la colle.', videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', estimatedMinutes: 12 }
        ]
      },
      {
        title: 'Créer et poser les bouquets',
        description: 'Le geste central du Volume Russe : réaliser un bouquet régulier et l’isoler.',
        lessons: [
          { title: 'Réaliser un bouquet 3D à 6D', description: 'Prise en main de la pince, formation d’un éventail symétrique et calibrage du volume.', videoUrl: 'https://www.youtube.com/watch?v=hY7m5jjJ9mM', estimatedMinutes: 15 },
          { title: 'Isolation & placement', description: 'Isoler le cil naturel, doser la colle et placer le bouquet à la bonne distance de la paupière.', videoUrl: 'https://www.youtube.com/watch?v=eIho2S0ZahI', estimatedMinutes: 14 }
        ]
      },
      {
        title: 'Protocole complet en cabine',
        description: 'Enchaîner une pose complète sur modèle, puis la dépose et l’entretien.',
        lessons: [
          { title: 'Pose pas à pas sur modèle', description: 'Déroulé d’une prestation de A à Z : préparation, mapping, pose et contrôle final.', videoUrl: 'https://www.youtube.com/watch?v=WPni755-Krg', estimatedMinutes: 22 },
          { title: 'Dépose, remplissage & entretien', description: 'Retirer les extensions sans abîmer le cil, planifier les remplissages et conseiller la cliente.', videoUrl: 'https://www.youtube.com/watch?v=RgKAFK5djSk', estimatedMinutes: 11 }
        ]
      }
    ],
    sections: [
      {
        title: 'Théorie & sécurité',
        description: 'Bases indispensables avant de toucher au moindre cil.',
        order: 0,
        questions: [
          tf('Le Volume Russe consiste à poser un bouquet de plusieurs extensions fines sur UN seul cil naturel.', true, 0),
          tf('On peut poser des extensions sur un cil en phase de chute imminente sans aucun risque.', false, 1),
          quiz('Quelle est la contre-indication la plus fréquente à la pose d’extensions ?', 'single', [
            ['Une allergie au cyanoacrylate (colle)', true],
            ['Des yeux marron', false],
            ['Des cils blonds', false],
            ['Le port de lunettes', false]
          ], 2)
        ]
      },
      {
        title: 'Technique des bouquets',
        description: 'Maîtrise du geste et du matériel.',
        order: 1,
        questions: [
          quiz('Quels éléments influencent la tenue d’un bouquet ? (plusieurs réponses)', 'multiple', [
            ['La quantité de colle déposée', true],
            ['La bonne isolation du cil naturel', true],
            ['La couleur des murs de la cabine', false],
            ['Le calibrage / l’épaisseur des extensions', true]
          ], 0),
          tf('Un excès de colle fragilise la tenue et peut coller plusieurs cils entre eux.', true, 1)
        ]
      },
      {
        title: 'Cabine & entretien',
        description: 'Prestation complète et suivi de la cliente.',
        order: 2,
        questions: [
          quiz('À quel rythme conseille-t-on généralement un remplissage ?', 'single', [
            ['Toutes les semaines', false],
            ['Toutes les 2 à 3 semaines', true],
            ['Tous les 6 mois', false],
            ['Jamais', false]
          ], 0),
          tf('La dépose se fait à l’aide d’un remover adapté, jamais en tirant sur les extensions.', true, 1)
        ]
      }
    ]
  },
  {
    name: 'Microblading — Sourcils Poil à Poil (en ligne)',
    price: 690,
    description:
      'Formation distancielle au microblading : hygiène et stérilisation, visagisme et symétrie, tracé, ' +
      'technique poil à poil et cicatrisation. Vidéos accessibles à vie, questionnaire de validation et rendu photo avant/après.',
    chapters: [
      {
        title: 'Bases & hygiène',
        description: 'Comprendre la technique et travailler dans des conditions d’hygiène irréprochables.',
        lessons: [
          { title: 'Principe du microblading', description: 'Différence entre microblading, maquillage permanent et tatouage ; profondeur et pigments.', videoUrl: 'https://www.youtube.com/watch?v=ScMzIvxBSi4', estimatedMinutes: 10, isFree: true },
          { title: 'Hygiène & stérilisation', description: 'Poste de travail, usage unique, désinfection et gestion des déchets piquants.', videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', estimatedMinutes: 13 }
        ]
      },
      {
        title: 'Morphologie & tracé',
        description: 'Dessiner des sourcils harmonieux, adaptés au visage.',
        lessons: [
          { title: 'Visagisme & symétrie', description: 'Points de mesure (départ, arche, fin) et adaptation à la morphologie du visage.', videoUrl: 'https://www.youtube.com/watch?v=hY7m5jjJ9mM', estimatedMinutes: 16 },
          { title: 'Dessiner le tracé (mapping)', description: 'Tracer le gabarit au compas et au crayon, valider avec la cliente avant de commencer.', videoUrl: 'https://www.youtube.com/watch?v=eIho2S0ZahI', estimatedMinutes: 12 }
        ]
      },
      {
        title: 'Réalisation & cicatrisation',
        description: 'Le geste poil à poil, puis le suivi de cicatrisation et la retouche.',
        lessons: [
          { title: 'Technique poil à poil', description: 'Sens des incisions, pression, régularité et création d’un rendu naturel.', videoUrl: 'https://www.youtube.com/watch?v=WPni755-Krg', estimatedMinutes: 20 },
          { title: 'Cicatrisation & retouche', description: 'Consignes post-soin à la cliente et retouche à 4-6 semaines.', videoUrl: 'https://www.youtube.com/watch?v=RgKAFK5djSk', estimatedMinutes: 10 }
        ]
      }
    ],
    sections: [
      {
        title: 'Hygiène & sécurité',
        description: 'Le socle réglementaire et sanitaire du microblading.',
        order: 0,
        questions: [
          tf('Le matériel en contact avec la peau (lames, aiguilles) est à usage unique.', true, 0),
          tf('Le microblading dépose le pigment aussi profondément qu’un tatouage classique.', false, 1),
          quiz('Que doit-on TOUJOURS faire avant de commencer un tracé sur la cliente ?', 'single', [
            ['Faire valider le dessin / la forme par la cliente', true],
            ['Retirer ses gants', false],
            ['Sauter l’étape de désinfection si la peau paraît propre', false],
            ['Choisir un pigment au hasard', false]
          ], 2)
        ]
      },
      {
        title: 'Visagisme & tracé',
        description: 'Construire une forme harmonieuse et symétrique.',
        order: 1,
        questions: [
          quiz('Quels points servent de repères pour construire la forme du sourcil ? (plusieurs réponses)', 'multiple', [
            ['Le départ (tête)', true],
            ['Le point le plus haut (arche)', true],
            ['La couleur des yeux', false],
            ['La fin (queue)', true]
          ], 0),
          tf('La symétrie parfaite se mesure au compas / à la règle, pas seulement à l’œil.', true, 1)
        ]
      },
      {
        title: 'Réalisation & suivi',
        description: 'Geste, cicatrisation et retouche.',
        order: 2,
        questions: [
          tf('Une retouche est généralement prévue 4 à 6 semaines après la première séance.', true, 0),
          quiz('Un bon rendu « poil à poil » dépend principalement de…', 'single', [
            ['La régularité, le sens et la finesse des incisions', true],
            ['La quantité de pigment appliquée en surface', false],
            ['La vitesse d’exécution uniquement', false],
            ['La marque du crayon de dessin', false]
          ], 1)
        ]
      }
    ]
  }
];

async function seedFormation(spec) {
  // 1) Formation (idempotent par nom), publiée + distanciel.
  let formation = await Formation.findOne({ name: spec.name });
  if (!formation) {
    formation = await Formation.create({
      name: spec.name,
      description: spec.description,
      type: 'distanciel',
      durationDays: 1,
      price: spec.price,
      accessDeliveryMode: 'manual',
      accessLifetime: true,
      status: 'published',
      active: true
    });
    console.log(`  Formation créée : ${formation.name} (${formation._id}).`);
  } else {
    formation.description = spec.description;
    formation.type = 'distanciel';
    formation.price = spec.price;
    formation.status = 'published';
    formation.active = true;
    await formation.save();
    console.log(`  Formation existante mise à jour : ${formation.name} (${formation._id}).`);
  }

  // 2) Modules vidéo : on réécrit chapitres + leçons de CETTE formation (idempotent, non destructif ailleurs).
  await Lesson.deleteMany({ formationId: formation._id });
  await Chapter.deleteMany({ formationId: formation._id });

  let chapterOrder = 0;
  let totalLessons = 0;
  for (const ch of spec.chapters) {
    const chapter = await Chapter.create({
      formationId: formation._id,
      title: ch.title,
      description: ch.description,
      order: chapterOrder++,
      visible: true
    });
    let lessonOrder = 0;
    for (const ls of ch.lessons) {
      await Lesson.create({
        formationId: formation._id,
        chapterId: chapter._id,
        title: ls.title,
        description: ls.description,
        videoUrl: ls.videoUrl,
        resources: [],
        order: lessonOrder++,
        visible: true,
        isFree: Boolean(ls.isFree),
        estimatedMinutes: ls.estimatedMinutes || 0
      });
      totalLessons++;
    }
  }

  // 3) Questionnaire + rendu photo (idempotent par formationId).
  let def = await EvaluationDefinition.findOne({ formationId: formation._id });
  if (!def) def = new EvaluationDefinition({ formationId: formation._id });
  def.active = true;
  def.sections = spec.sections;
  def.deliverables = photoDeliverable;
  def.isDeleted = false;
  def.deletedAt = null;
  await def.save();

  const questionCount = spec.sections.reduce((n, s) => n + s.questions.length, 0);
  console.log(
    `  Modules : ${spec.chapters.length} chapitres / ${totalLessons} leçons vidéo. ` +
    `Questionnaire : ${spec.sections.length} sections / ${questionCount} questions + 1 rendu photo.`
  );
}

async function seed() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, {
    dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database'
  });
  console.log('Connexion MongoDB — seed formations distancielles.');

  for (const spec of FORMATIONS) {
    console.log(`\n▶ ${spec.name}`);
    await seedFormation(spec);
  }

  await mongoose.disconnect();
  console.log('\nSeed terminé.');
}

seed().catch((err) => {
  console.error('Seed formations distancielles échoué', err);
  process.exit(1);
});
