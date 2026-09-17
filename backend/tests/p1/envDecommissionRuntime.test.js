// S1B — Garde anti-régression : aucune lecture runtime métier NON GATÉE des variables
// décommissionnées. Vérifie la forme du code source (statique), pas seulement le comportement.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function src(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('S1B — décommission runtime des variables .env métier', () => {
  it('systemConfigurationService ne lit jamais process.env.INSTITUTE_* / MAIL_FROM en direct', () => {
    const code = src('../../services/system/systemConfigurationService.js');
    // Tous les fallbacks passent par envFallback(...) (gaté non-prod), jamais en direct.
    expect(code).not.toMatch(/process\.env\.INSTITUTE_/);
    expect(code).not.toMatch(/process\.env\.MAIL_FROM/);
    expect(code).not.toMatch(/process\.env\.INVOICE_CONTACT_EMAIL/);
    expect(code).toContain('function envFallback(');
    expect(code).toContain('export function getInstituteInfo(');
  });

  it('S1C — le fallback credential est UNIFORME (flag-only, aucune logique NODE_ENV)', () => {
    const code = src('../../services/integratedApiCredentialService.js');
    const fn = code.slice(code.indexOf('function fallbackEnabled()'), code.indexOf('const _warnedFallback'));
    expect(fn).toMatch(/ALLOW_ENV_CREDENTIAL_FALLBACK/);
    expect(fn).not.toMatch(/NODE_ENV/);
  });

  it('buildSender (mailSenderResolver) est migré vers CommunicationIdentity + fallback MAIL_FROM gaté non-prod', () => {
    const resolver = src('../../services/mail/mailSenderResolver.js');
    expect(resolver).toContain("resolveSender('commerciale')");
    expect(resolver).toContain("!== 'production'");
    // mailDomainDispatchers importe le resolver et n'appelle plus buildSender de façon synchrone.
    const dispatchers = src('../../services/mail/mailDomainDispatchers.js');
    expect(dispatchers).toContain("from './mailSenderResolver.js'");
    expect(dispatchers).not.toMatch(/[^t] sender = buildSender\(\)/);
  });

  it('les services Stripe/Brevo lisent le coffre (getCredential), pas process.env', () => {
    for (const f of [
      '../../services/stripe/stripeConfigService.js',
      '../../services/stripe/dev/stripeDevConfigService.js',
      '../../services/mail/mailBrevoGateway.js'
    ]) {
      const code = src(f);
      expect(code).toContain('getCredential');
      expect(code).not.toMatch(/process\.env\.STRIPE_/);
      expect(code).not.toMatch(/process\.env\.BREVO_API_KEY/);
    }
  });
});
