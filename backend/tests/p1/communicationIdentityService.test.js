// tests/p1/communicationIdentityService.test.js
// M1 — Service : create support/commerciale, client refusé, displayName requis, email normalisé,
// setActive interdit si non vérifié, getActiveIdentity, assertIdentityReady.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';
import {
  createCommunicationIdentity,
  setActiveCommunicationIdentity,
  getActiveIdentity,
  assertIdentityReady,
  CommunicationIdentityError
} from '../../services/communicationIdentityService.js';

describe('communicationIdentityService', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommunicationIdentity.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); });

  it('crée support (scope déduit platform) + email normalisé', async () => {
    const i = await createCommunicationIdentity({ role: 'support', email: 'SUP@B.FR', displayName: 'Sup' });
    expect(i.scope).toBe('platform');
    expect(i.email).toBe('sup@b.fr');
    expect(i.domain).toBe('b.fr');
  });

  it('crée commerciale (scope déduit institute)', async () => {
    const i = await createCommunicationIdentity({ role: 'commerciale', email: 'c@b.fr', displayName: 'Com' });
    expect(i.scope).toBe('institute');
  });

  it('refuse role client', async () => {
    await expect(createCommunicationIdentity({ role: 'client', email: 'c@b.fr', displayName: 'X' }))
      .rejects.toMatchObject({ code: 'client_not_configurable' });
  });

  it('refuse scope incohérent', async () => {
    await expect(createCommunicationIdentity({ role: 'support', scope: 'institute', email: 'c@b.fr', displayName: 'X' }))
      .rejects.toMatchObject({ code: 'invalid_scope' });
  });

  it('exige displayName', async () => {
    await expect(createCommunicationIdentity({ role: 'support', email: 'c@b.fr', displayName: '  ' }))
      .rejects.toMatchObject({ code: 'display_name_required' });
  });

  it('setActive interdit si non vérifié', async () => {
    const i = await createCommunicationIdentity({ role: 'support', email: 'c@b.fr', displayName: 'X' });
    await expect(setActiveCommunicationIdentity(i._id, 'actor')).rejects.toMatchObject({ code: 'identity_not_verified' });
  });

  it('setActive ok si vérifié, désactive les autres du même scope', async () => {
    const a = await createCommunicationIdentity({ role: 'support', email: 'a@b.fr', displayName: 'A' });
    const b = await createCommunicationIdentity({ role: 'support', email: 'b@b.fr', displayName: 'B' });
    await CommunicationIdentity.updateMany({}, { status: 'verified' });
    await setActiveCommunicationIdentity(a._id, 'actor');
    await setActiveCommunicationIdentity(b._id, 'actor');
    expect((await CommunicationIdentity.findById(a._id)).active).toBe(false);
    expect((await CommunicationIdentity.findById(b._id)).active).toBe(true);
    expect(await CommunicationIdentity.countDocuments({ role: 'support', active: true })).toBe(1);
  });

  it('getActiveIdentity + assertIdentityReady', async () => {
    await expect(assertIdentityReady('support', 'platform')).rejects.toMatchObject({ code: 'identity_not_ready' });
    expect((await assertIdentityReady('support', 'platform', { mode: 'warn' })).ready).toBe(false);

    const i = await createCommunicationIdentity({ role: 'support', email: 'a@b.fr', displayName: 'A' });
    await CommunicationIdentity.updateOne({ _id: i._id }, { status: 'verified' });
    await setActiveCommunicationIdentity(i._id, 'actor');
    const active = await getActiveIdentity('support', 'platform');
    expect(active.email).toBe('a@b.fr');
    const ready = await assertIdentityReady('support', 'platform');
    expect(ready.ready).toBe(true);
    expect(ready.domainAuthenticated).toBe(false);
  });

  it('CommunicationIdentityError est exportée', () => {
    expect(new CommunicationIdentityError('x', 'y', 400).code).toBe('x');
  });
});
