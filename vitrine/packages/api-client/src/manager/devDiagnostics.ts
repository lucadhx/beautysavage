import { apiGet } from '../apiFetch';

const DEV_BASE = '/api/gestion/dev';
const CONTRACT_BASE = '/api/contract';

export interface DevEventLog {
  eventName: string;
  domain: string | null;
  actorType: string | null;
  source: string | null;
  contextType: string | null;
  contextId: string | null;
  payloadSafe: Record<string, unknown>;
  traceId: string | null;
  emittedAt: string | null;
  createdAt: string | null;
}

export interface DevWebhookFailure {
  provider: string | null;
  webhookType: string | null;
  eventType: string | null;
  failureStage: string | null;
  errorCode: string | null;
  errorMessageSafe: string;
  stripeEventId: string | null;
  paymentIntentId: string | null;
  status: 'failed' | 'resolved' | string;
  retryable: boolean;
  createdAt: string | null;
}

export interface DevUnifiedCheckout {
  checkoutId: string;
  kind: string | null;
  status: string | null;
  source: string | null;
  payment: {
    mode: string | null;
    amountToPay: number | null;
    giftCardPaymentAmount: number | null;
    provider: string | null;
    status: string | null;
  };
  finalization: {
    saleId: string | null;
    bookingId: string | null;
    finalizedAt: string | null;
  };
  hasPricingSnapshot: boolean;
  hasTaxSnapshot: boolean;
  hasLegalConsentSnapshot: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
}

export interface DevContractCurrent {
  status: string;
  startDate: string | null;
  launchFee: { amount?: number | null; taxRate?: number | null; paid?: boolean | null };
  monthlyFee: {
    amount?: number | null;
    taxRate?: number | null;
    active?: boolean | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean | null;
  };
  cancelAtPeriodEnd?: boolean | null;
  commissions?: { type?: string | null; value?: number | null } | null;
}

export interface DevContractPaymentStatus {
  contractStatus: string;
  steps: {
    fileDownloaded?: boolean;
    contractAccepted?: boolean;
    launchFeePaid?: boolean;
    launchFeeRequired?: boolean;
    monthlyActive?: boolean;
    monthlyRequired?: boolean;
    contractActive?: boolean;
  };
}

export interface DevStripeConfig {
  publishableKey: string;
}

export async function listDevEventLogs(limit = 50): Promise<DevEventLog[]> {
  const res = await apiGet<{ ok: boolean; events: DevEventLog[] }>(`${DEV_BASE}/events`, { limit });
  return res.events ?? [];
}

export async function listDevWebhookFailures(limit = 50): Promise<DevWebhookFailure[]> {
  const res = await apiGet<{ ok: boolean; failures: DevWebhookFailure[] }>(`${DEV_BASE}/webhook-failures`, { limit });
  return res.failures ?? [];
}

export async function listDevUnifiedCheckouts(limit = 20): Promise<DevUnifiedCheckout[]> {
  const res = await apiGet<{ ok: boolean; checkouts: DevUnifiedCheckout[] }>(`${DEV_BASE}/unified-checkouts`, { limit });
  return res.checkouts ?? [];
}

export async function getDevContractCurrent(): Promise<DevContractCurrent> {
  const res = await apiGet<{ ok: boolean; contract: DevContractCurrent }>(`${CONTRACT_BASE}/current`);
  return res.contract;
}

export async function getDevContractPaymentStatus(): Promise<DevContractPaymentStatus> {
  const res = await apiGet<{ ok: boolean } & DevContractPaymentStatus>(`${CONTRACT_BASE}/check-payment-status`);
  return { contractStatus: res.contractStatus, steps: res.steps ?? {} };
}

export async function getDevStripeConfig(): Promise<DevStripeConfig> {
  return apiGet<DevStripeConfig>(`${CONTRACT_BASE}/stripe-dev-config`);
}
