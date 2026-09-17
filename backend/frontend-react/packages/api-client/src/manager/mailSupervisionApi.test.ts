import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listMailDeliveries,
  getMailDeliveryDetail,
  getMailDeliveryStats,
  listSendLogs,
  getSendLogStats,
} from './mailSupervision';

function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('mailSupervision api-client (M3E)', () => {
  it('listMailDeliveries renvoie items', async () => {
    mockFetch({ ok: true, roleView: 'admin', count: 1, limit: 50, items: [{ id: 'd1', eventName: 'refund.succeeded', status: 'sent', targetAudience: 'admin' }] });
    const items = await listMailDeliveries({ status: 'sent', limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('d1');
    expect(items[0].targetAudience).toBe('admin');
  });

  it('getMailDeliveryDetail renvoie delivery', async () => {
    mockFetch({ ok: true, roleView: 'admin', delivery: { id: 'd1', providerMessageId: '<m1>', recipientHash: 'h1' } });
    const d = await getMailDeliveryDetail('d1');
    expect(d?.providerMessageId).toBe('<m1>');
  });

  it('getMailDeliveryStats renvoie stats', async () => {
    mockFetch({ ok: true, stats: { roleView: 'admin', total: 3, byStatus: { sent: 2 }, byTemplate: {}, byEvent: {}, last24h: 1, failuresLast24h: 0, shadowCount: 0, activeCount: 3 } });
    const s = await getMailDeliveryStats();
    expect(s.total).toBe(3);
    expect(s.activeCount).toBe(3);
  });

  it('listSendLogs + getSendLogStats', async () => {
    mockFetch({ ok: true, roleView: 'admin', count: 1, limit: 50, items: [{ id: 's1', templateKey: 'refund_confirmed', recipientHash: 'h1', senderRole: 'commerciale', recipientRole: 'client' }] });
    const logs = await listSendLogs();
    expect(logs[0].senderRole).toBe('commerciale');

    mockFetch({ ok: true, stats: { roleView: 'admin', total: 1, byStatus: { sent: 1 }, byTemplate: {}, last24h: 1, failuresLast24h: 0 } });
    const stats = await getSendLogStats();
    expect(stats.total).toBe(1);
  });

  it('items absent → tableau vide (robuste)', async () => {
    mockFetch({ ok: true, roleView: 'admin', count: 0, limit: 50 });
    const items = await listMailDeliveries();
    expect(items).toEqual([]);
  });
});
