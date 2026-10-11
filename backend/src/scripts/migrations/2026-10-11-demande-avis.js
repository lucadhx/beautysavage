#!/usr/bin/env node
// MIGRATION — une demande d'avis configurée sur toutes les prestations et formations.
//
//   node src/scripts/migrations/2026-10-11-demande-avis.js --db beauty_savage_prod           # diagnostic seul
//   node src/scripts/migrations/2026-10-11-demande-avis.js --db beauty_savage_prod --apply   # écrit
//
// Pose le réglage d'usine (e-mail 2 h après, relance à 48 h, puis à 1 semaine)
// sur chaque fiche SERVICE / IN_PERSON_TRAINING / DISTANCE_TRAINING qui n'a pas
// encore de configuration. Une fiche déjà réglée dans le Manager n'est jamais
// réécrite. Idempotente : relancée, elle ne change rien.
//
// Elle ne CRÉE aucune demande et n'envoie aucun e-mail : la détection
// automatique ne regarde que les prestations terminées après sa mise en
// service. Le rattrapage des prestations passées est une campagne à part
// (scripts/review-requests-backfill.js).
import mongoose from 'mongoose';
import 'dotenv/config';
import { DEFAULT_REVIEW_REQUEST } from '../../services/reviewRequestConfig.js';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou beauty_savage_test).');
  process.exit(2);
}

await mongoose.connect(process.env.MONGODB_URI, { dbName: DB });
const products = mongoose.connection.db.collection('commerceproducts');
const filter = {
  kind: { $in: ['SERVICE', 'IN_PERSON_TRAINING', 'DISTANCE_TRAINING'] },
  $or: [{ reviewRequest: { $exists: false } }, { reviewRequest: null }],
};
const todo = await products.find(filter).project({ title: 1, kind: 1, status: 1 }).toArray();
const already = await products.countDocuments({ kind: { $in: ['SERVICE', 'IN_PERSON_TRAINING', 'DISTANCE_TRAINING'] }, reviewRequest: { $type: 'object' } });
console.log(`${DB} : ${todo.length} fiche(s) à régler, ${already} déjà réglée(s).`);
for (const p of todo) console.log(`  · ${p.kind.padEnd(18)} ${p.status.padEnd(9)} ${p.title}`);

if (APPLY && todo.length) {
  const config = JSON.parse(JSON.stringify(DEFAULT_REVIEW_REQUEST));
  const r = await products.updateMany(filter, { $set: { reviewRequest: config, updatedAt: new Date() } });
  console.log(`Écrit : ${r.modifiedCount} fiche(s) (2 h après, relance 48 h, puis 1 semaine).`);
} else if (!APPLY) {
  console.log('Diagnostic seul : ajoutez --apply pour écrire.');
}
await mongoose.disconnect();
