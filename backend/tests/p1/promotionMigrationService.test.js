// tests/p1/promotionMigrationService.test.js
// D1 — Promotion devient la source officielle unique. Migration Service.promotion → Promotion,
// pricing prestation : Promotion(service) prioritaire, fallback legacy, jamais les deux.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Service from '../../models/Service.js';
import Promotion from '../../models/Promotion.js';
import { buildServerCheckoutPricing } from '../../services/checkoutPricingService.js';
import { resolveEffectiveServiceUnitPrice } from '../../services/promotionService.js';
import { migrateServicePromotionsToPromotionModel } from '../../scripts/migrateServicePromotionsToPromotionModel.js';

const DAY = 24 * 3600 * 1000;

describe('D1 — migration & unification promotions prestation', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('E1 — Service.promotion legacy seule N\'EST PLUS appliquée (runtime lit uniquement Promotion)', async () => {
    await Service.findByIdAndUpdate(fx.service._id, {
      promotion: { isActive: true, type: 'percentage', value: 25, startDate: new Date(Date.now() - DAY), endDate: null }
    });
    const svc = await Service.findById(fx.service._id).lean();
    const r = await resolveEffectiveServiceUnitPrice(svc);
    // Le fallback legacy a disparu : sans Promotion(service), prix plein.
    expect(r.unitPrice).toBe(80);
    expect(r.source).toBeNull();
  });

  it('dry-run migration ne crée rien ; --apply crée la Promotion(service)', async () => {
    await Service.findByIdAndUpdate(fx.service._id, {
      promotion: { isActive: true, type: 'fixed', value: 20, startDate: new Date(Date.now() - DAY), endDate: null }
    });
    const dry = await migrateServicePromotionsToPromotionModel({ apply: false });
    expect(dry.candidates).toBe(1);
    expect(await Promotion.countDocuments({ targetType: 'service' })).toBe(0);

    const applied = await migrateServicePromotionsToPromotionModel({ apply: true });
    expect(applied.migrated).toBe(1);
    const promo = await Promotion.findOne({ targetType: 'service', targetId: fx.service._id }).lean();
    expect(promo).toBeTruthy();
    expect(promo.discountType).toBe('fixed');
    expect(promo.discountValue).toBe(20);
  });

  it('Promotion(service) migrée → prix promo correct (prioritaire)', async () => {
    await Promotion.create({
      targetType: 'service', targetId: fx.service._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - DAY), endAt: null
    });
    const r = await resolveEffectiveServiceUnitPrice(await Service.findById(fx.service._id).lean());
    expect(r.unitPrice).toBe(60);
    expect(r.source).toBe('promotion');
  });

  it('Promotion + Service.promotion → UNE seule appliquée (Promotion prioritaire)', async () => {
    // Legacy fixe 20 (→70) ET Promotion % 25 (→60). Seule la Promotion doit s'appliquer.
    await Service.findByIdAndUpdate(fx.service._id, {
      promotion: { isActive: true, type: 'fixed', value: 20, startDate: new Date(Date.now() - DAY), endDate: null }
    });
    await Promotion.create({
      targetType: 'service', targetId: fx.service._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - DAY), endAt: null
    });
    const p = await buildServerCheckoutPricing({ service: { serviceId: String(fx.service._id) } });
    expect(p.soldAmount).toBe(60); // Promotion (60), PAS cumul avec legacy (qui donnerait 40)
  });

  it('Promotion(service) expirée → ignorée (fallback legacy ou prix plein)', async () => {
    await Promotion.create({
      targetType: 'service', targetId: fx.service._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - 10 * DAY), endAt: new Date(Date.now() - DAY)
    });
    const r = await resolveEffectiveServiceUnitPrice(await Service.findById(fx.service._id).lean());
    expect(r.unitPrice).toBe(80); // promo expirée ignorée, pas de legacy → plein tarif
  });
});
