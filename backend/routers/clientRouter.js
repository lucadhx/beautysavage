import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireSiteActiveForPurchases } from '../middlewares/siteStatusGuards.js';
import {
  getMyProducts,
  getMyFormations,
  getModulesForFormation,
  getModuleDetail,
  getFormationSummary,
  getFormationSession,
  getFormationParticipants,
  getMyPresentielSession,
  getPurchaseStatus,
  mockPay,
  changeFormationSession,
  postFormationReview,
  saveCartSnapshot,
  listFavorites,
  listMySales,
  addFavorite,
  removeFavorite,
  getProfile,
  updateProfile,
  cancelFormationParticipation
} from '../controllers/clientController.js';
// Sprint F1 — finalizeFreeCheckout est désormais exposé par la facade checkout.
import { finalizeFreeCheckout } from '../services/checkout/checkoutFacade.js';
import { downloadClientInvoice } from '../controllers/invoiceController.js';
import {
  createBooking,
  listMyBookings,
  cancelMyBooking,
  confirmBookingPayment,
  getBookingStatus,
  getBookingByPaymentIntent,
  getBookingInvoice,
  getMyBookingStatus,
  getBookingRefundEligibility
} from '../controllers/serviceBookingController.js';
import {
  getSessionCancellationFlowDecision,
  submitSessionCancellationConfirmDecision,
  submitSessionCancellationGiftCardDecision,
  submitSessionCancellationRefundDecision,
  submitSessionCancellationRescheduleDecision,
  submitServiceRescheduleDecision
} from '../controllers/sessionCancellationFlowController.js';

const router = express.Router();

// SECURITY (Phase 1A): mock-pay creates a real Sale/Purchase (and can debit gift
// cards) WITHOUT any real payment. It must never be reachable in production.
// Returns 404 (not 403) so production does not even reveal the endpoint exists.
// It remains available in development and test (for characterization/tests).
function requireNonProductionMockPayment(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND' });
  }
  return next();
}

router.get('/me/products', requireAuth(), getMyProducts);
router.get('/me/formations', requireAuth(), getMyFormations);
router.get('/me/presentiel', requireAuth(), getMyPresentielSession);
router.get('/purchase-status', requireAuth(), getPurchaseStatus);
router.get('/formations/:id', requireAuth(), getFormationSummary);
router.get('/formations/:id/modules', requireAuth(), getModulesForFormation);
router.post('/formations/:id/review', requireAuth(), postFormationReview);
router.get('/modules/:moduleId', requireAuth(), getModuleDetail);
router.get('/formations/:id/session', requireAuth(), getFormationSession);
router.get('/formations/:id/participants', requireAuth(), getFormationParticipants);
router.post('/formations/:formationId/cancel', requireAuth(), cancelFormationParticipation);
router.get('/session-cancel-flows/:flowId', getSessionCancellationFlowDecision);
router.post('/session-cancel-flows/:flowId/confirm', submitSessionCancellationConfirmDecision);
router.post('/session-cancel-flows/:flowId/gift-card', submitSessionCancellationGiftCardDecision);
router.post('/session-cancel-flows/:flowId/refund', submitSessionCancellationRefundDecision);
router.post(
  '/session-cancel-flows/:flowId/reschedule',
  submitSessionCancellationRescheduleDecision
);
router.post(
  '/session-cancel-flows/:flowId/service-reschedule',
  submitServiceRescheduleDecision
);
router.post(
  '/mock-pay',
  requireNonProductionMockPayment,
  requireAuth(),
  requireSiteActiveForPurchases(),
  mockPay
);
// Phase 1B-4: production endpoint to finalize a 0€ order (100% gift card / free item)
// without Stripe. Unlike mock-pay it is NOT dev-only: it re-validates server-side that
// nothing remains due (requireZeroRemaining) and reuses the Stripe-success finalizer.
router.post(
  '/checkout/finalize-free',
  requireAuth(),
  requireSiteActiveForPurchases(),
  finalizeFreeCheckout
);
router.put('/formations/:formationId/change-session', requireAuth(), changeFormationSession);
router.post('/cart-snapshot', requireAuth(), saveCartSnapshot);
router.get('/sales', requireAuth(), listMySales);
router.get('/sales/:saleId/invoice', requireAuth(), downloadClientInvoice);
router.get('/profile', requireAuth(), getProfile);
router.put('/profile', requireAuth(), updateProfile);
router.get('/favorites', requireAuth(), listFavorites);
router.post('/favorites', requireAuth(), addFavorite);
router.delete('/favorites/:id', requireAuth(), removeFavorite);

// Service bookings
router.get('/me/booking-status', requireAuth(), getMyBookingStatus);
router.post('/bookings', requireAuth(), createBooking);
router.get('/bookings', requireAuth(), listMyBookings);
router.get('/bookings/by-payment-intent/:paymentIntentId', requireAuth(), getBookingByPaymentIntent);
router.get('/bookings/:bookingId/refund-eligibility', requireAuth(), getBookingRefundEligibility);
router.get('/bookings/:bookingId/invoice', requireAuth(), getBookingInvoice);
router.get('/bookings/:bookingId/status', requireAuth(), getBookingStatus);
router.post('/bookings/:bookingId/cancel', requireAuth(), cancelMyBooking);
router.post('/bookings/:bookingId/confirm-payment', requireAuth(), confirmBookingPayment);

export default router;
