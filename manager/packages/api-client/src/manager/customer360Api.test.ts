// M12 — Client API Customer 360 : endpoints corrects + propagation des données.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getCustomer360, searchCustomers } from './customer360';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const calls: string[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return json(payload); }));
}
afterEach(() => vi.unstubAllGlobals());

describe('customer360 api-client (M12)', () => {
  it('searchCustomers appelle /api/gestion/customers avec search', async () => {
    installFetch({ ok: true, customers: [{ id: 'c1', displayName: 'Jane', email: 'a@b.c' }] });
    const res = await searchCustomers('jane');
    expect(res.length).toBe(1);
    expect(calls[0]).toContain('/api/gestion/customers');
    expect(calls[0]).toContain('search=jane');
  });

  it('searchCustomers sans terme', async () => {
    installFetch({ ok: true, customers: [] });
    const res = await searchCustomers();
    expect(res).toEqual([]);
    expect(calls[0]).toContain('/api/gestion/customers');
  });

  it('getCustomer360 appelle /:id/360 et renvoie le payload', async () => {
    installFetch({ ok: true, customer: { id: 'c1' }, summary: {}, timeline: [], sales: [], bookings: [], financial: {} });
    const res = await getCustomer360('c1');
    expect(calls[0]).toContain('/api/gestion/customers/c1/360');
    expect(res.customer.id).toBe('c1');
  });
});
