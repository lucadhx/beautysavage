// S1 — Client API Paramètres Système : endpoints GET/PUT + validation live des URLs.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getSystemConfiguration,
  updateSystemConfiguration,
  validateDomainUrl,
  type SystemConfiguration,
} from './systemConfiguration';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const CONFIG: SystemConfiguration = {
  domains: { panelUrl: 'https://manager.beautysavage.fr', vitrineUrl: 'https://beautysavage.fr' },
  institute: { name: 'Beauty Savage', email: '', phone: '', siret: '', address: { line1: '', line2: '', city: '', postalCode: '', country: 'FR' } },
  localization: { timezone: 'Europe/Paris', language: 'fr', currency: 'EUR' },
  tax: { defaultVatRate: 0, vatMention: 'TVA non applicable' },
  system: { platformName: '' },
  maintenance: { enabled: false, message: '' },
  resolved: { vitrineBaseUrl: 'https://beautysavage.fr', panelBaseUrl: 'https://manager.beautysavage.fr' },
  updatedAt: null,
};

afterEach(() => vi.restoreAllMocks());

describe('systemConfiguration API client', () => {
  it('GET récupère la configuration', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(url); return Promise.resolve(json({ ok: true, config: CONFIG })); }));
    const cfg = await getSystemConfiguration();
    expect(cfg.domains.vitrineUrl).toBe('https://beautysavage.fr');
    expect(calls[0]).toContain('/api/gestion/dev/system-configuration');
  });

  it('PUT envoie le patch et renvoie la config', async () => {
    let captured: { method?: string; body?: string } = {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      captured = { method: init.method, body: init.body as string };
      return Promise.resolve(json({ ok: true, config: CONFIG }));
    }));
    const cfg = await updateSystemConfiguration({ domains: { vitrineUrl: 'https://beautysavage.fr' } });
    expect(captured.method).toBe('PUT');
    expect(captured.body).toContain('beautysavage.fr');
    expect(cfg.domains.panelUrl).toBe('https://manager.beautysavage.fr');
  });
});

describe('validateDomainUrl', () => {
  it('accepte HTTPS et retire le slash final', () => {
    expect(validateDomainUrl('https://beautysavage.fr/')).toEqual({ ok: true, value: 'https://beautysavage.fr' });
  });
  it('tolère localhost en HTTP', () => {
    expect(validateDomainUrl('http://localhost:3000')).toEqual({ ok: true, value: 'http://localhost:3000' });
  });
  it('refuse HTTP public', () => {
    expect(validateDomainUrl('http://beautysavage.fr').ok).toBe(false);
  });
  it('refuse une URL avec query', () => {
    expect(validateDomainUrl('https://x.fr?a=1').ok).toBe(false);
  });
  it('refuse une valeur vide ou sans schéma', () => {
    expect(validateDomainUrl('').ok).toBe(false);
    expect(validateDomainUrl('beautysavage.fr').ok).toBe(false);
  });
});
