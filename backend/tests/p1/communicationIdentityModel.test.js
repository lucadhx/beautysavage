// tests/p1/communicationIdentityModel.test.js
// M1 — Modèle CommunicationIdentity : enums, scope cohérent, email lowercase, displayName requis,
// un seul actif par (role, scope).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';

describe('CommunicationIdentity model', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommunicationIdentity.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); });

  it('crée une identité support platform et normalise l’email', async () => {
    const i = await CommunicationIdentity.create({ role: 'support', scope: 'platform', email: 'Support@Beauty.FR', displayName: 'Support' });
    expect(i.email).toBe('support@beauty.fr');
    expect(i.status).toBe('unverified');
    expect(i.active).toBe(false);
  });

  it('crée une identité commerciale institute', async () => {
    const i = await CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'c@b.fr', displayName: 'Commercial' });
    expect(i.role).toBe('commerciale');
    expect(i.scope).toBe('institute');
  });

  it('refuse le rôle client (hors enum)', async () => {
    await expect(CommunicationIdentity.create({ role: 'client', scope: 'platform', email: 'x@y.fr', displayName: 'X' })).rejects.toThrow();
  });

  it('refuse un scope incohérent avec le rôle', async () => {
    await expect(CommunicationIdentity.create({ role: 'support', scope: 'institute', email: 'x@y.fr', displayName: 'X' })).rejects.toThrow();
  });

  it('exige displayName', async () => {
    await expect(CommunicationIdentity.create({ role: 'support', scope: 'platform', email: 'x@y.fr' })).rejects.toThrow();
  });

  it('un seul actif par (role, scope) — index unique partiel', async () => {
    await CommunicationIdentity.create({ role: 'support', scope: 'platform', email: 'a@b.fr', displayName: 'A', status: 'verified', active: true });
    await expect(
      CommunicationIdentity.create({ role: 'support', scope: 'platform', email: 'c@b.fr', displayName: 'C', status: 'verified', active: true })
    ).rejects.toMatchObject({ code: 11000 });
    // Deux inactives : OK
    await CommunicationIdentity.create({ role: 'support', scope: 'platform', email: 'd@b.fr', displayName: 'D' });
    expect(await CommunicationIdentity.countDocuments({ role: 'support' })).toBe(2);
  });
});
