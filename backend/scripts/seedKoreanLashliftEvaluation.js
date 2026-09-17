// FORMATION-EVALUATION — Seed idempotent d'un questionnaire sur « Korean Lash Lift ».
//
// Un questionnaire (EvaluationDefinition) s'attache à une FORMATION (formationId requis + unique).
// Ce script garantit donc l'existence de la formation « Korean Lash Lift » (présentielle) puis
// (ré)écrit son questionnaire actif + un rendu photo avant/après.
//
// Idempotent : relançable sans dupliquer (upsert par nom de formation / par formationId).
// Non destructif pour le reste : ne touche qu'à cette formation et à sa définition d'évaluation.
//
//   node scripts/seedKoreanLashliftEvaluation.js
import 'dotenv/config';
import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import EvaluationDefinition from '../models/EvaluationDefinition.js';

const FORMATION_NAME = 'Korean Lash Lift';

// Fabriques concises pour garder la définition lisible.
const tf = (prompt, correctBoolean, order) => ({ type: 'true_false', prompt, required: true, correctBoolean, order });
const quiz = (prompt, mode, answers, order) => ({
  type: 'quiz',
  prompt,
  required: true,
  mode,
  order,
  answers: answers.map(([text, correct], i) => ({ text, correct, order: i }))
});

const sections = [
  {
    title: 'Théorie & hygiène',
    description: 'Comprendre le principe du rehaussement et les règles d’hygiène.',
    order: 0,
    questions: [
      tf('Le lash lifting rehausse et courbe les cils naturels, sans pose d’extensions.', true, 0),
      tf('Le rehaussement s’applique sur des cils parfaitement démaquillés et dégraissés.', true, 1),
      quiz(
        'Quelle est la durée de tenue moyenne d’un lash lift ?',
        'single',
        [
          ['1 à 2 semaines', false],
          ['6 à 8 semaines', true],
          ['6 mois', false],
          ['1 an', false]
        ],
        2
      )
    ]
  },
  {
    title: 'Produits & temps de pose',
    description: 'Ordre des lotions et facteurs qui font varier le temps de pose.',
    order: 1,
    questions: [
      quiz(
        'Une fois le cil plaqué sur le bomboir en silicone, quelle lotion applique-t-on en PREMIER ?',
        'single',
        [
          ['La lotion 1 – solution permanente (redressement)', true],
          ['La lotion 2 – fixateur', false],
          ['Le soin nourrissant / huile de finition', false],
          ['Le démaquillant biphasé', false]
        ],
        0
      ),
      quiz(
        'Quels facteurs influencent le temps de pose de la lotion ? (plusieurs réponses)',
        'multiple',
        [
          ['L’épaisseur et la nature du cil', true],
          ['La marque et la concentration des produits', true],
          ['La couleur des yeux de la cliente', false],
          ['La météo du jour', false]
        ],
        1
      ),
      tf('Un temps de pose trop long peut fragiliser et casser les cils.', true, 2)
    ]
  },
  {
    title: 'Gestes & sécurité',
    description: 'Bons gestes et conduite à tenir en cas d’incident.',
    order: 2,
    questions: [
      tf('La lotion de rehaussement peut être appliquée directement sur la peau de la paupière.', false, 0),
      tf('En cas de contact du produit avec l’œil, on rince immédiatement et abondamment à l’eau claire.', true, 1),
      quiz(
        'Quel geste plaque correctement le cil sur le bomboir en silicone ?',
        'single',
        [
          ['Peigner le cil vers le haut avec un outil de lift / bâtonnet applicateur', true],
          ['Tirer le cil avec une pince à extensions', false],
          ['Brosser à sec avec un goupillon', false],
          ['Frotter avec un coton-tige imbibé de démaquillant', false]
        ],
        2
      )
    ]
  }
];

const deliverables = [
  {
    type: 'photo_before_after',
    title: 'Photo avant / après',
    description: 'Envoyez une photo nette du regard avant puis après le rehaussement.',
    required: true,
    order: 0
  }
];

async function seed() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  console.log('Connexion MongoDB — seed questionnaire Korean Lash Lift.');

  // 1) Formation support (idempotent par nom).
  let formation = await Formation.findOne({ name: FORMATION_NAME });
  if (!formation) {
    formation = await Formation.create({
      name: FORMATION_NAME,
      description:
        'Formation présentielle au rehaussement de cils coréen (Korean Lash Lift) : théorie, hygiène, protocole produits et gestes techniques.',
      type: 'presentiel',
      durationDays: 1,
      price: 350,
      status: 'draft',
      active: true
    });
    console.log(`Formation créée : ${formation.name} (${formation._id}).`);
  } else {
    console.log(`Formation existante réutilisée : ${formation.name} (${formation._id}).`);
  }

  // 2) Questionnaire (idempotent par formationId). save() régénère les _id de sous-documents.
  let def = await EvaluationDefinition.findOne({ formationId: formation._id });
  if (!def) def = new EvaluationDefinition({ formationId: formation._id });
  def.active = true;
  def.sections = sections;
  def.deliverables = deliverables;
  def.isDeleted = false;
  def.deletedAt = null;
  await def.save();

  const questionCount = sections.reduce((n, s) => n + s.questions.length, 0);
  console.log(
    `Questionnaire enregistré : ${sections.length} sections, ${questionCount} questions, ${deliverables.length} rendu(s). Actif = ${def.active}.`
  );

  await mongoose.disconnect();
  console.log('Seed terminé.');
}

seed().catch((err) => {
  console.error('Seed Korean Lash Lift échoué', err);
  process.exit(1);
});
