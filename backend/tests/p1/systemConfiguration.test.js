// S1 — SystemConfiguration : modèle singleton, service (get-or-create / update / seed /
// accessors), DomainResolver (fallback + config), parité URL facture.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import SystemConfiguration from '../../models/SystemConfiguration.js';
import {
  getOrCreateSystemConfigurationDoc,
  updateSystemConfiguration,
  seedSystemConfigurationFromEnv,
  invalidateSystemConfigurationCache,
  resolveInstituteName,
  resolveInstituteEmail
} from '../../services/system/systemConfigurationService.js';
import {
  resolveVitrineBaseUrl,
  resolvePanelBaseUrl,
  resolveVitrineUrl,
  resolvePanelUrl,
  resolvePublicBaseUrl
} from '../../services/system/domainResolver.js';
import { buildCommissionInvoiceDownloadUrl, getAppBaseUrl } from '../../utils/invoiceUrl.js';

describe('SystemConfiguration & DomainResolver', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    invalidateSystemConfigurationCache();
  });

  it('crée un document singleton unique', async () => {
    const a = await getOrCreateSystemConfigurationDoc();
    const b = await getOrCreateSystemConfigurationDoc();
    expect(String(a._id)).toBe(String(b._id));
    expect(await SystemConfiguration.countDocuments()).toBe(1);
  });

  it('valide et normalise les URLs de domaine à la mise à jour', async () => {
    const res = await updateSystemConfiguration({
      domains: { vitrineUrl: 'https://beautysavage.fr/', panelUrl: 'https://manager.beautysavage.fr' }
    });
    expect(res.ok).toBe(true);
    expect(res.config.domains.vitrineUrl).toBe('https://beautysavage.fr');
    expect(res.config.domains.panelUrl).toBe('https://manager.beautysavage.fr');
  });

  it('rejette une URL HTTP sur un domaine public', async () => {
    const res = await updateSystemConfiguration({ domains: { vitrineUrl: 'http://evil.example.com' } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTPS/);
  });

  it('DomainResolver retombe sur localhost (premier boot) quand non configuré', () => {
    const DEFAULT = 'http://localhost:3000';
    expect(resolveVitrineBaseUrl()).toBe(DEFAULT);
    expect(resolvePublicBaseUrl()).toBe(DEFAULT);
    expect(getAppBaseUrl()).toBe(DEFAULT);
  });

  it('DomainResolver utilise la configuration quand présente', async () => {
    await updateSystemConfiguration({
      domains: { vitrineUrl: 'https://beautysavage.fr', panelUrl: 'https://manager.beautysavage.fr' }
    });
    expect(resolveVitrineUrl('vitrine.html?page=refund-tracking&token=abc')).toBe(
      'https://beautysavage.fr/vitrine.html?page=refund-tracking&token=abc'
    );
    expect(resolvePanelUrl('gestion.html?module=commissionPayment')).toBe(
      'https://manager.beautysavage.fr/gestion.html?module=commissionPayment'
    );
  });

  it('le panel retombe sur la vitrine si panelUrl est vide', async () => {
    await updateSystemConfiguration({ domains: { vitrineUrl: 'https://beautysavage.fr' } });
    expect(resolvePanelBaseUrl()).toBe('https://beautysavage.fr');
  });

  it('seedSystemConfigurationFromEnv ne seede AUCUN domaine et reste idempotent', async () => {
    const prevName = process.env.INSTITUTE_NAME;
    process.env.INSTITUTE_NAME = 'Seed Institut';
    try {
      const first = await seedSystemConfigurationFromEnv();
      expect(first.institute.name).toBe('Seed Institut');
      // S1C — les domaines ne sont JAMAIS seedés depuis l'env (administrés au panel Dev).
      expect(first.domains.vitrineUrl).toBe('');
      expect(first.domains.panelUrl).toBe('');

      // Idempotent : un 2e seed ne modifie pas une valeur déjà posée.
      process.env.INSTITUTE_NAME = 'Autre Nom';
      const second = await seedSystemConfigurationFromEnv();
      expect(second.institute.name).toBe('Seed Institut');
    } finally {
      if (prevName === undefined) delete process.env.INSTITUTE_NAME;
      else process.env.INSTITUTE_NAME = prevName;
    }
  });

  it('les accesseurs reflètent la configuration (source unique)', async () => {
    await updateSystemConfiguration({
      institute: { name: 'Studio Romane', email: 'hello@studio.fr' }
    });
    expect(resolveInstituteName()).toBe('Studio Romane');
    expect(resolveInstituteEmail()).toBe('hello@studio.fr');
  });

  it('génère l’URL de facture de commission via le resolver (parité)', async () => {
    await updateSystemConfiguration({ domains: { vitrineUrl: 'https://beautysavage.fr' } });
    expect(buildCommissionInvoiceDownloadUrl('inv123', 'tok456')).toBe(
      'https://beautysavage.fr/commission-invoice/inv123?token=tok456'
    );
  });
});
