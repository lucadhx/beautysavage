// tests/p1/communicationRoleResolver.test.js
// M1 — Resolver fromRole/toRole : sender support/commerciale, recipient client depuis contexte,
// erreur contrôlée si identité absente.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';
import { resolveSender, resolveRecipient, resolveMailEnvelope } from '../../services/communicationRoleResolver.js';

async function seedActive(role, scope, email, displayName) {
  return CommunicationIdentity.create({ role, scope, email, displayName, status: 'verified', active: true });
}

describe('communicationRoleResolver', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommunicationIdentity.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); });

  it('resolveSender support', async () => {
    await seedActive('support', 'platform', 'sup@b.fr', 'Support BS');
    expect(await resolveSender('support')).toEqual({ email: 'sup@b.fr', name: 'Support BS', role: 'support' });
  });

  it('resolveSender commerciale', async () => {
    await seedActive('commerciale', 'institute', 'com@b.fr', 'Commercial BS');
    expect(await resolveSender('commerciale')).toEqual({ email: 'com@b.fr', name: 'Commercial BS', role: 'commerciale' });
  });

  it('resolveSender refuse un fromRole invalide (client)', async () => {
    await expect(resolveSender('client')).rejects.toMatchObject({ code: 'invalid_from_role' });
  });

  it('resolveRecipient client depuis le contexte', async () => {
    const r = await resolveRecipient('client', { client: { email: 'Client@Mail.fr', name: 'Jane' } });
    expect(r).toEqual({ email: 'client@mail.fr', name: 'Jane', role: 'client' });
  });

  it('resolveRecipient client absent → erreur contrôlée', async () => {
    await expect(resolveRecipient('client', {})).rejects.toMatchObject({ code: 'client_recipient_missing' });
  });

  it('erreur contrôlée si identité expéditrice absente', async () => {
    await expect(resolveSender('support')).rejects.toMatchObject({ code: 'identity_not_ready', status: 409 });
  });

  it('resolveMailEnvelope commerciale → client', async () => {
    await seedActive('commerciale', 'institute', 'com@b.fr', 'Commercial BS');
    const env = await resolveMailEnvelope({ fromRole: 'commerciale', toRole: 'client', context: { client: { email: 'c@m.fr' } } });
    expect(env.from.role).toBe('commerciale');
    expect(env.to).toEqual([{ email: 'c@m.fr', name: undefined, role: 'client' }]);
  });
});
