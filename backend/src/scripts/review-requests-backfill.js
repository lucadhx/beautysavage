#!/usr/bin/env node
// CAMPAGNE — demande d'avis pour les prestations et formations terminées AVANT
// la mise en service de la détection automatique.
//
//   node src/scripts/review-requests-backfill.js --db beauty_savage_prod            # liste seule
//   node src/scripts/review-requests-backfill.js --db beauty_savage_prod --apply    # crée les demandes
//
// Chaque demande créée part au prochain passage du planificateur (≤ 3 min),
// groupée par cliente (un seul e-mail pour plusieurs prestations), puis suit
// les relances de sa fiche. Exclus : produits déjà notés par la cliente,
// fiches dont la demande d'avis est désactivée, rendez-vous annulés, sessions
// annulées. Idempotente : une demande existante n'est jamais recréée.
import mongoose from 'mongoose';
import 'dotenv/config';
import { backfillReviewRequests } from '../services/reviewRequest.service.js';
import { ReviewRequestState } from '../models/ReviewRequest.model.js';
import { Customer } from '../models/Customer.model.js';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou beauty_savage_test).');
  process.exit(2);
}

await mongoose.connect(process.env.MONGODB_URI, { dbName: DB });
// Jusqu'où va le rattrapage : là où commence la détection automatique.
const state = await ReviewRequestState.findOne({ singleton: 'global' }).lean();
const until = state?.discoverySince ? new Date(state.discoverySince) : new Date();
const { plan, candidates } = await backfillReviewRequests({ until, dryRun: true });
const emails = new Map((await Customer.find({ _id: { $in: [...new Set(plan.map((p) => p.customerId))] } }).select('email').lean()).map((c) => [String(c._id), c.email]));
const byCustomer = new Map();
for (const p of plan) {
  const key = emails.get(String(p.customerId)) || `(sans e-mail) ${p.customerId}`;
  if (!byCustomer.has(key)) byCustomer.set(key, []);
  byCustomer.get(key).push(`${new Date(p.completedAt).toISOString().slice(0, 10)} ${p.title || p.product.title}`);
}
console.log(`${DB} : ${candidates} prestation(s) terminée(s) avant ${until.toISOString()}, ${byCustomer.size} cliente(s).`);
for (const [email, rows] of byCustomer) console.log(`  · ${email} — ${rows.join(' | ')}`);

if (APPLY) {
  const result = await backfillReviewRequests({ until, dryRun: false });
  console.log(`Créé : ${result.created} demande(s). Envoi au prochain passage du planificateur.`);
} else {
  console.log('Liste seule : ajoutez --apply pour créer les demandes (les e-mails partent ensuite).');
}
await mongoose.disconnect();
