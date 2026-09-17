/**
 * bookingRemindersJob.js
 * Envoi de rappels email pour les réservations de prestations à venir.
 * Exécuté toutes les heures via setInterval dans app.js.
 * Utilise ServiceSettings.reminders pour configurer les délais.
 */

import ServiceBooking from '../models/ServiceBooking.js';
import ServiceSettings from '../models/ServiceSettings.js';
import { sendBookingReminderEmail } from '../services/mailService.js';
import { emitBookingEvent } from '../services/businessEventService.js';

/**
 * Exécute le job de rappels.
 * Pour chaque rappel configuré et actif, cherche les réservations
 * dans la fenêtre [hoursAhead - 0.5h, hoursAhead + 0.5h] et envoie
 * l'email si pas encore envoyé (remindersSent ne contient pas la clé).
 */
export async function runBookingRemindersJob() {
  try {
    const settings = await ServiceSettings.findOne().lean();
    if (!settings?.reminders?.length) return { sent: 0 };

    let totalSent = 0;
    const now = new Date();

    for (const reminder of settings.reminders) {
      if (!reminder.isActive) continue;

      const hoursAhead = Number(reminder.hoursBeforeAppointment);
      if (!Number.isFinite(hoursAhead) || hoursAhead <= 0) continue;

      const windowStart = new Date(now.getTime() + (hoursAhead - 0.5) * 3600000);
      const windowEnd = new Date(now.getTime() + (hoursAhead + 0.5) * 3600000);
      const reminderKey = `${hoursAhead}h`;

      const bookings = await ServiceBooking.find({
        status: 'confirmed',
        startAt: { $gte: windowStart, $lte: windowEnd },
        remindersSent: { $nin: [reminderKey] }
      })
        .populate('serviceId', 'name duration')
        .populate('clientId', 'firstName lastName email')
        .populate('practitionerId', 'displayName')
        .lean();

      for (const booking of bookings) {
        try {
          if (booking.clientId?.email) {
            await sendBookingReminderEmail({
              booking,
              hoursAhead
            });
          }
          await ServiceBooking.findByIdAndUpdate(booking._id, {
            $push: { remindersSent: reminderKey }
          });
          // Audit-only event (best-effort, no side effect).
          await emitBookingEvent('booking.reminded', booking, { extra: { hoursAhead } });
          totalSent++;
        } catch (e) {
          console.error('[BookingReminders] Erreur envoi rappel', booking.bookingId, e.message);
        }
      }
    }

    return { sent: totalSent };
  } catch (e) {
    console.error('[BookingReminders] Erreur job', e.message);
    return { sent: 0 };
  }
}
