// tests/p1/reactGoEmailLinks.test.js
// RX-GO — Constructeur d'URL front FLAG-AWARE (liens e-mail). Flag OFF → chemins Vanilla IDENTIQUES au
// legacy (zéro régression) ; flag ON → routes React /app. Couvre refund-tracking + session-cancel-decision.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { resolveFrontendUrl } from '../../services/system/frontendUrl.js';
import { buildSessionCancellationActionUrl } from '../../services/sessionCancellationFlowService.js';

const ORIGINAL_FLAG = process.env.REACT_OFFICIAL_FRONTEND;
function setFlag(on) {
  if (on) process.env.REACT_OFFICIAL_FRONTEND = 'true';
  else delete process.env.REACT_OFFICIAL_FRONTEND;
}
beforeEach(() => setFlag(false));
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.REACT_OFFICIAL_FRONTEND;
  else process.env.REACT_OFFICIAL_FRONTEND = ORIGINAL_FLAG;
});

describe('RX-GO — flag-aware frontend URLs', () => {
  it('refund-tracking : Vanilla quand flag OFF', () => {
    const url = resolveFrontendUrl('refund-tracking', { token: 'abc123' });
    expect(url).toContain('/vitrine.html?page=refund-tracking&token=abc123');
    expect(url).not.toContain('/app/');
  });

  it('refund-tracking : React (token en path) quand flag ON', () => {
    setFlag(true);
    const url = resolveFrontendUrl('refund-tracking', { token: 'abc123' });
    expect(url).toContain('/app/refund-tracking/abc123');
    expect(url).not.toContain('vitrine.html');
  });

  it('session-cancel-decision : Vanilla quand flag OFF (parité legacy)', () => {
    const url = resolveFrontendUrl('session-cancel-decision', { flowId: 'F1', token: 'tok' });
    expect(url).toContain('/vitrine.html?page=session-cancel-decision&flowId=F1&token=tok');
  });

  it('session-cancel-decision : React /app/decision quand flag ON', () => {
    setFlag(true);
    const url = resolveFrontendUrl('session-cancel-decision', { flowId: 'F1', token: 'tok' });
    expect(url).toContain('/app/decision?flowId=F1&token=tok');
  });

  it('buildSessionCancellationActionUrl délègue au builder flag-aware', () => {
    const off = buildSessionCancellationActionUrl({ flowId: 'F9', token: 'ZZ' });
    expect(off).toContain('/vitrine.html?page=session-cancel-decision&flowId=F9&token=ZZ');
    setFlag(true);
    const on = buildSessionCancellationActionUrl({ flowId: 'F9', token: 'ZZ' });
    expect(on).toContain('/app/decision?flowId=F9&token=ZZ');
  });

  it('buildSessionCancellationActionUrl renvoie "" sans flowId/token (garde inchangée)', () => {
    expect(buildSessionCancellationActionUrl({ flowId: '', token: 'x' })).toBe('');
    expect(buildSessionCancellationActionUrl({})).toBe('');
  });

  it('facture (RX-GO-2) : Vanilla OFF, React /app/invoice/:token ON', () => {
    expect(resolveFrontendUrl('invoice', { token: 'T1' })).toContain('/vitrine.html?slug=invoice&token=T1');
    setFlag(true);
    expect(resolveFrontendUrl('invoice', { token: 'T1' })).toContain('/app/invoice/T1');
  });

  it('reset mot de passe (RX-GO-2) : Vanilla OFF, React /app/reinitialiser-mot-de-passe ON', () => {
    expect(resolveFrontendUrl('password-reset', { token: 'T1' })).toContain('/reset-password?token=T1');
    setFlag(true);
    const url = resolveFrontendUrl('password-reset', { token: 'T1' });
    expect(url).toContain('/app/reinitialiser-mot-de-passe?token=T1');
    expect(url).not.toContain('vitrine.html');
  });

  it('route inconnue → erreur explicite', () => {
    expect(() => resolveFrontendUrl('inconnue', {})).toThrow(/route inconnue/);
  });
});
