// C1 — Validation catalogue : statuts par module, blocages, publishable.
import { describe, it, expect } from 'vitest';
import { validateService, validateTraining, validateGiftCardConfig } from './validation';

describe('validateService', () => {
  it('signale les bloquants pour une prestation vide', () => {
    const r = validateService({ name: '', duration: 0, price: 0, paymentType: 'full' });
    expect(r.publishable).toBe(false);
    expect(r.modules.identite.status).toBe('error');
    expect(r.modules.prix.status).toBe('error');
  });

  it('est publiable avec nom + durée + prix', () => {
    const r = validateService({
      name: 'Soin', duration: 60, price: 50, paymentType: 'full',
      shortDescription: 'desc', photos: ['x.jpg'], isBookable: true, bookingLeadDays: 0,
    });
    expect(r.publishable).toBe(true);
    expect(r.modules.identite.status).toBe('complete');
    expect(r.modules.prix.status).toBe('complete');
  });

  it('bloque un acompte en pourcentage > 100', () => {
    const r = validateService({ name: 'S', duration: 30, price: 100, paymentType: 'deposit', depositType: 'percentage', depositValue: 150 });
    expect(r.publishable).toBe(false);
    expect(r.modules.prix.status).toBe('error');
  });

  it('gratuit : prix non requis', () => {
    const r = validateService({ name: 'S', duration: 30, price: 0, paymentType: 'free', shortDescription: 'x', photos: ['y'] });
    expect(r.modules.prix.status).not.toBe('error');
  });
});

describe('validateTraining', () => {
  it('présentiel : exige au moins une session active', () => {
    const r = validateTraining({ name: 'F', price: 100, type: 'presentiel', coverImage: 'c.jpg' }, []);
    expect(r.publishable).toBe(false);
    expect(r.modules.sessions.status).toBe('error');
  });

  it('présentiel publiable avec une session', () => {
    const r = validateTraining(
      { name: 'F', price: 100, type: 'presentiel', coverImage: 'c.jpg' },
      [{ id: 's', formationId: 'f', startDate: '', durationDays: 1, durationLabel: '', schedule: [], maxClients: 8, reservedCount: 0, placesRemaining: 8, isAvailable: true, status: 'active', isCanceled: false, instructorId: null, instructorName: null, qr: { hasToken: false, token: null, payload: null, generatedAt: null } }],
    );
    expect(r.publishable).toBe(true);
  });

  it('distanciel : warning si accès immédiat sans remboursement', () => {
    const r = validateTraining({ name: 'F', price: 100, type: 'distanciel', accessDeliveryMode: 'immediate', isRefundableAfterAccess: false, accessLifetime: true });
    expect(r.publishable).toBe(true); // warning, pas bloquant
    expect(r.warningCount).toBeGreaterThan(0);
    expect(r.modules.acces.status).toBe('incomplete');
  });
});

describe('validateGiftCardConfig', () => {
  it('bloque sans template actif', () => {
    const r = validateGiftCardConfig({ minAmount: 20, maxAmount: 0, presetAmounts: [] }, false);
    expect(r.publishable).toBe(false);
    expect(r.modules.template.status).toBe('error');
  });

  it('bloque si min > max', () => {
    const r = validateGiftCardConfig({ minAmount: 200, maxAmount: 100, presetAmounts: [] }, true);
    expect(r.publishable).toBe(false);
    expect(r.modules.montants.status).toBe('error');
  });

  it('valide avec template actif et montants cohérents', () => {
    const r = validateGiftCardConfig({ minAmount: 20, maxAmount: 500, presetAmounts: [50, 100] }, true);
    expect(r.publishable).toBe(true);
  });
});
