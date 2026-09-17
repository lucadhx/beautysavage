// LOT2 §5 — Communications manquantes (P1-12) : payment_failed, refund_refused, refund_failed,
// training_certificate_available. On vérifie que chaque fonction d'envoi rend le bon template,
// cible le bon destinataire, part de l'identité commerciale, et passe les variables attendues.
// Brevo + identité + template mockés (aucun envoi réel, aucun accès DB).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ payloads: [], roles: [] }));

vi.mock('../../services/mail/mailBrevoGateway.js', () => ({
  postToBrevo: vi.fn(async (p) => { h.payloads.push(p); return true; }),
}));
vi.mock('../../services/mail/mailSenderResolver.js', () => ({
  buildSender: vi.fn(async () => ({ email: 'contact@institut.test', name: 'Institut' })),
  buildSenderForRole: vi.fn(async (r) => { h.roles.push(r); return { email: 'contact@institut.test', name: 'Institut' }; }),
}));
vi.mock('../../services/mail/mailTemplateRuntime.js', () => ({
  loadTemplate: vi.fn(async (k) => ({
    subject: `SUJ:${k}:{{itemdetail}}{{formationtitle}}`,
    fullHtml: '<p>{{firstname}} | {{itemdetail}} | {{amount}} | {{refundreason}} | {{formationtitle}}</p>',
    bodyHtml: '',
  })),
}));

const {
  sendPaymentFailedEmail,
  sendRefundRefusedEmail,
  sendRefundFailedEmail,
  sendCertificateAvailableEmail,
} = await import('../../services/mail/mailDomainDispatchers.js');

beforeEach(() => { h.payloads.length = 0; h.roles.length = 0; });

describe('LOT2 — payment_failed', () => {
  it('envoie au client, expéditeur commerciale, avec article + montant', async () => {
    const ok = await sendPaymentFailedEmail({ toEmail: 'x@y.fr', firstName: 'Alice', itemDetail: 'Soin visage', amount: '49.90', actionUrl: 'https://bs.test/pay' });
    expect(ok).toBe(true);
    expect(h.payloads[0].to).toEqual([{ email: 'x@y.fr' }]);
    expect(h.roles).toContain('commerciale');
    expect(h.payloads[0].subject).toContain('Soin visage');
    expect(h.payloads[0].htmlContent).toContain('Soin visage');
    expect(h.payloads[0].htmlContent).toContain('49,90');
  });
  it('sans e-mail → aucun envoi', async () => {
    const ok = await sendPaymentFailedEmail({ toEmail: '', itemDetail: 'x' });
    expect(ok).toBe(false);
    expect(h.payloads).toHaveLength(0);
  });
});

describe('LOT2 — refund_refused', () => {
  it('inclut le motif de refus', async () => {
    await sendRefundRefusedEmail({ toEmail: 'x@y.fr', firstName: 'A', itemDetail: 'Formation X', refundReason: 'Hors délai', actionUrl: 'https://bs.test/s' });
    expect(h.payloads[0].htmlContent).toContain('Hors délai');
  });
});

describe('LOT2 — refund_failed', () => {
  it('inclut le montant et l\'article', async () => {
    await sendRefundFailedEmail({ toEmail: 'x@y.fr', firstName: 'A', itemDetail: 'Formation Y', amount: '80.00', actionUrl: 'https://bs.test/s' });
    expect(h.payloads[0].htmlContent).toContain('Formation Y');
    expect(h.payloads[0].htmlContent).toContain('80,00');
  });
});

describe('LOT2 — training_certificate_available', () => {
  it('inclut le titre de la formation', async () => {
    await sendCertificateAvailableEmail({ toEmail: 'x@y.fr', firstName: 'A', formationTitle: 'Extensions cils', actionUrl: 'https://bs.test/mes-formations' });
    expect(h.payloads[0].subject).toContain('Extensions cils');
    expect(h.payloads[0].htmlContent).toContain('Extensions cils');
  });
});
