// tests/p1/eventContextSchema.test.js
// M3B — Schéma de contexte standard : forme garantie, types connus, clés sensibles listées.
import { describe, it, expect } from 'vitest';
import {
  EVENT_CONTEXT_TYPES,
  RELATED_ID_KEYS,
  ACTOR_KEYS,
  EVENT_CONTEXT_SENSITIVE_KEYS,
  createEventContext,
  isKnownContextType
} from '../../constants/eventContextSchema.js';

describe('eventContextSchema (M3B)', () => {
  it('createEventContext renvoie la forme standard avec defaults', () => {
    const ctx = createEventContext();
    expect(ctx).toHaveProperty('contextType', null);
    expect(ctx).toHaveProperty('contextId', null);
    expect(ctx.related).toEqual({});
    expect(ctx.actors).toEqual({ system: true });
    expect(ctx.variables).toEqual({});
    expect(ctx.privacy).toEqual({ containsPii: false, piiFields: [] });
  });

  it('createEventContext préserve les champs fournis et stringifie les IDs', () => {
    const ctx = createEventContext({
      contextType: 'sale',
      contextId: 123,
      related: { saleId: 'S-1', clientId: 'U-1' },
      actors: { clientId: 'U-1' },
      variables: { amount: 50 },
      privacy: { containsPii: true, piiFields: ['clientName'] }
    });
    expect(ctx.contextType).toBe('sale');
    expect(ctx.contextId).toBe('123');
    expect(ctx.related.saleId).toBe('S-1');
    expect(ctx.actors.system).toBe(true);
    expect(ctx.actors.clientId).toBe('U-1');
    expect(ctx.privacy.piiFields).toContain('clientName');
  });

  it('contextTypes connus', () => {
    expect(isKnownContextType('sale')).toBe(true);
    expect(isKnownContextType('service_booking')).toBe(true);
    expect(isKnownContextType('nope')).toBe(false);
    expect(EVENT_CONTEXT_TYPES).toContain('commission_payment');
  });

  it('listes de clés exposées', () => {
    expect(RELATED_ID_KEYS).toContain('saleId');
    expect(RELATED_ID_KEYS).toContain('commissionPaymentId');
    expect(ACTOR_KEYS).toEqual(expect.arrayContaining(['clientId', 'adminId', 'devId', 'system']));
    // email/secret/token explicitement listés comme sensibles
    expect(EVENT_CONTEXT_SENSITIVE_KEYS).toEqual(expect.arrayContaining(['email', 'secret', 'token', 'password']));
  });
});
