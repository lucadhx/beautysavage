import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listIntegrations,
  getIntegration,
  updateIntegrationCredentials,
  deleteIntegrationRuntime,
  testIntegration,
  setIntegrationMode,
} from './integratedApi';

let lastUrl = '';
let lastInit: RequestInit | undefined;
function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      lastUrl = String(url);
      lastInit = init;
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const INTEGRATION = {
  slug: 'stripe-institut',
  name: 'Stripe Institut',
  provider: 'stripe',
  accountPurpose: 'customer_payments',
  runtimeModel: 'dual_environment',
  mode: 'test',
  modeUpdatedAt: null,
  confirmVerb: 'ACTIVER STRIPE INSTITUT PROD',
  runtimes: [],
};

describe('integratedApi api-client (LOT3)', () => {
  it('list → GET /api/gestion/dev/integrated-api', async () => {
    mockFetch({ ok: true, integrations: [INTEGRATION] });
    const res = await listIntegrations();
    expect(lastUrl).toContain('/api/gestion/dev/integrated-api');
    expect(res).toHaveLength(1);
  });

  it('getIntegration → GET /:slug', async () => {
    mockFetch({ ok: true, integration: INTEGRATION });
    const res = await getIntegration('stripe-institut');
    expect(lastUrl).toContain('/api/gestion/dev/integrated-api/stripe-institut');
    expect(res.slug).toBe('stripe-institut');
  });

  it('updateIntegrationCredentials → PUT /:slug/credentials avec runtime + credentials', async () => {
    mockFetch({ ok: true, integration: INTEGRATION });
    await updateIntegrationCredentials('stripe-institut', 'test', { secret_key: 'sk_test_x' });
    expect(lastUrl).toContain('/stripe-institut/credentials');
    expect(lastInit?.method).toBe('PUT');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ runtime: 'test', credentials: { secret_key: 'sk_test_x' } });
  });

  it('deleteIntegrationRuntime → DELETE /:slug/credentials?runtime=', async () => {
    mockFetch({ ok: true, integration: INTEGRATION });
    await deleteIntegrationRuntime('stripe-institut', 'prod');
    expect(lastUrl).toContain('/stripe-institut/credentials?runtime=prod');
    expect(lastInit?.method).toBe('DELETE');
  });

  it('testIntegration → POST /:slug/test', async () => {
    mockFetch({ ok: true, result: { status: 'success', message: 'ok', details: null, slug: 'stripe-institut', runtime: 'test', testedAt: 'now' }, integration: INTEGRATION });
    const res = await testIntegration('stripe-institut', 'test');
    expect(lastUrl).toContain('/stripe-institut/test');
    expect(lastInit?.method).toBe('POST');
    expect(res.result.status).toBe('success');
  });

  it('setIntegrationMode → POST /:slug/mode avec confirmation', async () => {
    mockFetch({ ok: true, integration: INTEGRATION });
    await setIntegrationMode('stripe-institut', 'prod', 'ACTIVER STRIPE INSTITUT PROD');
    expect(lastUrl).toContain('/stripe-institut/mode');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ mode: 'prod', confirmation: 'ACTIVER STRIPE INSTITUT PROD' });
  });
});
