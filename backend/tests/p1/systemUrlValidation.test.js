// S1 — Validation/normalisation des URLs de domaine (module pur).
import { describe, it, expect } from 'vitest';
import {
  normalizeDomainUrl,
  isLocalOrDevHost,
  stripTrailingSlash
} from '../../services/system/systemUrlValidation.js';

describe('systemUrlValidation.normalizeDomainUrl', () => {
  it('accepte une URL HTTPS et retire le slash final', () => {
    expect(normalizeDomainUrl('https://beautysavage.fr/')).toEqual({
      ok: true,
      value: 'https://beautysavage.fr'
    });
  });

  it('accepte un sous-domaine HTTPS sans slash', () => {
    expect(normalizeDomainUrl('https://manager.beautysavage.fr')).toEqual({
      ok: true,
      value: 'https://manager.beautysavage.fr'
    });
  });

  it('rejette HTTP sur un domaine public', () => {
    const res = normalizeDomainUrl('http://manager.beautysavage.fr');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTPS/);
  });

  it('tolère HTTP sur localhost', () => {
    expect(normalizeDomainUrl('http://localhost:3000/')).toEqual({
      ok: true,
      value: 'http://localhost:3000'
    });
  });

  it('tolère HTTP via allowInsecure', () => {
    expect(normalizeDomainUrl('http://staging.example.com', { allowInsecure: true })).toEqual({
      ok: true,
      value: 'http://staging.example.com'
    });
  });

  it('rejette une valeur sans schéma', () => {
    expect(normalizeDomainUrl('beautysavage.fr').ok).toBe(false);
  });

  it('rejette une URL avec query ou ancre', () => {
    expect(normalizeDomainUrl('https://x.fr?a=1').ok).toBe(false);
    expect(normalizeDomainUrl('https://x.fr#a').ok).toBe(false);
  });

  it('rejette une chaîne vide', () => {
    expect(normalizeDomainUrl('   ').ok).toBe(false);
  });

  it('rejette un protocole non http(s)', () => {
    expect(normalizeDomainUrl('ftp://x.fr').ok).toBe(false);
  });

  it('préserve un chemin de base sans slash final', () => {
    expect(normalizeDomainUrl('https://x.fr/app/')).toEqual({ ok: true, value: 'https://x.fr/app' });
  });
});

describe('systemUrlValidation.isLocalOrDevHost', () => {
  it('reconnaît les hôtes locaux/dev', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', 'foo.local', 'abc.ngrok-free.app']) {
      expect(isLocalOrDevHost(h)).toBe(true);
    }
  });
  it('refuse les hôtes publics', () => {
    expect(isLocalOrDevHost('beautysavage.fr')).toBe(false);
  });
});

describe('systemUrlValidation.stripTrailingSlash', () => {
  it('retire les slashs finaux', () => {
    expect(stripTrailingSlash('https://x.fr///')).toBe('https://x.fr');
    expect(stripTrailingSlash('  https://x.fr/ ')).toBe('https://x.fr');
  });
});
