import { describe, it, expect, afterEach, vi } from 'vitest';
import { listMailDeliveries, listSendLogs, getMailDeliveryStats } from './mailSupervision';

let lastUrl = '';
function mockFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      lastUrl = String(url);
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('mailSupervision scope (M4)', () => {
  it('scope admin → /api/gestion ; scope dev → /api/gestion/dev', async () => {
    mockFetch({ ok: true, items: [] });
    await listMailDeliveries({}, 'admin');
    expect(lastUrl).toContain('/api/gestion/mail-deliveries');
    expect(lastUrl).not.toContain('/dev/');

    await listMailDeliveries({}, 'dev');
    expect(lastUrl).toContain('/api/gestion/dev/mail-deliveries');

    await getMailDeliveryStats({}, 'dev');
    expect(lastUrl).toContain('/api/gestion/dev/mail-deliveries/stats');
  });

  it('send-logs dev → endpoint legacy { logs } normalisé vers SendLogSummary', async () => {
    mockFetch({
      ok: true,
      count: 1,
      logs: [
        { _id: 's1', templateKey: 'refund_confirmed', status: 'sent', recipientHash: 'h1', providerMessageId: '<m>', errorMessageSafe: '', metadata: { tags: ['transactional', 'refund_confirmed', 'from:commerciale', 'to:client', 'role-engine'] } },
      ],
    });
    const logs = await listSendLogs({}, 'dev');
    expect(lastUrl).toContain('/api/gestion/dev/send-logs');
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('s1');
    expect(logs[0].senderRole).toBe('commerciale');
    expect(logs[0].recipientRole).toBe('client');
    expect(logs[0].recipientHash).toBe('h1');
  });

  it('send-logs admin → DTO { items }', async () => {
    mockFetch({ ok: true, items: [{ id: 's2', templateKey: 'vente', senderRole: 'commerciale', recipientRole: 'client' }] });
    const logs = await listSendLogs({}, 'admin');
    expect(lastUrl).toContain('/api/gestion/send-logs');
    expect(logs[0].id).toBe('s2');
  });
});
