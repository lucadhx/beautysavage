// COMMUNICATION-CENTER — Wave 3 (outillage template : catalogue variables + envoi de test).
// P1-3 — catalogue canonique backend + validation (variables inconnues / accolades mal fermées).
// P1-2 — envoi de test : [TEST], données d'exemple, aucun event métier, aucun token réel.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VARIABLE_KEYS } from '../../services/mail/mailRenderer.js';
import {
  getMailVariableCatalog,
  buildSampleTemplateData,
  validateTemplateContent
} from '../../services/mail/mailTemplateVariableCatalog.js';

describe('P1-3 — catalogue de variables', () => {
  it('est exhaustif (aligné sur VARIABLE_KEYS)', () => {
    const catalog = getMailVariableCatalog();
    expect(catalog.length).toBe(VARIABLE_KEYS.size);
    for (const entry of catalog) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('example');
      expect(entry).toHaveProperty('source');
    }
  });

  it('les URLs et fragments HTML sont marqués raw', () => {
    const byKey = new Map(getMailVariableCatalog().map((e) => [e.key, e]));
    expect(byKey.get('actionurl').raw).toBe(true);
    expect(byKey.get('refundsection').raw).toBe(true);
    expect(byKey.get('customername').raw).toBe(false);
  });

  it('buildSampleTemplateData couvre toutes les variables connues', () => {
    const sample = buildSampleTemplateData();
    for (const key of VARIABLE_KEYS) {
      expect(sample[key]).toBeDefined();
    }
  });

  it('n\'utilise aucun vrai token dans les exemples (placeholders EX_ uniquement)', () => {
    const sample = buildSampleTemplateData();
    expect(sample.invoicedownloadurl).toContain('EX_TOKEN');
    expect(sample.trackingurl).toContain('EX_TOKEN');
  });
});

describe('P1-3 — validateTemplateContent', () => {
  it('détecte les variables inconnues', () => {
    const r = validateTemplateContent('Bonjour {{customername}}, {{inconnue}}');
    expect(r.unknownVariables).toContain('inconnue');
    expect(r.unknownVariables).not.toContain('customername');
  });
  it('détecte les accolades mal fermées', () => {
    expect(validateTemplateContent('{{customername}').malformed).toBe(true);
    expect(validateTemplateContent('{{customername}}').malformed).toBe(false);
  });
});

// --- P1-2 test-send (controller, Brevo mocké) --------------------------------
const h = vi.hoisted(() => ({ payloads: [], contexts: [] }));

vi.mock('../../services/mailService.js', () => ({
  mailFunctions: ['vente'],
  loadTemplate: vi.fn(async () => ({
    subject: 'Votre commande {{saleid}}',
    fullHtml: '<p>Bonjour {{customername}} — <a href="{{actionurl}}">accéder</a></p>',
    bodyHtml: 'Bonjour {{customername}}'
  })),
  saveTemplate: vi.fn(),
  simulateSaleEmail: vi.fn()
}));
vi.mock('../../services/mail/mailBrevoGateway.js', () => ({
  postToBrevo: vi.fn(async (payload, context) => { h.payloads.push(payload); h.contexts.push(context); return true; })
}));
vi.mock('../../services/mail/mailSenderResolver.js', () => ({
  buildSender: vi.fn(async () => ({ email: 'contact@institut.test', name: 'Institut' })),
  buildSenderForRole: vi.fn(async () => ({ email: 'contact@institut.test', name: 'Institut' }))
}));

const { testSendTemplate } = await import('../../controllers/mailTemplateController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

describe('P1-2 — envoi de test', () => {
  beforeEach(() => { h.payloads.length = 0; h.contexts.length = 0; });

  it('envoie un test préfixé [TEST] à l\'adresse fournie, marqué comme test', async () => {
    const res = mockRes();
    await testSendTemplate({ params: { functionName: 'vente' }, body: { toEmail: 'dev@bs.test' } }, res);
    expect(res.body.ok).toBe(true);
    expect(h.payloads).toHaveLength(1);
    expect(h.payloads[0].subject.startsWith('[TEST] ')).toBe(true);
    expect(h.payloads[0].to).toEqual([{ email: 'dev@bs.test' }]);
    expect(h.payloads[0].tags).toContain('test');
    expect(h.contexts[0].contextType).toBe('test');
    // Données d'exemple rendues (pas de {{...}} résiduel dans le HTML).
    expect(h.payloads[0].htmlContent).not.toContain('{{customername}}');
  });

  it('refuse une adresse invalide (400) sans rien envoyer', async () => {
    const res = mockRes();
    await testSendTemplate({ params: { functionName: 'vente' }, body: { toEmail: 'pas-un-email' } }, res);
    expect(res.statusCode).toBe(400);
    expect(h.payloads).toHaveLength(0);
  });

  it('refuse un template inconnu (400)', async () => {
    const res = mockRes();
    await testSendTemplate({ params: { functionName: 'inexistant' }, body: { toEmail: 'dev@bs.test' } }, res);
    expect(res.statusCode).toBe(400);
    expect(h.payloads).toHaveLength(0);
  });
});
