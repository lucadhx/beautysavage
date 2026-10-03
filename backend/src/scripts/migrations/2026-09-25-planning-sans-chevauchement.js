#!/usr/bin/env node
// MIGRATION — le planning de démonstration cesse de se chevaucher.
//
//   node src/scripts/migrations/2026-09-25-planning-sans-chevauchement.js           # diagnostic seul
//   node src/scripts/migrations/2026-09-25-planning-sans-chevauchement.js --apply   # corrige
//
// ══ CE QU'ELLE CORRIGE ══════════════════════════════════════════════════════
//
// Une base seedée avant ce lot contient des chevauchements que l'application
// interdit pourtant : la session présentielle posée sur quatre rendez-vous,
// le rendez-vous « Client Mail » sur deux autres, et des « formations »
// stockées comme de simples rendez-vous. Elle refait le planning de DÉMO avec
// la règle de `scripts/lib/demoCalendar.js` — la même que le seed.
//
// Elle répare aussi la soumission de démonstration : ses photos pointaient vers
// `/demo/livrables/*.jpg`, fichiers qui n'ont jamais existé, et son score sans
// détail affichait « 0 / 4 » sur les bonnes réponses.
//
// ══ CE QU'ELLE NE TOUCHE PAS ════════════════════════════════════════════════
//
// Aucun rendez-vous RÉEL. Seuls sont réécrits : les événements marqués
// `source.demoPlanning`, celui marqué `source.demoKey`, les sessions de la
// fiche de démo présentielle, et les soumissions de la cliente de démo. Un
// chevauchement entre deux rendez-vous réels est RAPPORTÉ, jamais « réparé » :
// décider lequel déplacer appartient à l'institut.
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { Customer } from '../../models/Customer.model.js';
import { CommerceProduct } from '../../models/CommerceProduct.model.js';
import { TrainingSubmission } from '../../models/TrainingSubmission.model.js';
import { scoreEvaluationSubmission } from '../../services/commerce.service.js';
import {
  DEMO_DELIVERABLE_IMAGES,
  findCalendarOverlaps,
  nextMonday,
  placeDemoAppointment,
  relocateDemoKeyedEvents,
  relocateSeededSessions,
  seedDenseCalendar,
  seedPresentielSessions,
} from '../lib/demoCalendar.js';

const APPLY = process.argv.includes('--apply');

function describe(pairs) {
  return pairs.map(([a, b]) => `  - ${a.label} (${a.startsAt.toISOString()} -> ${a.endsAt.toISOString()})\n    x ${b.label} (${b.startsAt.toISOString()} -> ${b.endsAt.toISOString()})`).join('\n');
}

async function repairDemoSubmissions(client) {
  const submissions = await TrainingSubmission.find({ customerId: client._id }).populate('productId', 'evaluation');
  let repaired = 0;
  for (const submission of submissions) {
    const deliverables = submission.deliverablesSnapshot || {};
    const face = deliverables.liv_photo_face;
    let changed = false;
    if (face?.before?.url?.startsWith('/demo/livrables/')) {
      face.before.url = DEMO_DELIVERABLE_IMAGES.before;
      face.after.url = DEMO_DELIVERABLE_IMAGES.after;
      changed = true;
    }
    if (Array.isArray(deliverables.liv_galerie_modele) && deliverables.liv_galerie_modele.some((item) => item?.url?.startsWith('/demo/livrables/'))) {
      deliverables.liv_galerie_modele = deliverables.liv_galerie_modele.map((item, index) => ({
        ...item,
        url: index % 2 ? DEMO_DELIVERABLE_IMAGES.gallery2 : DEMO_DELIVERABLE_IMAGES.gallery1,
      }));
      changed = true;
    }
    const score = submission.scoreSnapshot || {};
    if (!Array.isArray(score.details) || score.details.length === 0) {
      submission.scoreSnapshot = scoreEvaluationSubmission(submission.productId?.evaluation || {}, submission.answersSnapshot || {});
      changed = true;
    }
    if (changed) {
      submission.deliverablesSnapshot = { ...deliverables };
      submission.markModified('deliverablesSnapshot');
      submission.markModified('scoreSnapshot');
      await submission.save();
      repaired += 1;
    }
  }
  return repaired;
}

async function main() {
  await connectDatabase();
  const before = await findCalendarOverlaps();
  console.log(`Chevauchements AVANT : ${before.length}`);
  if (before.length) console.log(describe(before.slice(0, 40)));

  if (!APPLY) {
    console.log('\nDiagnostic seul. Relancer avec --apply pour corriger le planning de demonstration.');
    return;
  }

  const client = await Customer.findOne({ email: 'client@mail.com' });
  if (!client) {
    console.log('Cliente de demonstration absente : aucune donnee de demo a corriger.');
  } else {
    const base = nextMonday();
    const presentiel = await seedPresentielSessions(base);
    console.log(presentiel
      ? `Sessions presentielles de demo : ${presentiel.sessions.map((s) => s.startsAt.toISOString()).join(', ')}`
      : 'Fiche presentielle de demo absente.');
    for (const move of await relocateSeededSessions()) {
      console.log(`Session seedee deplacee : ${move.title} ${new Date(move.from).toISOString()} -> ${move.to.toISOString()}`);
    }
    const appointment = await placeDemoAppointment(client, base);
    if (appointment) console.log(`Rendez-vous « Client Mail » : ${appointment.startsAt.toISOString()}`);
    for (const move of await relocateDemoKeyedEvents()) {
      console.log(`Rendez-vous de demo deplace : ${move.title} ${new Date(move.from).toISOString()} -> ${move.to.toISOString()}`);
    }
    const planning = await seedDenseCalendar(client, base);
    console.log(`Planning dense : ${planning.created} rendez-vous poses, ${planning.skipped} creneaux laisses libres.`);
    console.log(`Soumissions de demo reparees : ${await repairDemoSubmissions(client)}`);
  }

  const after = await findCalendarOverlaps();
  console.log(`\nChevauchements APRES : ${after.length}`);
  if (after.length) {
    console.log(describe(after));
    process.exitCode = 1;
  }
  // Rappel utile : les fiches presentielles hors demo gardent leurs sessions.
  const others = await CommerceProduct.countDocuments({ kind: 'IN_PERSON_TRAINING', 'sessions.0': { $exists: true } });
  console.log(`Fiches presentielles avec sessions : ${others}`);
}

main()
  .catch((err) => {
    console.error('Migration echouee :', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => null);
    // Un script de console a une duree de vie COURTE : voir deploy-drive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
