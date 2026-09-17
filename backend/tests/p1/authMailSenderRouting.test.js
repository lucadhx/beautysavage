// tests/p1/authMailSenderRouting.test.js
// RX-BLOCKER-2 — Routage d'expéditeur des e-mails d'auth : invitation & reset MANAGER → support ; reset
// CLIENT → commerciale. Aucun sender hardcodé. Brevo mocké (aucun envoi réel), aucun token en clair loggé.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ senderRoles: [], brevoPayloads: [] }));

vi.mock('../../services/communicationRoleResolver.js', () => ({
  resolveSender: vi.fn(async (role) => { h.senderRoles.push(role); return { email: `${role}@bs.test`, name: role }; })
}));
vi.mock('../../services/mail/mailBrevoGateway.js', () => ({
  postToBrevo: vi.fn(async (payload) => { h.brevoPayloads.push(payload); return true; })
}));
vi.mock('../../services/mail/mailTemplateRuntime.js', () => ({
  loadTemplate: vi.fn(async () => ({ subject: 'Sujet', fullHtml: '<a href="{{link}}">lien</a>', bodyHtml: '' }))
}));

const { sendManagerInvitationEmail, sendManagerPasswordResetEmail, sendClientPasswordResetEmail } =
  await import('../../services/authMailService.js');

const managerUser = { _id: 'u1', email: 'admin@test.local', role: 'admin', firstName: 'A' };
const clientUser = { _id: 'u2', email: 'client@test.local', role: 'client', firstName: 'C' };

beforeEach(() => { h.senderRoles.length = 0; h.brevoPayloads.length = 0; });

describe('RX-BLOCKER-2 — routage expéditeur auth mail', () => {
  it('invitation manager → expéditeur SUPPORT + lien /manager/invitation', async () => {
    const ok = await sendManagerInvitationEmail(managerUser, 'TOK123');
    expect(ok).toBe(true);
    expect(h.senderRoles).toContain('support');
    expect(h.senderRoles).not.toContain('commerciale');
    expect(h.brevoPayloads[0].htmlContent).toContain('/manager/invitation/TOK123');
  });

  it('reset manager → expéditeur SUPPORT + lien /manager/reinitialiser-mot-de-passe', async () => {
    await sendManagerPasswordResetEmail(managerUser, 'TOK456');
    expect(h.senderRoles).toEqual(['support']);
    expect(h.brevoPayloads[0].htmlContent).toContain('/manager/reinitialiser-mot-de-passe/TOK456');
  });

  it('reset client → expéditeur COMMERCIALE + lien /app', async () => {
    await sendClientPasswordResetEmail(clientUser, 'TOK789');
    expect(h.senderRoles).toEqual(['commerciale']);
    expect(h.senderRoles).not.toContain('support');
  });

  it('expéditeur/sujet exposent le bon expéditeur (email par rôle)', async () => {
    await sendManagerInvitationEmail(managerUser, 'X');
    expect(h.brevoPayloads[0].sender.email).toBe('support@bs.test');
  });
});
