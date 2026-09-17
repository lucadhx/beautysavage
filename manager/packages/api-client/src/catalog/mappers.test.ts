import { describe, it, expect } from 'vitest';
import { mapService, mapTraining, mapProduct, mapSiteStatus, mapGiftCardConfig } from './mappers';

describe('catalogue mappers', () => {
  it('mappe une prestation minimale et tolère les champs absents', () => {
    const s = mapService({ _id: 'svc1', slug: 'soin', name: 'Soin', price: 50 });
    expect(s).toMatchObject({ id: 'svc1', slug: 'soin', name: 'Soin', price: 50 });
    expect(s.photos).toEqual([]);
    expect(s.options).toEqual([]);
    expect(s.promotionLabel).toBeNull();
    expect(s.isBookable).toBe(true);
  });

  it('mappe une formation avec promotion et finalPrice', () => {
    const t = mapTraining({
      id: 'f1',
      name: 'Formation',
      price: 200,
      finalPrice: 150,
      type: 'distanciel',
      activePromotion: { label: '-25%' },
    });
    expect(t).toMatchObject({ id: 'f1', name: 'Formation', price: 200, finalPrice: 150, type: 'distanciel' });
    expect(t.activePromotion?.label).toBe('-25%');
  });

  it('mappe un produit et coerce les ids non-string', () => {
    const p = mapProduct({ _id: 123, name: 'Produit', price: '19.9' });
    expect(p.id).toBe('123');
    expect(p.price).toBe(19.9);
  });

  it('normalise un statut site inconnu vers active', () => {
    expect(mapSiteStatus({ status: 'maintenance', reason: 'MAJ' })).toMatchObject({
      status: 'maintenance',
      reason: 'MAJ',
    });
    expect(mapSiteStatus({ status: 'wat' }).status).toBe('active');
  });

  it('mappe la config carte cadeau', () => {
    expect(mapGiftCardConfig({ minAmount: 50, description: 'desc' })).toMatchObject({
      minAmount: 50,
      description: 'desc',
    });
  });
});
