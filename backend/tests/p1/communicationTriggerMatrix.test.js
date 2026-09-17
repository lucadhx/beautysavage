// LOT2 §3 — Matrice des déclencheurs (lecture seule). Le endpoint reflète le registre code-first
// mailDispatchRules, enrichi du statut template + dernier envoi.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb } from '../setup/testDb.js';
import { MAIL_DISPATCH_RULES } from '../../constants/mailDispatchRules.js';
import { getTriggerMatrix } from '../../controllers/mailTemplateController.js';

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('LOT2 — matrice des déclencheurs', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });

  it('renvoie une ligne par règle du registre, avec les colonnes attendues', async () => {
    const res = mockRes();
    await getTriggerMatrix({}, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows).toHaveLength(MAIL_DISPATCH_RULES.length);
    expect(res.body).toHaveProperty('engineEnabled');
    for (const row of res.body.rows) {
      expect(row).toHaveProperty('event');
      expect(row).toHaveProperty('category');
      expect(row).toHaveProperty('templateKey');
      expect(row).toHaveProperty('fromRole');
      expect(row).toHaveProperty('toRole');
      expect(row).toHaveProperty('active');
      expect(row).toHaveProperty('directSender');
      expect(row).toHaveProperty('engine');
    }
  });

  it('catégorise les événements (booking → réservation, gift_card → carte cadeau, refund → remboursement)', async () => {
    const res = mockRes();
    await getTriggerMatrix({}, res);
    const byEvent = new Map(res.body.rows.map((r) => [r.event, r]));
    expect(byEvent.get('booking.confirmed').category).toBe('réservation');
    expect(byEvent.get('gift_card.online_created').category).toBe('carte cadeau');
    expect(byEvent.get('refund.succeeded').category).toBe('remboursement');
    // reset PIN carte cadeau présent dans le registre
    expect(byEvent.has('gift_card.pin_reset_and_resent')).toBe(true);
  });
});
