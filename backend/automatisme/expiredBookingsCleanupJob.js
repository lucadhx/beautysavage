/**
 * expiredBookingsCleanupJob.js
 * Scheduler horaire — supprime les bookings restés en pending_payment > 2h.
 * Ces réservations n'ont pas été confirmées par Stripe et bloquent des créneaux.
 */

import ServiceBooking from '../models/ServiceBooking.js';

const JOB_INTERVAL_MS = 60 * 60 * 1000; // toutes les heures
const EXPIRY_MS = 2 * 60 * 60 * 1000;   // 2 heures

let intervalId = null;

async function executeCleanup() {
  try {
    const cutoff = new Date(Date.now() - EXPIRY_MS);
    const result = await ServiceBooking.deleteMany({
      status: 'pending_payment',
      createdAt: { $lt: cutoff }
    });
    if (result.deletedCount > 0) {
      console.log(`[BookingCleanup] ${result.deletedCount} booking(s) en pending_payment expiré(s) supprimé(s).`);
    }
  } catch (err) {
    console.error('[BookingCleanup] Erreur lors du nettoyage des bookings expirés :', err);
  }
}

export function startExpiredBookingsCleanupJob() {
  if (intervalId) return;
  // Exécuter immédiatement au démarrage, puis toutes les heures
  void executeCleanup();
  intervalId = setInterval(executeCleanup, JOB_INTERVAL_MS);
  console.log('[BookingCleanup] Job de nettoyage des bookings expirés démarré (intervalle : 1h).');
}
