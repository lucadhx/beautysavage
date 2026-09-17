import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }

  removeItem(key) {
    this.map.delete(String(key));
  }
}

function installBrowserStubs() {
  const events = new EventTarget();
  const windowStub = {
    sessionStorage: new MemoryStorage(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    location: { href: 'http://localhost/vitrine.html' }
  };

  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init = {}) {
        super(type, init);
        this.detail = init.detail;
      }
    };
  }

  globalThis.window = windowStub;
  globalThis.document = {
    body: {},
    documentElement: {}
  };

  return windowStub;
}

function createZeroPaymentCheckoutState() {
  return {
    version: 1,
    item: {
      type: 'product',
      id: 'prod_1',
      name: 'Produit test'
    },
    items: [
      {
        type: 'product',
        id: 'prod_1',
        name: 'Produit test'
      }
    ],
    appliedGiftCards: [
      {
        giftCardId: 'gc_1',
        code: 'GC-COVER',
        password: 'secret',
        amount: 25
      }
    ],
    totals: {
      subtotal: 25,
      giftCardUsed: 25,
      remainingToPay: 0
    },
    legal: {
      acceptedCgv: true,
      waiverRequired: false,
      waiverAccepted: false,
      waiverText: ''
    },
    paymentProvider: 'stripe',
    origin: {
      slug: 'item-detail',
      query: {
        type: 'product',
        id: 'prod_1'
      }
    }
  };
}

describe('purchaseFlowService zero-payment wiring', () => {
  let purchaseFlowService;
  let windowStub;
  let fetchMock;
  let consoleLogSpy;

  beforeEach(async () => {
    vi.resetModules();
    windowStub = installBrowserStubs();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    purchaseFlowService = await import('../../public/js/modules/purchaseFlowService.js');
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    vi.restoreAllMocks();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.fetch;
  });

  it('prefers totals.amountToPay when available', () => {
    expect(
      purchaseFlowService.getCheckoutAmountDue({
        totals: { amountToPay: 12.5, remainingToPay: 0 }
      })
    ).toBe(12.5);
    expect(
      purchaseFlowService.getCheckoutAmountDue({
        totals: { remainingToPay: 4.2 }
      })
    ).toBe(4.2);
  });

  it('posts zero-payment finalization to /api/client/checkout/finalize-free with a stable idempotency key', async () => {
    const checkoutState = createZeroPaymentCheckoutState();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, saleId: 'sale_free_1' })
    });

    const navigations = [];
    windowStub.addEventListener('vitrine:navigate', event => {
      navigations.push(event.detail);
    });

    const result = await purchaseFlowService.finalizePurchase({
      outcome: 'success',
      checkoutState,
      idempotencyKey: 'checkout_token_free_123'
    });

    expect(result).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/client/checkout/finalize-free');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      checkoutState,
      idempotencyKey: 'checkout_token_free_123'
    });
    expect(navigations).toEqual([
      expect.objectContaining({
        slug: 'item-detail',
        query: { type: 'product', id: 'prod_1' }
      })
    ]);
  });

  it('surfaces PAYMENT_REQUIRED as a clear 402 error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ code: 'PAYMENT_REQUIRED' })
    });

    await expect(
      purchaseFlowService.submitFreeCheckoutRequest({
        checkoutState: createZeroPaymentCheckoutState(),
        idempotencyKey: 'checkout_token_free_123'
      })
    ).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      status: 402,
      message: 'Un paiement complementaire est requis pour finaliser cette commande.'
    });
  });
});
