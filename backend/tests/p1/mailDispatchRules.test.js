// tests/p1/mailDispatchRules.test.js
// M2 — Règles de dispatch : lookup, liste, flag d'activation, formes (aucune adresse dans les règles).
import { describe, it, expect, afterEach } from 'vitest';
import {
  MAIL_DISPATCH_RULES,
  getMailDispatchRule,
  listDispatchableEventNames,
  isMailRoleResolverEnabled
} from '../../constants/mailDispatchRules.js';

describe('mailDispatchRules', () => {
  const prev = process.env.MAIL_ROLE_RESOLVER_ENABLED;
  afterEach(() => { process.env.MAIL_ROLE_RESOLVER_ENABLED = prev; });

  it('getMailDispatchRule renvoie la règle pour sale.finalized', () => {
    const rule = getMailDispatchRule('sale.finalized');
    expect(rule).toMatchObject({ templateKey: 'vente', fromRole: 'commerciale', toRole: 'client' });
  });

  it('renvoie null pour un event inconnu', () => {
    expect(getMailDispatchRule('nope.unknown')).toBeNull();
  });

  it('liste les events dispatchables', () => {
    const names = listDispatchableEventNames();
    expect(names).toContain('sale.finalized');
    expect(names).toContain('commission.available');
  });

  it('les règles ne contiennent JAMAIS d’adresse e-mail (seulement des rôles)', () => {
    const raw = JSON.stringify(MAIL_DISPATCH_RULES);
    expect(raw).not.toMatch(/@/);
    for (const rule of MAIL_DISPATCH_RULES) {
      expect(['support', 'commerciale']).toContain(rule.fromRole);
      expect(['support', 'commerciale', 'client']).toContain(rule.toRole);
    }
  });

  it('isMailRoleResolverEnabled lit le flag à l’exécution', () => {
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'false';
    expect(isMailRoleResolverEnabled()).toBe(false);
    process.env.MAIL_ROLE_RESOLVER_ENABLED = 'true';
    expect(isMailRoleResolverEnabled()).toBe(true);
  });
});
