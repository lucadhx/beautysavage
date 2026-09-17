// tests/p1/promotionSingleApplication.test.js
// Une seule promotion par ligne (pas de cumul). Promotion (product/formation) et
// Service.promotion (prestation) ciblent des types disjoints. pickSinglePromotion retient
// la meilleure réduction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Promotion from '../../models/Promotion.js';
import Service from '../../models/Service.js';
import { buildServerCheckoutPricing } from '../../services/checkoutPricingService.js';
import { pickSinglePromotion } from '../../constants/pricingConcepts.js';

const DAY = 24 * 3600 * 1000;
async function promo(targetType, targetId, type, value, { expired = false } = {}) {
  return Promotion.create({
    targetType, targetId, discountType: type, discountValue: value,
    createdBy: new mongoose.Types.ObjectId(),
    startAt: new Date(Date.now() - (expired ? 10 * DAY : DAY)),
    endAt: expired ? new Date(Date.now() - DAY) : null
  });
}

describe('Promotions — application unique', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('pickSinglePromotion retient la meilleure réduction (pas de cumul)', () => {
    const r = pickSinglePromotion([
      { discountAmount: 10, promotionId: 'a', source: 'promotion' },
      { discountAmount: 25, promotionId: 'b', source: 'promotion' }
    ]);
    expect(r.discountAmount).toBe(25);
    expect(r.promotionId).toBe('b');
  });

  it('Promotion seule (produit) → prix vendu réduit une fois', async () => {
    await promo('product', fx.product._id, 'percentage', 25); // 40 → 30
    const p = await buildServerCheckoutPricing({ item: { type: 'product', id: String(fx.product._id) } });
    expect(p.catalogAmount).toBe(40);
    expect(p.soldAmount).toBe(30);
    expect(p.promotionDiscountAmount).toBe(10);
  });

  it('Promotion(service) seule → prix vendu réduit (source officielle)', async () => {
    await Promotion.create({
      targetType: 'service', targetId: fx.service._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - DAY), endAt: null
    });
    const p = await buildServerCheckoutPricing({ service: { serviceId: String(fx.service._id) } });
    expect(p.catalogAmount).toBe(80);
    expect(p.soldAmount).toBe(60); // 80 - 25%
  });

  it('E1 — Service.promotion legacy IGNORÉE (runtime lit uniquement Promotion)', async () => {
    // Le sous-document legacy n'a plus d'effet : sans Promotion(service), prix plein.
    await Service.findByIdAndUpdate(fx.service._id, {
      promotion: { isActive: true, type: 'fixed', value: 20, startDate: new Date(Date.now() - DAY), endDate: null }
    });
    const p = await buildServerCheckoutPricing({ service: { serviceId: String(fx.service._id) } });
    expect(p.soldAmount).toBe(80); // legacy ignorée → plein tarif
  });

  it('promo expirée → ignorée (prix plein)', async () => {
    await promo('product', fx.product._id, 'percentage', 25, { expired: true });
    const p = await buildServerCheckoutPricing({ item: { type: 'product', id: String(fx.product._id) } });
    expect(p.soldAmount).toBe(40);
    expect(p.promotionDiscountAmount).toBe(0);
  });
});
