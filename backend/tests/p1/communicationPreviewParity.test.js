// LOT2 §2 — Aperçu = PRODUCTION. Le endpoint de preview rend avec EXACTEMENT le renderer de
// production (`replaceTemplateVariables` + `withMailThemeVars`) : échappement HTML, données
// d'exemple, override optionnel, variables utilisées/inconnues.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/mailService.js', () => ({
  mailFunctions: ['vente'],
  loadTemplate: vi.fn(async () => ({
    subject: 'Commande {{saleid}}',
    fullHtml: '<p>Bonjour {{customername}} — <a href="{{actionurl}}">accéder</a></p>',
    bodyHtml: 'Bonjour {{customername}}',
  })),
  saveTemplate: vi.fn(),
  simulateSaleEmail: vi.fn(),
}));

const { previewTemplate } = await import('../../controllers/mailTemplateController.js');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('LOT2 — aperçu = production', () => {
  it('rend le template publié avec les données d\'exemple (aucun {{}} résiduel connu)', async () => {
    const res = mockRes();
    await previewTemplate({ params: { functionName: 'vente' }, body: {} }, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.html).not.toContain('{{customername}}');
    expect(res.body.subject).toContain('Commande ');
    // actionurl est raw (URL non échappée dans href)
    expect(res.body.html).toContain('href="https://');
  });

  it('échappe les valeurs utilisateur (parité avec l\'envoi réel)', async () => {
    const res = mockRes();
    await previewTemplate({
      params: { functionName: 'vente' },
      body: { subject: 'x', html: '<p>{{customername}}</p>', text: 'x', variables: { customername: '<script>alert(1)</script>' } },
    }, res);
    expect(res.body.html).not.toContain('<script>');
    expect(res.body.html).toContain('&lt;script&gt;');
  });

  it('utilise le brouillon fourni (aperçu live avant sauvegarde)', async () => {
    const res = mockRes();
    await previewTemplate({
      params: { functionName: 'vente' },
      body: { subject: 'Brouillon {{firstname}}', html: '<b>{{firstname}}</b>', text: '' },
    }, res);
    expect(res.body.subject).toContain('Brouillon ');
    expect(res.body.html).not.toContain('{{firstname}}');
  });

  it('signale les variables inconnues', async () => {
    const res = mockRes();
    await previewTemplate({
      params: { functionName: 'vente' },
      body: { subject: '{{inconnue}}', html: '<p>{{customername}}</p>', text: '' },
    }, res);
    expect(res.body.unknownVariables).toContain('inconnue');
  });

  it('refuse un template inconnu (400)', async () => {
    const res = mockRes();
    await previewTemplate({ params: { functionName: 'nope' }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});
