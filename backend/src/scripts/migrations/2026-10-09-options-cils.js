#!/usr/bin/env node
// MIGRATION — les suppléments d'extensions de cils deviennent des OPTIONS.
//
//   node src/scripts/migrations/2026-10-09-options-cils.js --db beauty_savage_prod           # diagnostic seul
//   node src/scripts/migrations/2026-10-09-options-cils.js --db beauty_savage_prod --apply   # écrit
//
// ══ POURQUOI ════════════════════════════════════════════════════════════════
//
// « Option KIM K ou Courbure M » et « Option couleur » étaient des FICHES
// PRESTATION, avec leur propre créneau — le même piège que les finitions de
// pédicure (voir 2026-10-09-options-pedicure.js). Consigne de l'institut
// (2026-10-09) :
//   - Kim K, courbure M et couleur : trois options SÉPARÉES (cumulables), sur
//     les poses complètes, les packs Élégance et Signature (pas Korean glow,
//     qui n'est pas une extension) et tous les remplissages 2 et 3 semaines ;
//   - « Dépose + shampoing » RESTE une prestation (des clientes ne font que la
//     dépose) ET devient une option des poses complètes, pour celles qui
//     enchaînent dépose puis nouvelle pose. Étendue le même jour, à sa
//     demande, aux packs Élégance et Signature et aux remplissages.
//
// Prix et durées repris des fiches d'origine. Sauvegarde dans
// `migration_backup_20261009` avant toute écriture. Idempotente.
import mongoose from 'mongoose';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou beauty_savage_test).');
  process.exit(2);
}

const POSES = ['Pose regard pure', 'Pose signature', 'Effet plume aérien', 'Volume russe léger', 'Volume russe intense'];
const PACKS = ['Pack élégance', 'Pack signature'];
const REMPLISSAGES = ['Remplissage 2 semaines', 'Remplissage 3 semaines'];
const RETIREES = ['Option KIM K ou Courbure M', 'Option couleur'];

const KIM_K = { key: 'effet-kim-k', label: 'Effet Kim K', description: 'Un effet structuré et tendance, adapté au rendu souhaité et à la forme de vos yeux.', priceCents: 1000, extraMinutes: 15, active: true };
const COURBURE_M = { key: 'courbure-m', label: 'Courbure M', description: 'Une courbure plus marquée, choisie selon le rendu souhaité et la forme de vos yeux.', priceCents: 1000, extraMinutes: 15, active: true };
const COULEUR = { key: 'couleur', label: 'Couleur', description: 'Changer du noir classique : pose marron, ou touche de couleur sur une partie de la pose.', priceCents: 500, extraMinutes: 10, active: true };
const DEPOSE = { key: 'depose-shampoing', label: 'Dépose + shampoing', description: 'Retrait en douceur de vos extensions actuelles et shampoing des cils, juste avant la nouvelle pose.', priceCents: 1500, extraMinutes: 30, active: true };

/** Ce que reçoit chaque famille de fiches. */
const PLAN = [
  { titles: POSES, options: [KIM_K, COURBURE_M, COULEUR, DEPOSE] },
  { titles: PACKS, options: [KIM_K, COURBURE_M, COULEUR, DEPOSE] },
  { titles: REMPLISSAGES, options: [KIM_K, COURBURE_M, COULEUR, DEPOSE] },
];

const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: DB }).asPromise();
const products = conn.db.collection('commerceproducts');
const carts = conn.db.collection('carts');
const backup = conn.db.collection('migration_backup_20261009');

console.log(`${APPLY ? 'ÉCRITURE' : 'DIAGNOSTIC (rien n’est écrit)'} — base ${DB}\n`);

const work = [];
for (const family of PLAN) {
  const found = await products.find({ kind: 'SERVICE', title: { $in: family.titles } }).sort({ title: 1 }).toArray();
  const missing = family.titles.filter((t) => !found.some((p) => p.title === t));
  if (missing.length) console.log(`⚠ introuvables : ${missing.join(' | ')}`);
  for (const p of found) {
    const have = new Set((p.options || []).map((o) => o.key));
    const add = family.options.filter((o) => !have.has(o.key));
    work.push({ product: p, add });
    console.log(`• ${p.title} (${p.durationMinutes} min, ${p.price?.amountCents / 100} €) : ${add.length ? `+ ${add.map((o) => o.label).join(', ')}` : 'déjà à jour'}`);
  }
}
const retirees = await products.find({ kind: 'SERVICE', title: { $in: RETIREES } }).toArray();
for (const r of retirees) console.log(`• fiche « ${r.title} » : ${r.status === 'DISABLED' ? 'déjà dépubliée' : `${r.status} → DISABLED`}`);
const retireeIds = retirees.map((r) => r._id);
const inCarts = retireeIds.length ? await carts.find({ 'lines.productId': { $in: retireeIds } }).toArray() : [];
console.log(`• paniers qui les contiennent : ${inCarts.length}`);
console.log(`• « Dépose + shampoing » : reste une prestation (inchangée)`);

if (APPLY) {
  const changed = work.filter((w) => w.add.length).map((w) => w.product);
  const toDisable = retirees.filter((r) => r.status !== 'DISABLED');
  if (changed.length || toDisable.length || inCarts.length) {
    await backup.insertOne({ at: new Date(), migration: '2026-10-09-options-cils', products: [...changed, ...toDisable], carts: inCarts });
  }
  for (const { product, add } of work) {
    if (add.length) await products.updateOne({ _id: product._id }, { $push: { options: { $each: add } }, $set: { updatedAt: new Date() } });
  }
  for (const r of toDisable) await products.updateOne({ _id: r._id }, { $set: { status: 'DISABLED', homeFeatured: false, updatedAt: new Date() } });
  if (inCarts.length) await carts.updateMany({ 'lines.productId': { $in: retireeIds } }, { $pull: { lines: { productId: { $in: retireeIds } } } });
  console.log('\n✓ écrit. Sauvegarde : collection migration_backup_20261009.');
}

await conn.close();
