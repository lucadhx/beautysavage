// 223 — Le runtime ne dépend d'AUCUNE variable .env métier. Avec toutes les variables
// métier absentes, les accesseurs/résolveurs renvoient des valeurs sûres sans throw.
// Seuls MONGODB_URI / SESSION_SECRET / PWD_PEPPER sont indispensables au bootstrap.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  invalidateSystemConfigurationCache,
  getInstituteInfo,
  resolvePlatformName,
  resolveVatMention
} from '../../services/system/systemConfigurationService.js';
import { buildSender } from '../../services/mail/mailSenderResolver.js';

const BUSINESS_VARS = [
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_DEV_SECRET_KEY', 'STRIPE_DEV_PUBLISHABLE_KEY', 'STRIPE_DEV_WEBHOOK_SECRET',
  'BREVO_API_KEY', 'MAIL_FROM', 'MAIL_FROM_NAME',
  'INSTITUTE_ADDRESS_LINE1', 'INSTITUTE_CITY', 'INSTITUTE_POSTAL_CODE',
  'INSTITUTE_COUNTRY', 'INSTITUTE_SIRET', 'INSTITUTE_VAT_MENTION',
  'INSTITUTE_NAME', 'INVOICE_CONTACT_EMAIL', 'PLATFORM_NAME'
];

function src(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('223 — .env métier vidé : aucune dépendance runtime requise', () => {
  let saved;
  beforeEach(() => {
    saved = {};
    for (const v of BUSINESS_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
    invalidateSystemConfigurationCache();
  });
  afterEach(() => {
    for (const v of BUSINESS_VARS) {
      if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
    }
    invalidateSystemConfigurationCache();
  });

  it('getInstituteInfo() ne throw pas et renvoie des valeurs vides (défauts au site d\'appel)', () => {
    const info = getInstituteInfo();
    expect(info.name).toBe('');
    expect(info.email).toBe('');
    expect(info.siret).toBe('');
    expect(info.address.city).toBe('');
    expect(info.vatMention).toBe('');
  });

  it('resolvePlatformName / resolveVatMention tolèrent l\'absence', () => {
    expect(resolvePlatformName()).toBe('');
    expect(resolveVatMention()).toBe('');
  });

  it('buildSender() sans identité ni MAIL_FROM → null (aucun throw)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // pas de fallback dev
    try {
      const sender = await buildSender();
      expect(sender).toBeNull();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('seules MONGODB_URI / SESSION_SECRET / PWD_PEPPER lèvent une erreur si absentes', () => {
    expect(src('../../utils/session.js')).toMatch(/SESSION_SECRET[\s\S]*throw/);
    expect(src('../../utils/password.js')).toMatch(/PWD_PEPPER[\s\S]*throw/);
    // Aucune variable métier n'est exigée au boot (pas de throw sur une INSTITUTE_/STRIPE_/BREVO).
    const sessionSrc = src('../../utils/session.js');
    expect(sessionSrc).not.toMatch(/throw[\s\S]*INSTITUTE_/);
  });
});
