#!/usr/bin/env node
// MIGRATION — les finitions de pédicure deviennent des OPTIONS des pédicures.
//
//   node src/scripts/migrations/2026-10-09-options-pedicure.js --db beauty_savage_prod           # diagnostic seul
//   node src/scripts/migrations/2026-10-09-options-pedicure.js --db beauty_savage_prod --apply   # écrit
//
// ══ POURQUOI ════════════════════════════════════════════════════════════════
//
// « Options pédicure » (French, chrome, restructuration du pouce) était une
// FICHE PRESTATION de 15 min, faute de pouvoir donner une durée à une option.
// La cliente devait donc lui choisir son propre créneau — et le 9 octobre 2026
// une cliente l'a posé cinq fois pendant sa propre pédicure. Les options portent
// désormais des minutes (`extraMinutes`) : elles se cochent sur la fiche de la
// pédicure, AVANT le calendrier, et allongent le rendez-vous.
//
// ══ CE QU'ELLE FAIT ═════════════════════════════════════════════════════════
//
//   1. sauvegarde les fiches touchées et les paniers concernés dans
//      `migration_backup_20261009` (même base) ;
//   2. ajoute quatre options à chaque fiche pédicure (sans toucher une option
//      déjà présente sous la même clé) ;
//   3. dépublie la fiche « Options pédicure » (DISABLED : son historique de
//      ventes reste lisible) ;
//   4. retire cette fiche des paniers où elle attend encore.
//
// Les prix viennent de la fiche d'origine (5 €, 5 € par pouce). Les durées sont
// une proposition validée par Luca le 2026-10-09 ; l'institut les ajuste dans
// le Manager (fiche prestation › Options › « Temps en plus »).
//
// Idempotente : relancée, elle ne réécrit rien.
import mongoose from 'mongoose';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou beauty_savage_test).');
  process.exit(2);
}

/** Les pédicures AVEC semi-permanent reçoivent les options (titres exacts en base au 2026-10-09). */
const PEDICURES = [
  'Pédicure express + semi permanent',
  'Dépose extérieur + pédicure express + semi permanent',
  'Dépose du salon + pédicure express + semi permanent',
  'Pédicure russe + semi permanent',
  'Dépose extérieur + pédicure russe + semi permanent',
  'Dépose du salon + pedicure russe + semi permanent',
  // Pas « Pédicure russe » : sans semi-permanent, pas de finition (consigne de l'institut, 2026-10-09).
];
const OPTION_FICHE = 'Options pédicure';

const OPTIONS = [
  { key: 'french', label: 'French', description: 'Pour une finition élégante et intemporelle.', priceCents: 500, extraMinutes: 15, active: true },
  { key: 'chrome', label: 'Chrome', description: 'Pour une finition brillante et lumineuse.', priceCents: 500, extraMinutes: 15, active: true },
  {
    key: 'restructuration-1-pouce', label: 'Restructuration d’un pouce', priceCents: 500, extraMinutes: 10, active: true,
    description: 'Corrige et reconstruit légèrement la forme de l’ongle, lorsque c’est possible. Sur demande, en cas de doute envoyez une photo sur Instagram avant de réserver.',
  },
  {
    key: 'restructuration-2-pouces', label: 'Restructuration des deux pouces', priceCents: 1000, extraMinutes: 15, active: true,
    description: 'Corrige et reconstruit légèrement la forme des deux ongles, lorsque c’est possible. Sur demande, en cas de doute envoyez une photo sur Instagram avant de réserver.',
  },
];

const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: DB }).asPromise();
const db = conn.db;
const products = db.collection('commerceproducts');
const carts = db.collection('carts');
const backup = db.collection('migration_backup_20261009');

console.log(`${APPLY ? 'ÉCRITURE' : 'DIAGNOSTIC (rien n’est écrit)'} — base ${DB}\n`);

const targets = await products.find({ kind: 'SERVICE', title: { $in: PEDICURES } }).toArray();
const missing = PEDICURES.filter((title) => !targets.some((p) => p.title === title));
if (missing.length) console.log(`⚠ fiches introuvables : ${missing.join(' | ')}`);
const fiche = await products.findOne({ kind: 'SERVICE', title: OPTION_FICHE });
const cartsWithFiche = fiche ? await carts.find({ 'lines.productId': fiche._id }).toArray() : [];

const plan = targets.map((p) => {
  const have = new Set((p.options || []).map((o) => o.key));
  return { product: p, add: OPTIONS.filter((o) => !have.has(o.key)) };
});
for (const { product, add } of plan) {
  console.log(`• ${product.title} (${product.status}, ${product.durationMinutes} min) : ${add.length ? `+ ${add.map((o) => `${o.label} (+${o.priceCents / 100} €, +${o.extraMinutes} min)`).join(', ')}` : 'déjà à jour'}`);
}
console.log(`• fiche « ${OPTION_FICHE} » : ${fiche ? `${fiche.status} → ${fiche.status === 'DISABLED' ? 'déjà dépubliée' : 'DISABLED'}` : 'introuvable'}`);
console.log(`• paniers qui la contiennent : ${cartsWithFiche.length}`);

if (APPLY) {
  const toSave = [...plan.filter((x) => x.add.length).map((x) => x.product), ...(fiche && fiche.status !== 'DISABLED' ? [fiche] : [])];
  if (toSave.length || cartsWithFiche.length) {
    await backup.insertOne({ at: new Date(), migration: '2026-10-09-options-pedicure', products: toSave, carts: cartsWithFiche });
  }
  for (const { product, add } of plan) {
    if (!add.length) continue;
    await products.updateOne({ _id: product._id }, { $push: { options: { $each: add } }, $set: { updatedAt: new Date() } });
  }
  if (fiche && fiche.status !== 'DISABLED') {
    await products.updateOne({ _id: fiche._id }, { $set: { status: 'DISABLED', homeFeatured: false, updatedAt: new Date() } });
  }
  if (fiche && cartsWithFiche.length) {
    await carts.updateMany({ 'lines.productId': fiche._id }, { $pull: { lines: { productId: fiche._id } } });
  }
  console.log('\n✓ écrit. Sauvegarde : collection migration_backup_20261009.');
}

await conn.close();
