import express from 'express';

import { requireAuth } from '../utils/session.js';
import {
  getCommissionPayments,
  createCommissionIntent,
  checkCommissionStatus,
  getCommissionSettingsHandler,
  updateCommissionSettingsHandler,
  addReminderHandler,
  removeReminderHandler,
  resetCommissionPayment,
  setSimulatedDate
} from '../controllers/commissionPaymentController.js';

const router = express.Router();

// ── Helpers de rôle ─────────────────────────────────────────────────────────

function requireAdminOrDev(req, res, next) {
  const role = String(req.sessionUser?.role || '').trim().toLowerCase();
  if (role !== 'admin' && role !== 'dev') {
    return res.status(403).json({ ok: false, error: 'Accès réservé admin/dev.' });
  }
  return next();
}

function requireDevOnly(req, res, next) {
  const role = String(req.sessionUser?.role || '').trim().toLowerCase();
  if (role !== 'dev') {
    return res.status(403).json({ ok: false, error: 'Accès réservé au développeur.' });
  }
  return next();
}

// ── Routes partagées admin + dev ─────────────────────────────────────────────

router.get('/payments', requireAuth(), requireAdminOrDev, getCommissionPayments);
router.post('/payments/:id/create-intent', requireAuth(), requireAdminOrDev, createCommissionIntent);
router.get('/payments/:id/check-status', requireAuth(), requireAdminOrDev, checkCommissionStatus);

// ── Routes dev uniquement ────────────────────────────────────────────────────

router.post('/payments/:id/reset', requireAuth(), requireDevOnly, resetCommissionPayment);
router.post('/settings/simulated-date', requireAuth(), requireDevOnly, setSimulatedDate);
router.get('/settings', requireAuth(), requireDevOnly, getCommissionSettingsHandler);
router.patch('/settings', requireAuth(), requireDevOnly, updateCommissionSettingsHandler);
router.post('/settings/reminders', requireAuth(), requireDevOnly, addReminderHandler);
router.delete('/settings/reminders/:days', requireAuth(), requireDevOnly, removeReminderHandler);

export default router;
