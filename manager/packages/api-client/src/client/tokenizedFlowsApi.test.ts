// RX4 S3 — Parcours tokenisés : endpoints + normalisation (statuts réels, split, kind).
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getDecisionFlow,
  requestDecisionRefund,
  rescheduleServiceDecision,
  requestDecisionGiftCard,
  getRefundTracking,
} from './tokenizedFlows';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: { url: string; init?: RequestInit }[] = [];
function installFetch(payload: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return json(payload, status); }));
}
afterEach(() => vi.unstubAllGlobals());

describe('tokenizedFlows — decision', () => {
  it('getDecisionFlow passe le token en query et détecte kind=service', async () => {
    installFetch({ ok: true, flow: { flowId: 'F1', flowType: 'service_booking_cancelled', decision: 'pending', options: { canRefund: true, serviceRescheduleAvailable: true } }, service: { id: 's1', name: 'Soin' }, bookingSnapshot: { startAt: '2026-06-01T14:00:00Z' }, refundAmount: 90 });
    const flow = await getDecisionFlow('F1', 'tok');
    expect(flow.kind).toBe('service');
    expect(flow.options.canRefund).toBe(true);
    expect(flow.refundAmount).toBe(90);
    expect(calls[0].url).toContain('/api/client/session-cancel-flows/F1');
    expect(calls[0].url).toContain('token=tok');
  });

  it('getDecisionFlow détecte kind=formation', async () => {
    installFetch({ ok: true, flow: { flowId: 'F2', flowType: 'session_cancelled', decision: 'pending', options: { canReschedule: true } }, formation: { id: 'f', name: 'Volume' }, availableSessions: [{ id: 'x', startDate: '2026-07-01', durationDays: 1, schedule: [] }] });
    const flow = await getDecisionFlow('F2', 'tok');
    expect(flow.kind).toBe('formation');
    expect(flow.availableSessions?.length).toBe(1);
  });

  it('requestDecisionRefund envoie le mot-clé annulation', async () => {
    installFetch({ ok: true });
    await requestDecisionRefund('F1', 'tok');
    expect(calls[0].url).toContain('/F1/refund');
    expect(String(calls[0].init?.body)).toContain('annulation');
  });

  it('rescheduleServiceDecision poste les créneaux et renvoie le booking', async () => {
    installFetch({ ok: true, newBooking: { bookingId: 'BKG-1', startAt: 'a', endAt: 'b', status: 'confirmed' } });
    const res = await rescheduleServiceDecision('F1', 'tok', { chosenSlotStart: 'a', chosenSlotEnd: 'b' });
    expect(res.bookingId).toBe('BKG-1');
    expect(calls[0].url).toContain('/F1/service-reschedule');
  });

  it('requestDecisionGiftCard renvoie code + solde', async () => {
    installFetch({ ok: true, giftCard: { code: 'GC-9', balance: 50 } });
    const res = await requestDecisionGiftCard('F1', 'tok');
    expect(res.code).toBe('GC-9');
    expect(res.balance).toBe(50);
  });
});

describe('tokenizedFlows — refund tracking', () => {
  it('mappe le split Stripe + carte cadeau', async () => {
    installFetch({ ok: true, refund: { status: 'pending', amount: 60, itemTitle: 'Soin', isSplitRefund: true, stripeRefundAmount: 20, stripeRefundStatus: 'pending', giftCardRefundAmount: 40, giftCardRefundStatus: 'succeeded', giftCard: { code: 'GC-1', balance: 40, recipientName: 'Alice' } } });
    const r = await getRefundTracking('tok');
    expect(r.status).toBe('pending');
    expect(r.isSplitRefund).toBe(true);
    expect(r.stripe.amount).toBe(20);
    expect(r.giftCard.amount).toBe(40);
    expect(r.giftCard.card?.code).toBe('GC-1');
    expect(calls[0].url).toContain('/api/refund-tracking/tok');
  });

  it('tolère une réponse minimale (statut par défaut requested)', async () => {
    installFetch({ ok: true, refund: { amount: 10 } });
    const r = await getRefundTracking('tok');
    expect(r.status).toBe('requested');
    expect(r.stripe.status).toBe('not_applicable');
    expect(r.giftCard.card).toBeNull();
  });
});
