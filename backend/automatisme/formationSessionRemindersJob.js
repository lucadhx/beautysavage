/**
 * formationSessionRemindersJob.js
 * LOT2 §5 — Rappels e-mail pour les SESSIONS DE FORMATION présentielles à venir.
 * Scheduler DÉDIÉ (ne réutilise pas le job prestations). Exécuté toutes les heures via app.js.
 *
 * Réutilise ServiceSettings.reminders (fenêtres en heures avant le début de session). Anti-doublon
 * par clé `${hoursAhead}h` poussée dans FormationSession.remindersSent (une passe d'envoi par
 * fenêtre et par session — tous les participants inscrits sont notifiés en une fois).
 *
 * Participants = Purchase{ sessionId, itemType:'formation', participationStatus != 'canceled' }
 * joints à User pour l'e-mail. Best-effort : ne throw jamais.
 */

import FormationSession from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import User from '../models/user.js';
import ServiceSettings from '../models/ServiceSettings.js';
import { sendFormationSessionReminderEmail } from '../services/mailService.js';
import { resolvePublicBaseUrl } from '../services/system/domainResolver.js';
import { emitFormationSessionEvent } from '../services/businessEventService.js';

function formatSessionDate(startDate) {
  if (!startDate) return '';
  try {
    return new Date(startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

export async function runFormationSessionRemindersJob() {
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

      const sessions = await FormationSession.find({
        status: 'active',
        startDate: { $gte: windowStart, $lte: windowEnd },
        remindersSent: { $nin: [reminderKey] }
      })
        .populate('formationId', 'name')
        .lean();

      for (const session of sessions) {
        try {
          const purchases = await Purchase.find({
            sessionId: session._id,
            itemType: 'formation',
            participationStatus: { $ne: 'canceled' }
          }).lean();
          const userIds = [...new Set(purchases.map((p) => String(p.userId)))];
          const users = userIds.length
            ? await User.find({ _id: { $in: userIds } }).select('firstName lastName email').lean()
            : [];

          const sessionTime = session.schedule?.[0]?.startTime || '';
          const sessionDate = formatSessionDate(session.startDate);
          const formationTitle = session.formationId?.name || '';

          for (const u of users) {
            if (!u.email) continue;
            await sendFormationSessionReminderEmail({
              toEmail: String(u.email).trim(),
              firstName: String(u.firstName || '').trim(),
              formationTitle,
              sessionDate,
              sessionTime,
              location: '',
              actionUrl: resolvePublicBaseUrl()
            });
          }

          await FormationSession.findByIdAndUpdate(session._id, { $push: { remindersSent: reminderKey } });
          await emitFormationSessionEvent('formation.session_reminded', session, { extra: { hoursAhead } });
          totalSent += users.length;
        } catch (e) {
          console.error('[FormationSessionReminders] Erreur envoi rappel session', String(session._id), e?.message || e);
        }
      }
    }

    return { sent: totalSent };
  } catch (e) {
    console.error('[FormationSessionReminders] Erreur job', e?.message || e);
    return { sent: 0 };
  }
}

export default runFormationSessionRemindersJob;
