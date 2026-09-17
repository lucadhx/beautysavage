// scripts/migrateServicePromotionsToPromotionModel.js
// Pré-React D1 — Migre les `Service.promotion` (legacy, sous-document) vers le modèle
// officiel unique `Promotion` (targetType:'service').
//
// USAGE :
//   node scripts/migrateServicePromotionsToPromotionModel.js            # DRY-RUN (n'écrit rien)
//   node scripts/migrateServicePromotionsToPromotionModel.js --apply    # applique la migration
//
// Idempotent : ne recrée pas une Promotion(service) déjà existante pour le même service.
// Ne supprime PAS `Service.promotion` (conservé en legacy/fallback). Aucune action au boot.
// Ne logge jamais de secret.

import mongoose from 'mongoose';
import Service from '../models/Service.js';
import Promotion from '../models/Promotion.js';

function roundToCents(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

/**
 * Migre les promotions de prestations. Lecture seule sauf si apply=true.
 * @param {{ apply?: boolean, actorId?: string, logger?: Console }} [opts]
 * @returns {Promise<{inspected:number, candidates:number, migrated:number, skipped:number, details:object[]}>}
 */
export async function migrateServicePromotionsToPromotionModel({ apply = false, actorId = null, logger = console } = {}) {
  const summary = { inspected: 0, candidates: 0, migrated: 0, skipped: 0, details: [] };
  const services = await Service.find({ 'promotion.isActive': true }).lean();
  summary.inspected = services.length;

  for (const service of services) {
    const promo = service.promotion || {};
    const value = Number(promo.value || 0);
    if (!promo.isActive || !(value > 0)) {
      summary.skipped += 1;
      summary.details.push({ serviceId: String(service._id), reason: 'inactive_or_zero' });
      continue;
    }
    summary.candidates += 1;

    // Idempotence : une Promotion(service) existe déjà pour ce service ?
    const existing = await Promotion.findOne({ targetType: 'service', targetId: service._id }).lean();
    if (existing) {
      summary.skipped += 1;
      summary.details.push({ serviceId: String(service._id), reason: 'promotion_already_exists', promotionId: String(existing._id) });
      continue;
    }

    const doc = {
      targetType: 'service',
      targetId: service._id,
      discountType: promo.type === 'fixed' ? 'fixed' : 'percentage',
      discountValue: roundToCents(value),
      startAt: promo.startDate ? new Date(promo.startDate) : new Date(),
      endAt: promo.endDate ? new Date(promo.endDate) : null,
      createdBy: actorId ? new mongoose.Types.ObjectId(actorId) : (service.createdBy || service.updatedBy || new mongoose.Types.ObjectId())
    };

    if (apply) {
      const created = await Promotion.create(doc);
      summary.migrated += 1;
      summary.details.push({ serviceId: String(service._id), reason: 'migrated', promotionId: String(created._id) });
    } else {
      summary.migrated += 1; // compté comme "à migrer" en dry-run
      summary.details.push({ serviceId: String(service._id), reason: 'would_migrate', preview: { discountType: doc.discountType, discountValue: doc.discountValue } });
    }
  }

  logger.log(
    `[migrateServicePromotions] mode=${apply ? 'APPLY' : 'DRY-RUN'} inspected=${summary.inspected} ` +
      `candidates=${summary.candidates} migrated=${summary.migrated} skipped=${summary.skipped}`
  );
  return summary;
}

// CLI
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  const apply = process.argv.includes('--apply');
  const run = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI manquant.'); process.exit(1); }
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    try {
      await migrateServicePromotionsToPromotionModel({ apply });
    } finally {
      await mongoose.disconnect();
    }
  };
  run().catch(err => { console.error('[migrateServicePromotions] erreur:', err?.message || err); process.exit(1); });
}

export default migrateServicePromotionsToPromotionModel;
