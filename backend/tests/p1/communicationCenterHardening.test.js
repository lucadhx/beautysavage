// COMMUNICATION-CENTER — Wave 1 (durcissement sécurité + conformité expéditeur).
// Couvre :
//  P0-1 — échappement HTML des valeurs interpolées (mode html), raw pour URL/thème/refundsection,
//         aucun échappement en mode texte (défaut, rétro-compat).
//  P0-2 — maskEmail : jamais l'adresse complète dans les logs.
//  P1-1 — buildSenderForRole honore fromRole (support vs commerciale) ; buildSender() = commerciale.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';
import { replaceTemplateVariables, escapeHtml, maskEmail } from '../../services/mail/mailRenderer.js';
import { buildSender, buildSenderForRole } from '../../services/mail/mailSenderResolver.js';

describe('P0-1 — replaceTemplateVariables échappe les valeurs en mode HTML', () => {
  it('échappe une valeur utilisateur injectée dans le HTML', () => {
    const out = replaceTemplateVariables(
      '<p>Bonjour {{customername}}</p>',
      { customername: '<script>alert(1)</script>' },
      { html: true }
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('échappe les guillemets/apostrophes (rupture d\'attribut)', () => {
    const out = replaceTemplateVariables('<a title="{{clientname}}">x</a>', { clientname: '"><img src=x>' }, { html: true });
    expect(out).not.toContain('"><img');
    expect(out).toContain('&quot;&gt;&lt;img');
  });

  it('N\'échappe PAS les URLs, couleurs de thème et fragments HTML pré-construits', () => {
    const url = 'https://x.test/app/invoice/abc?a=1&b=2';
    const refundSection = '<div style="color:red">Remboursé</div>';
    const out = replaceTemplateVariables(
      '<a href="{{actionurl}}">L</a><span style="color:{{themeaccent}}">c</span>{{refundsection}}',
      { actionurl: url, themeaccent: '#ff0000', refundsection: refundSection },
      { html: true }
    );
    expect(out).toContain(`href="${url}"`);
    expect(out).toContain('color:#ff0000');
    expect(out).toContain(refundSection);
  });

  it('N\'échappe PAS en mode texte (défaut) — rétro-compatibilité stricte', () => {
    const out = replaceTemplateVariables('Bonjour {{customername}}', { customername: 'A & B <x>' });
    expect(out).toBe('Bonjour A & B <x>');
  });

  it('laisse littérales les variables inconnues', () => {
    const out = replaceTemplateVariables('{{unknownVar}}', { unknownvar: 'x' }, { html: true });
    expect(out).toBe('{{unknownVar}}');
  });
});

describe('P0-1 — escapeHtml', () => {
  it('échappe les 5 caractères sensibles', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('P0-2 — maskEmail', () => {
  it('masque le local-part en conservant le domaine', () => {
    expect(maskEmail('jean.dupont@gmail.com')).toBe('j***@gmail.com');
  });
  it('accepte un destinataire Brevo { email }', () => {
    expect(maskEmail({ email: 'alice@x.fr' })).toBe('a***@x.fr');
  });
  it('ne fuit rien pour une valeur non-email', () => {
    expect(maskEmail('pas-un-email')).toBe('[masqué]');
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
  });
});

describe('P1-1 — buildSenderForRole honore le rôle', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    await CommunicationIdentity.create({
      role: 'support', scope: 'platform', email: 'support@plateforme.test',
      displayName: 'Support', status: 'verified', active: true
    });
    await CommunicationIdentity.create({
      role: 'commerciale', scope: 'institute', email: 'contact@institut.test',
      displayName: 'Institut', status: 'verified', active: true
    });
  });

  it('support → identité plateforme', async () => {
    const sender = await buildSenderForRole('support');
    expect(sender?.email).toBe('support@plateforme.test');
  });

  it('commerciale → identité institut', async () => {
    const sender = await buildSenderForRole('commerciale');
    expect(sender?.email).toBe('contact@institut.test');
  });

  it('buildSender() reste = commerciale (rétro-compat)', async () => {
    const sender = await buildSender();
    expect(sender?.email).toBe('contact@institut.test');
  });

  it('rôle inconnu → traité comme commerciale (jamais support par erreur)', async () => {
    const sender = await buildSenderForRole('n_importe_quoi');
    expect(sender?.email).toBe('contact@institut.test');
  });
});
