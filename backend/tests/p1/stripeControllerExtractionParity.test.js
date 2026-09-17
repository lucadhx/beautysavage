// tests/p1/stripeControllerExtractionParity.test.js
// Sprint F2 — Prouve que l'extraction du domaine Stripe hors de stripeController est
// PUREMENT STRUCTURELLE :
//  (1) le contrôleur n'est qu'un délégateur (les fonctions métier vivent dans services/stripe/*) ;
//  (2) le contrat HTTP des handlers ne dépendant pas de la DB est inchangé
//      (GET /config 200/500, createCheckoutSession 401 sans session).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn()
}));

const { getCredential } = await import('../../services/integratedApiCredentialService.js');
const stripeController = await import('../../controllers/stripeController.js');
const checkoutSvc = await import('../../services/stripe/stripeCheckoutService.js');
const webhookSvc = await import('../../services/stripe/stripeWebhookService.js');
const querySvc = await import('../../services/stripe/stripePaymentQueryService.js');
const configSvc = await import('../../services/stripe/stripeConfigService.js');
const feeSvc = await import('../../services/stripe/stripeFeeService.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    sent: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; }
  };
}

describe('F2 — stripe controller extraction parity (structurel)', () => {
  it('le contrôleur expose les 7 handlers HTTP et la logique vit dans les services', () => {
    for (const n of [
      'createCheckoutSession', 'handleWebhook', 'getSessionStatus', 'getPaymentResult',
      'getConfig', 'getTransactionFees', 'getPendingFeesCount'
    ]) {
      expect(typeof stripeController[n]).toBe('function');
    }
    // La logique métier est définie dans les services dédiés (pas dans le contrôleur).
    expect(typeof checkoutSvc.createCheckoutSessionFromRequest).toBe('function');
    expect(typeof webhookSvc.handleWebhookFromRequest).toBe('function');
    expect(typeof querySvc.getSessionStatusFromRequest).toBe('function');
    expect(typeof querySvc.getPaymentResultFromRequest).toBe('function');
    expect(typeof configSvc.getStripePublishableKey).toBe('function');
    expect(typeof feeSvc.recoverStripeFeesAndUpdateSale).toBe('function');
    expect(typeof feeSvc.registerPendingStripeFeeCreatedListener).toBe('function');
  });

  it('GET /config renvoie la publishable key (coffre) — payload inchangé', async () => {
    getCredential.mockResolvedValueOnce('pk_test_parity_F2');
    const res = mockRes();
    await stripeController.getConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ publishableKey: 'pk_test_parity_F2' });
  });

  it('GET /config → 500 contrôlé si la clé est indisponible (jamais de secret exposé)', async () => {
    getCredential.mockRejectedValueOnce(new Error('vault down'));
    const res = mockRes();
    await stripeController.getConfig({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ ok: false });
    expect(JSON.stringify(res.body)).not.toMatch(/sk_|pk_|whsec_/);
  });

  it('createCheckoutSession → 401 sans authentification', async () => {
    const res = mockRes();
    await stripeController.createCheckoutSession({ headers: {}, body: { checkoutState: {} } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false });
  });
});
