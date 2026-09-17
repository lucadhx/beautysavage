import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Review = (await import('../../models/Review.js')).default;

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('manual review creation', () => {
  beforeAll(async () => {
    agent = await getAgent();
    await Review.syncIndexes();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await Review.syncIndexes();
    fx = await seedTestData();
  });

  it('admin creates a published manual service review without a fake client and it becomes public', async () => {
    const adminCookie = await login('admin@test.local');
    const serviceId = String(fx.service._id);

    const create = await agent
      .post('/api/gestion/learning/reviews/manual')
      .set('Cookie', adminCookie)
      .send({
        targetType: 'service',
        targetId: serviceId,
        displayName: 'Camille M.',
        rating: 4,
        comment: 'Soin tres propre et ponctuel.',
        status: 'published',
      });

    expect(create.status).toBe(201);
    expect(create.body.review.targetType).toBe('service');
    expect(create.body.review.serviceId).toBe(serviceId);
    expect(create.body.review.authorName).toBe('Camille M.');
    expect(create.body.review.isManual).toBe(true);
    expect(create.body.review.sourceType).toBe('manual_institute');
    expect(create.body.review.sourceLabel).toMatch(/manuellement/i);

    const stored = await Review.findById(create.body.review.id).lean();
    expect(String(stored.serviceId)).toBe(serviceId);
    expect(stored.formationId).toBeNull();
    expect(stored.userId).toBeNull();
    expect(stored.sourceType).toBe('manual_institute');
    expect(stored.status).toBe('published');

    const stats = await agent.get(`/api/vitrine/services/${serviceId}/reviews/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.averageRating).toBe(4);
    expect(stats.body.reviewCount).toBe(1);

    const reviews = await agent.get(`/api/vitrine/services/${serviceId}/reviews`);
    expect(reviews.status).toBe(200);
    expect(reviews.body.reviews).toHaveLength(1);
    expect(reviews.body.reviews[0].comment).toBe('Soin tres propre et ponctuel.');
  });

  it('pending manual review appears in moderation filters and only becomes public after publication', async () => {
    const adminCookie = await login('admin@test.local');
    const serviceId = String(fx.service._id);

    await Review.create({
      userId: fx.client1._id,
      formationId: fx.formationDistanciel._id,
      targetType: 'formation',
      sourceType: 'client',
      rating: 5,
      comment: 'Formation tres claire.',
      status: 'published',
    });

    const create = await agent
      .post('/api/gestion/learning/reviews/manual')
      .set('Cookie', adminCookie)
      .send({
        targetType: 'service',
        targetId: serviceId,
        displayName: 'Institut',
        rating: 5,
        comment: 'Avis en attente.',
        status: 'pending',
      });

    expect(create.status).toBe(201);
    const reviewId = create.body.review.id;

    let publicStats = await agent.get(`/api/vitrine/services/${serviceId}/reviews/stats`);
    expect(publicStats.body.reviewCount).toBe(0);

    const pendingList = await agent
      .get('/api/gestion/learning/reviews?status=pending&type=service')
      .set('Cookie', adminCookie);
    expect(pendingList.status).toBe(200);
    expect(pendingList.body.reviews).toHaveLength(1);
    expect(pendingList.body.reviews[0].id).toBe(reviewId);
    expect(pendingList.body.reviews[0].isManual).toBe(true);
    expect(pendingList.body.counts.pending).toBe(1);
    expect(pendingList.body.countsByType.service).toBe(1);

    const allReviews = await agent
      .get('/api/gestion/learning/reviews')
      .set('Cookie', adminCookie);
    expect(allReviews.status).toBe(200);
    expect(allReviews.body.countsByType.formation).toBe(1);
    expect(allReviews.body.countsByType.service).toBe(1);

    const publish = await agent
      .patch(`/api/gestion/learning/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' });
    expect(publish.status).toBe(200);

    publicStats = await agent.get(`/api/vitrine/services/${serviceId}/reviews/stats`);
    expect(publicStats.body.reviewCount).toBe(1);
    expect(publicStats.body.averageRating).toBe(5);
  });

  it('honors a custom (backdated) review date and rejects a future date', async () => {
    const adminCookie = await login('admin@test.local');
    const serviceId = String(fx.service._id);

    const backdated = await agent
      .post('/api/gestion/learning/reviews/manual')
      .set('Cookie', adminCookie)
      .send({
        targetType: 'service',
        targetId: serviceId,
        displayName: 'Lea',
        rating: 5,
        comment: 'Avis anterieur.',
        status: 'published',
        reviewDate: '2020-01-15',
      });
    expect(backdated.status).toBe(201);
    const stored = await Review.findById(backdated.body.review.id).lean();
    expect(new Date(stored.createdAt).toISOString().slice(0, 10)).toBe('2020-01-15');

    const future = await agent
      .post('/api/gestion/learning/reviews/manual')
      .set('Cookie', adminCookie)
      .send({
        targetType: 'service',
        targetId: serviceId,
        displayName: 'Lea',
        rating: 5,
        status: 'published',
        reviewDate: '2999-01-01',
      });
    expect(future.status).toBe(400);
  });

  it('exposes averageRating and reviewCount on the public services listing', async () => {
    const adminCookie = await login('admin@test.local');
    const serviceId = String(fx.service._id);

    for (const rating of [4, 2]) {
      const created = await agent
        .post('/api/gestion/learning/reviews/manual')
        .set('Cookie', adminCookie)
        .send({ targetType: 'service', targetId: serviceId, displayName: 'Client', rating, status: 'published' });
      expect(created.status).toBe(201);
    }

    const listing = await agent.get('/api/vitrine/services');
    expect(listing.status).toBe(200);
    const entry = (listing.body.services || []).find(s => s.id === serviceId);
    expect(entry).toBeTruthy();
    expect(entry.reviewCount).toBe(2);
    expect(entry.averageRating).toBe(3);
  });
});
