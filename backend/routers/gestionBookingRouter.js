import express from 'express';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  getBookingDetail,
  markNoShow,
  markCompleted,
  cancelBookingByAdmin,
  markBalancePaidOnSite,
  rescheduleBookingByAdmin,
  simulateReminders,
  createManualBookingByAdmin,
  holdBookingSlotByAdmin,
  releaseBookingSlotHoldByAdmin
} from '../controllers/serviceBookingController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'));

// Static routes BEFORE parametric routes
router.post('/bookings/simulate-reminders', simulateReminders);
// M13 — réservation manuelle (paiement sur place) + holds temporaires de créneau.
router.post('/bookings/manual', createManualBookingByAdmin);
router.post('/bookings/hold', holdBookingSlotByAdmin);
router.post('/bookings/hold/release', releaseBookingSlotHoldByAdmin);

// Parametric routes
router.get('/bookings/:bookingId/detail', getBookingDetail);
router.post('/bookings/:bookingId/no-show', markNoShow);
router.post('/bookings/:bookingId/complete', markCompleted);
router.post('/bookings/:bookingId/cancel', cancelBookingByAdmin);
router.post('/bookings/:bookingId/balance-paid', markBalancePaidOnSite);
// M11B — Report ADMIN du créneau (calendrier global institut).
router.post('/bookings/:bookingId/reschedule', rescheduleBookingByAdmin);

export default router;
