import express from 'express';
import { requireAuth } from '../utils/session.js';
import {
  createCheckoutSession,
  handleWebhook,
  getSessionStatus,
  getPaymentResult,
  getConfig,
  getTransactionFees,
  getPendingFeesCount
} from '../controllers/stripeController.js';

const stripeRouter = express.Router();
const stripeJsonParser = express.json({ limit: '2mb' });

// Public: return publishable key only
stripeRouter.get('/config', getConfig);

// Raw body required for Stripe signature verification
// Expected Stripe events: payment_intent.succeeded + payment_intent.payment_failed + charge.refund.updated
stripeRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

// Protected endpoints
stripeRouter.post('/create-checkout-session', stripeJsonParser, requireAuth(), createCheckoutSession);
stripeRouter.get('/session-status', requireAuth(), getSessionStatus);
stripeRouter.get('/payment-result', requireAuth(), getPaymentResult);
stripeRouter.get('/transaction-fees', requireAuth(), getTransactionFees);
stripeRouter.get('/pending-fees-count', requireAuth(), getPendingFeesCount);

export default stripeRouter;
