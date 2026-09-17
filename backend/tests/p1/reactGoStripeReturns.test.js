// tests/p1/reactGoStripeReturns.test.js
// RX-GO — URLs de retour Stripe (Checkout hébergé) FLAG-AWARE. Priorité : env CHECKOUT_RETURN_BASE_URL >
// flag React (/app) > Vanilla (défaut). Flag OFF sans env → URLs Vanilla inchangées (rollback).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { buildHostedReturnUrls } from '../../services/stripe/stripeCheckoutService.js';

const ORIG_FLAG = process.env.REACT_OFFICIAL_FRONTEND;
const ORIG_BASE = process.env.CHECKOUT_RETURN_BASE_URL;
beforeEach(() => { delete process.env.REACT_OFFICIAL_FRONTEND; delete process.env.CHECKOUT_RETURN_BASE_URL; });
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.REACT_OFFICIAL_FRONTEND; else process.env.REACT_OFFICIAL_FRONTEND = ORIG_FLAG;
  if (ORIG_BASE === undefined) delete process.env.CHECKOUT_RETURN_BASE_URL; else process.env.CHECKOUT_RETURN_BASE_URL = ORIG_BASE;
});

const BASE = 'https://institut.example';

describe('RX-GO — Stripe hosted return URLs', () => {
  it('flag OFF, sans env → Vanilla (inchangé)', () => {
    const { success_url, cancel_url } = buildHostedReturnUrls(BASE, 'chk1');
    expect(success_url).toBe(`${BASE}/vitrine.html?slug=payment&checkout_session_id={CHECKOUT_SESSION_ID}`);
    expect(cancel_url).toBe(`${BASE}/vitrine.html?slug=checkout`);
  });

  it('flag ON, sans env → React /app/paiement/*', () => {
    process.env.REACT_OFFICIAL_FRONTEND = 'true';
    const { success_url, cancel_url } = buildHostedReturnUrls(BASE, 'chk1');
    expect(success_url).toBe(`${BASE}/app/paiement/succes?session_id={CHECKOUT_SESSION_ID}&checkoutId=chk1`);
    expect(cancel_url).toBe(`${BASE}/app/paiement/annule`);
  });

  it('CHECKOUT_RETURN_BASE_URL prioritaire sur le flag (compat R2C)', () => {
    process.env.REACT_OFFICIAL_FRONTEND = 'true';
    process.env.CHECKOUT_RETURN_BASE_URL = 'https://front.example';
    const { success_url, cancel_url } = buildHostedReturnUrls(BASE, 'chk1');
    expect(success_url).toBe('https://front.example/paiement/succes?session_id={CHECKOUT_SESSION_ID}&checkoutId=chk1');
    expect(cancel_url).toBe('https://front.example/paiement/annule');
  });

  it('placeholder {CHECKOUT_SESSION_ID} jamais encodé', () => {
    process.env.REACT_OFFICIAL_FRONTEND = 'true';
    const { success_url } = buildHostedReturnUrls(BASE, '');
    expect(success_url).toContain('{CHECKOUT_SESSION_ID}');
    expect(success_url).not.toContain('%7B');
  });
});
