#!/usr/bin/env node
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { CommerceProduct, PRODUCT_KIND, PRODUCT_STATUS } from '../../models/CommerceProduct.model.js';
import { InstituteIntegration } from '../../models/InstituteIntegration.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';

const apply = process.argv.includes('--apply');

const products = [
  {
    slug: 'formation-prothesie-ongulaire-distance',
    title: 'Formation prothesie ongulaire a distance',
    subtitle: 'Acces e-learning, modules video et evaluation finale.',
    kind: PRODUCT_KIND.DISTANCE_TRAINING,
    status: PRODUCT_STATUS.PUBLISHED,
    price: { amountCents: 24900, currency: 'EUR' },
    description: 'Parcours complet pour apprendre les bases de la prothesie ongulaire avec supports, videos et validation finale.',
    distanceDeliveryMode: 'IMMEDIATE',
    requiresLegalWaiver: true,
    boostRank: 1,
    options: [
      { key: 'kit-demarrage', label: 'Kit de demarrage', description: 'Materiel selectionne pour pratiquer.', priceCents: 6900, active: true },
    ],
  },
  {
    slug: 'formation-perfectionnement-presentiel',
    title: 'Perfectionnement presentiel',
    subtitle: 'Une session intensive en institut.',
    kind: PRODUCT_KIND.IN_PERSON_TRAINING,
    status: PRODUCT_STATUS.PUBLISHED,
    price: { amountCents: 39000, currency: 'EUR' },
    description: 'Session en petit groupe pour corriger les gestes, travailler la tenue et preparer les cas clients.',
    durationMinutes: 7 * 60,
    boostRank: 2,
    sessions: [
      {
        startsAt: new Date('2026-10-12T08:00:00.000Z'),
        endsAt: new Date('2026-10-12T15:00:00.000Z'),
        capacity: 6,
        reservedCount: 0,
        status: 'ACTIVE',
      },
    ],
  },
  {
    slug: 'pose-complete-gel',
    title: 'Pose complete gel',
    subtitle: 'Reservation avec acompte via checkout.',
    kind: PRODUCT_KIND.SERVICE,
    status: PRODUCT_STATUS.PUBLISHED,
    price: { amountCents: 6500, currency: 'EUR' },
    description: 'Pose complete soignee, diagnostic rapide et finition brillante.',
    durationMinutes: 120,
    boostRank: 3,
    options: [
      { key: 'nail-art', label: 'Nail art', description: 'Decoration simple sur plusieurs ongles.', priceCents: 1500, active: true },
    ],
  },
  {
    slug: 'carte-cadeau-beautysavage',
    title: 'Carte cadeau BeautySavage',
    subtitle: 'Montant utilisable sur prestations et formations.',
    kind: PRODUCT_KIND.GIFT_CARD,
    status: PRODUCT_STATUS.PUBLISHED,
    price: { amountCents: 5000, currency: 'EUR' },
    description: 'Carte cadeau numerique generee apres paiement, avec code masque dans les espaces client et manager.',
  },
];

async function upsertProduct(product) {
  return CommerceProduct.updateOne(
    { slug: product.slug },
    { $setOnInsert: product },
    { upsert: true }
  );
}

async function upsertIntegration(provider) {
  return InstituteIntegration.updateOne(
    { provider },
    {
      $setOnInsert: {
        provider,
        mode: 'TEST',
        verified: false,
      },
    },
    { upsert: true }
  );
}

async function upsertNetwork() {
  const cfg = await SystemConfiguration.findOne({}) || new SystemConfiguration();
  cfg.network = {
    backendUrl: 'https://api.beautysavage.ly-solution.com',
    managerUrl: 'https://manager.beautysavage.ly-solution.com',
    websiteUrl: 'https://beautysavage.ly-solution.com',
  };
  await cfg.save();
}

async function main() {
  await connectDatabase();
  try {
    if (!apply) {
      console.log('[dry-run] Produits BeautySavage a poser :');
      for (const product of products) console.log(`- ${product.slug} (${product.kind})`);
      console.log('[dry-run] Relancer avec --apply pour ecrire.');
      return;
    }
    for (const product of products) await upsertProduct(product);
    await upsertIntegration('STRIPE_INSTITUTE');
    await upsertIntegration('BREVO_INSTITUTE');
    await upsertNetwork();
    console.log('Import BeautySavage applique : produits, integrations institut et reseau initialises.');
  } finally {
    await disconnectDatabase();
  }
}

main().catch(async (err) => {
  console.error(err?.message || err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
