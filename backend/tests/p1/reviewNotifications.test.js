// LOT2 §11 — Notifications AVIS. Vérifie que la soumission/modération/création manuelle d'un avis
// déclenche la bonne notification interne (audience admin). triggerNotification mocké.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ notifs: [] }));
vi.mock('../../services/notificationService.js', () => ({
  triggerNotification: vi.fn(async (t, v) => { h.notifs.push({ type: t, vars: v }); }),
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Review from '../../models/Review.js';
import Formation from '../../models/Formation.js';

const { moderateReview, createManualReview } = await import('../../controllers/reviewModerationController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };

describe('LOT2 — notifications avis', () => {
  let formationId;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    h.notifs.length = 0;
    formationId = new mongoose.Types.ObjectId();
    // Insertion raw (bypass validation des sous-documents requis de Formation).
    await Formation.collection.insertOne({ _id: formationId, name: 'Formation Test' });
  });

  async function seedReview(status = 'pending') {
    return Review.create({
      userId: new mongoose.Types.ObjectId(),
      formationId,
      targetType: 'formation',
      sourceType: 'client',
      rating: 5,
      comment: 'Super',
      status,
      createdAt: new Date(),
    });
  }

  it('modération → publié déclenche review_published', async () => {
    const review = await seedReview('pending');
    const res = mockRes();
    await moderateReview({ params: { reviewId: String(review._id) }, body: { status: 'published' }, sessionUser: admin }, res);
    expect(res.body.ok).toBe(true);
    expect(h.notifs.some((n) => n.type === 'review_published')).toBe(true);
  });

  it('modération → rejeté déclenche review_rejected', async () => {
    const review = await seedReview('pending');
    const res = mockRes();
    await moderateReview({ params: { reviewId: String(review._id) }, body: { status: 'rejected' }, sessionUser: admin }, res);
    expect(h.notifs.some((n) => n.type === 'review_rejected')).toBe(true);
  });

  it('création manuelle déclenche review_manual', async () => {
    const res = mockRes();
    await createManualReview({
      body: { targetType: 'formation', targetId: String(formationId), displayName: 'Client X', rating: 4, status: 'published', comment: 'Bien' },
      sessionUser: admin,
    }, res);
    expect(res.body.ok).toBe(true);
    const manual = h.notifs.find((n) => n.type === 'review_manual');
    expect(manual).toBeTruthy();
    expect(manual.vars.formationName).toBe('Formation Test');
  });
});
