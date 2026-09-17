// services/stripe/stripeFeeService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE de la récupération des frais Stripe
// (BalanceTransaction) hors de stripeController. Aucune modification de comportement.
//
// Utilisé par : le webhook (post-vente), les handlers HTTP transaction-fees/pending-count,
// et le job de relance différée (app.js). Le listener `registerPendingStripeFeeCreatedListener`
// permet à app.js de relancer le job quand une vente reste en attente de frais.

import Sale from '../../models/Sale.js';
import { getStripeClient } from './stripeConfigService.js';
import { normalizeStripeId, normalizeCurrency } from './stripeMetadataService.js';

// Phase 1B-4: 0€ orders finalized without Stripe carry a synthetic "free_" reference in
// stripePaymentIntentId (for idempotence via the unique partial index). They have no
// real Stripe charge, so they must be excluded from the Stripe-fee recovery sweep.
const STRIPE_FEE_PENDING_QUERY = {
  stripePaymentIntentId: { $nin: [null, ''], $not: /^free_/ },
  stripeFee: null
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildStripeFeeSaleQuery({ paymentIntentId, saleId } = {}) {
  const normalizedSaleId = String(saleId || '').trim();
  if (normalizedSaleId) {
    return { saleId: normalizedSaleId };
  }
  const normalizedPaymentIntentId = normalizeStripeId(paymentIntentId);
  return {
    $or: [
      { stripePaymentIntentId: normalizedPaymentIntentId },
      { stripeSessionId: normalizedPaymentIntentId }
    ]
  };
}

let pendingStripeFeeCreatedListener = null;

export function registerPendingStripeFeeCreatedListener(listener) {
  pendingStripeFeeCreatedListener = typeof listener === 'function' ? listener : null;
}

export function notifyPendingStripeFeeCreated(saleId = '') {
  if (typeof pendingStripeFeeCreatedListener !== 'function') return;
  try {
    pendingStripeFeeCreatedListener({ saleId: String(saleId || '').trim() });
  } catch (error) {
    console.error('[Stripe Fees] Erreur callback relance job', error);
  }
}

async function getBalanceTx(stripe, chargeId, attempts = 1, retryDelayMs = 3000) {
  if (!chargeId) return { charge: null, balanceTx: null };
  let lastCharge = null;
  for (let i = 0; i < attempts; i += 1) {
    const charge = await stripe.charges.retrieve(chargeId);
    lastCharge = charge;
    const balanceTransactionId =
      typeof charge?.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge?.balance_transaction?.id || '';
    if (balanceTransactionId) {
      const balanceTx = await stripe.balanceTransactions.retrieve(balanceTransactionId);
      if (typeof balanceTx?.fee !== 'undefined') {
        return { charge, balanceTx };
      }
    }
    if (i < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }
  return { charge: lastCharge, balanceTx: null };
}

async function fetchStripeFeeData({
  paymentIntentId,
  attempts = 1,
  retryDelayMs = 3000
} = {}) {
  const normalizedPaymentIntentId = normalizeStripeId(paymentIntentId);
  if (!normalizedPaymentIntentId) {
    return { fee: null, net: null, amount: null, currency: 'eur', available: false };
  }

  const stripe = await getStripeClient();
  let lastCurrency = 'eur';
  for (let i = 0; i < attempts; i += 1) {
    const paymentIntent = await stripe.paymentIntents.retrieve(normalizedPaymentIntentId);
    lastCurrency = normalizeCurrency(paymentIntent?.currency, lastCurrency);
    const latestChargeId =
      typeof paymentIntent?.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent?.latest_charge?.id || '';
    if (latestChargeId) {
      const { charge, balanceTx } = await getBalanceTx(stripe, latestChargeId, 1, retryDelayMs);
      if (charge?.currency) {
        lastCurrency = normalizeCurrency(charge.currency, lastCurrency);
      }
      if (balanceTx) {
        const fee = Number.isFinite(Number(balanceTx?.fee)) ? Number(balanceTx.fee) : null;
        const net = Number.isFinite(Number(balanceTx?.net)) ? Number(balanceTx.net) : null;
        const amount = Number.isFinite(Number(balanceTx?.amount))
          ? Number(balanceTx.amount)
          : Number.isFinite(Number(charge?.amount))
            ? Number(charge.amount)
            : null;
        return {
          fee,
          net,
          amount,
          currency: normalizeCurrency(balanceTx?.currency, lastCurrency),
          available: fee !== null && net !== null
        };
      }
    }
    if (i < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }
  return { fee: null, net: null, amount: null, currency: lastCurrency, available: false };
}

async function persistStripeFeeData({ paymentIntentId, saleId, fee, net } = {}) {
  const normalizedPaymentIntentId = normalizeStripeId(paymentIntentId);
  if (!normalizedPaymentIntentId) return false;
  if (!Number.isFinite(Number(fee)) || !Number.isFinite(Number(net))) return false;
  const query = buildStripeFeeSaleQuery({ paymentIntentId: normalizedPaymentIntentId, saleId });
  const updated = await Sale.findOneAndUpdate(
    query,
    {
      $set: {
        stripeFee: Number(fee),
        stripeNet: Number(net)
      }
    },
    { new: true }
  ).lean();
  return Boolean(updated);
}

export async function recoverStripeFeesAndUpdateSale({
  paymentIntentId,
  saleId,
  attempts = 1,
  retryDelayMs = 3000
} = {}) {
  const stripeData = await fetchStripeFeeData({
    paymentIntentId,
    attempts,
    retryDelayMs
  });
  let updated = false;
  if (stripeData.available) {
    updated = await persistStripeFeeData({
      paymentIntentId,
      saleId,
      fee: stripeData.fee,
      net: stripeData.net
    });
  }
  return {
    fee: stripeData.fee,
    net: stripeData.net,
    amount: stripeData.amount,
    currency: stripeData.currency,
    updated,
    available: stripeData.available
  };
}

export async function countPendingStripeFeesSales() {
  return Sale.countDocuments(STRIPE_FEE_PENDING_QUERY);
}

export async function listPendingStripeFeesSales(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return Sale.find(STRIPE_FEE_PENDING_QUERY)
    .sort({ createdAt: 1 })
    .limit(safeLimit)
    .select({ saleId: 1, stripePaymentIntentId: 1, createdAt: 1 })
    .lean();
}
