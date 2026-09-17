// tests/p1/mailSenderResolverNoMailFrom.test.js
// LOT1 — Le vestige MAIL_FROM est supprimé : l'expéditeur vient EXCLUSIVEMENT de
// CommunicationIdentity. Sans identité vérifiée, buildSender() renvoie null (jamais MAIL_FROM),
// et resolveSenderStrict lève SENDER_NOT_CONFIGURED. Le seed dev restaure un expéditeur.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { buildSender, resolveSenderStrict, SenderNotConfiguredError } = await import('../../services/mail/mailSenderResolver.js');
const { seedDevCommunicationIdentity } = await import('../../seeders/seedDevCommunicationIdentity.js');

describe('mailSenderResolver — sans MAIL_FROM', () => {
  beforeAll(async () => { await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('MAIL_FROM est bien positionné dans l\'env de test (garantit que le fallback est retiré, pas absent)', () => {
    expect(String(process.env.MAIL_FROM || '')).toBeTruthy();
  });

  it('sans identité vérifiée → buildSender() renvoie null (aucun fallback MAIL_FROM)', async () => {
    const sender = await buildSender();
    expect(sender).toBeNull();
  });

  it('resolveSenderStrict lève SENDER_NOT_CONFIGURED (fail-loud, jamais silencieux)', async () => {
    await expect(resolveSenderStrict('commerciale')).rejects.toBeInstanceOf(SenderNotConfiguredError);
    await expect(resolveSenderStrict('commerciale')).rejects.toMatchObject({ code: 'SENDER_NOT_CONFIGURED' });
  });

  it('le seed dev crée une identité commerciale vérifiée → buildSender() la renvoie (≠ MAIL_FROM)', async () => {
    const seeded = await seedDevCommunicationIdentity({ force: true });
    expect(seeded.skipped).toBe(false);
    const sender = await buildSender();
    expect(sender).not.toBeNull();
    // L'expéditeur provient de l'identité seedée en base (et non d'un fallback hardcodé) :
    // sans identité (test précédent) buildSender() était null → la source est bien la DB.
    expect(sender.email).toBe(seeded.email);
  });

  it('seed idempotent : un second appel ne recrée pas d\'identité active', async () => {
    await seedDevCommunicationIdentity({ force: true });
    const again = await seedDevCommunicationIdentity({ force: true });
    expect(again.created).toBe(false);
    expect(again.skipped).toBe(true);
  });
});
