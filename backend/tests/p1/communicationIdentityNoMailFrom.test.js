// S1B — L'expéditeur des envois (buildSender) vient de CommunicationIdentity (commerciale).
// MAIL_FROM/MAIL_FROM_NAME ne sont qu'un fallback dev-only (jamais en production).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import CommunicationIdentity from '../../models/CommunicationIdentity.js';
import { buildSender } from '../../services/mail/mailSenderResolver.js';

async function seedCommerciale(email, displayName) {
  await CommunicationIdentity.create({
    role: 'commerciale',
    scope: 'institute',
    email,
    displayName,
    status: 'verified',
    active: true
  });
}

describe('buildSender — CommunicationIdentity remplace MAIL_FROM', () => {
  let prevNodeEnv, prevFrom, prevName;

  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    prevNodeEnv = process.env.NODE_ENV;
    prevFrom = process.env.MAIL_FROM;
    prevName = process.env.MAIL_FROM_NAME;
  });
  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevFrom === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = prevFrom;
    if (prevName === undefined) delete process.env.MAIL_FROM_NAME; else process.env.MAIL_FROM_NAME = prevName;
  });

  it('utilise l\'identité commerciale active+vérifiée (même en prod)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'env-should-not-be-used@example.com';
    await seedCommerciale('commerciale@beautysavage.fr', 'Beauty Savage');
    const sender = await buildSender();
    expect(sender).toEqual({ email: 'commerciale@beautysavage.fr', name: 'Beauty Savage' });
  });

  it('production sans identité → null (PAS de fallback MAIL_FROM)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_FROM = 'contact@example.com';
    process.env.MAIL_FROM_NAME = 'X';
    const sender = await buildSender();
    expect(sender).toBeNull();
  });

  it('dev sans identité → fallback MAIL_FROM autorisé', async () => {
    process.env.NODE_ENV = 'test';
    process.env.MAIL_FROM = 'dev@example.com';
    process.env.MAIL_FROM_NAME = 'Dev Sender';
    const sender = await buildSender();
    expect(sender).toEqual({ email: 'dev@example.com', name: 'Dev Sender' });
  });
});
