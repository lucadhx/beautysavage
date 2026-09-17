// tests/p1/themeScopeMigration.test.js
// Migration multi-scope : dry-run sans écriture, --apply idempotent, legacy→vitrine, manager créé,
// dédoublonnage des actifs par scope.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Theme from '../../models/Theme.js';
import { migrateThemesToScopes } from '../../scripts/migrateThemesToScopes.js';

const COLORS = { primary: '#5f4ff7', secondary: '#f24692', background: '#f5f4ef', surface: '#ffffff', text: '#0f172a' };

async function insertLegacy(name, isActive, extra = {}) {
  return Theme.collection.insertOne({ name, colors: COLORS, isActive, createdAt: new Date(), ...extra });
}

describe('migrateThemesToScopes', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await Theme.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await Theme.syncIndexes(); });

  it('dry-run : aucune écriture', async () => {
    await insertLegacy('Legacy', true);
    const res = await migrateThemesToScopes({ apply: false });
    expect(res.applied).toBe(false);
    expect(res.plan.setScopeVitrine.length).toBe(1);
    expect(res.plan.createManager).toBe(true);
    const doc = await Theme.collection.findOne({ name: 'Legacy' });
    expect(doc.scope).toBeUndefined(); // pas d'écriture
    expect(await Theme.countDocuments({ scope: 'manager' })).toBe(0);
  });

  it('--apply : legacy→vitrine, crée un thème manager actif, ne désactive pas le vitrine actif', async () => {
    await insertLegacy('Legacy', true);
    const res = await migrateThemesToScopes({ apply: true });
    expect(res.applied).toBe(true);

    const legacy = await Theme.findOne({ name: 'Legacy' });
    expect(legacy.scope).toBe('vitrine');
    expect(legacy.isActive).toBe(true); // vitrine actif conservé

    const managerActive = await Theme.findOne({ scope: 'manager', isActive: true });
    expect(managerActive).toBeTruthy();
    expect(res.createdManagerName).toBeTruthy();
  });

  it('idempotent : un 2e apply ne crée pas de 2e thème manager', async () => {
    await insertLegacy('Legacy', true);
    await migrateThemesToScopes({ apply: true });
    await migrateThemesToScopes({ apply: true });
    expect(await Theme.countDocuments({ scope: 'manager' })).toBe(1);
    expect(await Theme.countDocuments({ scope: 'vitrine', isActive: true })).toBe(1);
  });

  it('dédoublonne les actifs vitrine (garde le plus récent)', async () => {
    await insertLegacy('Old', true, { scope: 'vitrine', createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-01') });
    await insertLegacy('NewLegacy', true, { createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') });
    await migrateThemesToScopes({ apply: true });
    expect(await Theme.countDocuments({ scope: 'vitrine', isActive: true })).toBe(1);
    const stillActive = await Theme.findOne({ scope: 'vitrine', isActive: true });
    expect(stillActive.name).toBe('NewLegacy'); // le plus récent
  });
});
