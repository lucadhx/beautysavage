// tests/p1/stripeDevWebhookExtractionParity.test.js
// Sprint F2B — Le webhook Stripe Dev a été extrait vers services/stripe/dev/*. Ce test
// verrouille le contrat HTTP du routing webhook Dev après extraction (signature/secret/client
// manquant/event non géré). La finalisation commission par webhook est couverte (inchangée)
// par commissionDevWebhookFinalization.
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { client: null };
  return { state };
});
vi.mock('../../utils/stripeDevClient.js', () => ({
  getStripeDevClient: async () => h.state.client,
  default: async () => h.state.client
}));
vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'whsec_test_dev')
}));

const { getCredential } = await import('../../services/integratedApiCredentialService.js');
const { handleDevWebhook } = await import('../../controllers/devWebhookController.js');
const { handleDevWebhookFromRequest } = await import('../../services/stripe/dev/stripeDevWebhookService.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
function req(body = '{}') {
  return { headers: { 'stripe-signature': 'sig' }, body: Buffer.from(body) };
}

describe('F2B — stripe dev webhook extraction parity', () => {
  it('client Dev absent → 500 contrôlé', async () => {
    h.state.client = null;
    getCredential.mockResolvedValueOnce('whsec_test_dev');
    const res = mockRes();
    await handleDevWebhook(req(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ ok: false });
  });

  it('signature invalide → 400', async () => {
    h.state.client = {
      webhooks: { constructEvent: () => { throw new Error('bad sig'); } }
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await handleDevWebhook(req(), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
  });

  it('event non géré → 200 { received: true }', async () => {
    h.state.client = {
      webhooks: { constructEvent: () => ({ type: 'customer.created', data: { object: {} } }) }
    };
    const res = mockRes();
    await handleDevWebhook(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('le service renvoie un résultat structuré { status, json } (event non géré)', async () => {
    h.state.client = {
      webhooks: { constructEvent: () => ({ type: 'charge.updated', data: { object: {} } }) }
    };
    const result = await handleDevWebhookFromRequest(req());
    expect(result).toMatchObject({ status: 200, json: { received: true } });
  });
});
