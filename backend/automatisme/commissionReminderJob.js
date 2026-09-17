/**
 * commissionReminderJob.js
 * Scheduler quotidien (08h00) — envoie les emails de rappel de paiement
 * des commissions aux admins :
 *   - commission_available  : premier jour où le paiement est disponible
 *   - commission_reminder   : X jours avant la date limite (configuré dans CommissionSettings)
 *   - commission_last_day   : dernier jour avant retard
 */

import CommissionPayment from '../models/CommissionPayment.js';
import CommissionSettings from '../models/CommissionSettings.js';
import User from '../models/user.js';
import {
  sendCommissionAvailableEmail,
  sendCommissionReminderEmail,
  sendCommissionLastDayEmail
} from '../services/mailService.js';
import { resolvePanelUrl } from '../services/system/domainResolver.js';
import { getNow } from '../utils/simulatedDate.js';
import { emitCommissionEvent } from '../services/businessEventService.js';

let started = false;

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

function computeNextRun(reference = new Date()) {
  const next = new Date(reference);
  next.setHours(8, 0, 0, 0);
  if (next.getTime() <= reference.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

// Retourne le début du jour (minuit) en heure locale
function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

async function collectAdminEmails() {
  try {
    const admins = await User.find({ role: 'admin' }).select('email').lean();
    const seen = new Set();
    const emails = [];
    for (const u of admins) {
      const email = String(u?.email || '').trim();
      const lower = email.toLowerCase();
      if (!email || seen.has(lower)) continue;
      seen.add(lower);
      emails.push(email);
    }
    return emails;
  } catch (_) {
    return [];
  }
}

export async function executeJob() {
  try {
    const settings = await CommissionSettings.findOne().lean() || { latePaymentDays: 15, reminders: [] };
    const latePaymentDays = settings.latePaymentDays ?? 15;
    const reminders = Array.isArray(settings.reminders) ? settings.reminders : [];

    // Ne traiter que les paiements non réglés
    const payments = await CommissionPayment.find({ status: { $ne: 'succeeded' } });
    if (!payments.length) return;

    const adminEmails = await collectAdminEmails();
    if (!adminEmails.length) {
      console.warn('[CommissionReminderJob] Aucun email admin trouvé.');
      return;
    }

    const today = startOfDay(await getNow());
    const platformUrl = resolvePanelUrl('gestion.html?module=commissionPayment');

    for (const payment of payments) {
      if (Number(payment.amount) === 0) continue; // montant nul — déjà succeeded, pas de mail

      const { month, year } = payment;
      const periodLabel = `${MONTH_NAMES_FR[month]} ${year}`;
      const amount = Number(payment.amount || 0).toFixed(2);

      // Date à partir de laquelle le paiement est disponible (1er du mois suivant)
      const availableFrom = startOfDay(new Date(year, month + 1, 1));
      // Date limite avant retard
      const dueDate = new Date(availableFrom);
      dueDate.setDate(dueDate.getDate() + latePaymentDays);
      const dueDateStart = startOfDay(dueDate);

      // Pas encore disponible → skip
      if (today < availableFrom) continue;

      // Calcul des jours restants (depuis today jusqu'à dueDate)
      const msLeft = dueDateStart.getTime() - today.getTime();
      const daysLeft = Math.max(0, Math.round(msLeft / 86400000));

      let dirty = false;

      // ── Notification "disponible" (premier jour)
      if (today.getTime() === availableFrom.getTime() && !payment.availableMailSentAt) {
        const ok = await sendCommissionAvailableEmail({
          toEmails: adminEmails,
          period: periodLabel,
          amount,
          daysTotal: latePaymentDays,
          platformUrl,
          context: { contextType: 'commission_payment', contextId: String(payment._id) }
        });
        if (ok) {
          payment.availableMailSentAt = new Date();
          dirty = true;
          await emitCommissionEvent('commission.available', payment);
        }
      }

      // ── Rappels configurés
      for (const reminder of reminders) {
        const d = reminder.daysBeforeDue;
        if (daysLeft === d && !(payment.reminderMailsSentDays || []).includes(d)) {
          const ok = await sendCommissionReminderEmail({
            toEmails: adminEmails,
            period: periodLabel,
            amount,
            daysLeft: d,
            platformUrl,
            context: { contextType: 'commission_payment', contextId: String(payment._id) }
          });
          if (ok) {
            payment.reminderMailsSentDays = [...(payment.reminderMailsSentDays || []), d];
            dirty = true;
            await emitCommissionEvent('commission.reminder_sent', payment, { extra: { daysLeft: d } });
          }
        }
      }

      // ── Dernier jour (daysLeft === 0 = aujourd'hui est le jour de la date limite)
      if (daysLeft === 0 && !payment.lastDayMailSentAt) {
        const ok = await sendCommissionLastDayEmail({
          toEmails: adminEmails,
          period: periodLabel,
          amount,
          platformUrl
        });
        if (ok) {
          payment.lastDayMailSentAt = new Date();
          dirty = true;
        }
      }

      if (dirty) {
        await payment.save();
      }
    }

    console.log(`[CommissionReminderJob] Vérification terminée (${payments.length} paiement(s) traité(s)).`);
  } catch (error) {
    console.error('[CommissionReminderJob] Erreur lors de l\'exécution :', error);
  }
}

function scheduleNext() {
  const now = new Date();
  const nextRun = computeNextRun(now);
  const delay = Math.max(0, nextRun.getTime() - now.getTime());
  setTimeout(() => { void runAndSchedule(); }, delay);
}

async function runAndSchedule() {
  await executeJob();
  scheduleNext();
}

export function startCommissionReminderJob() {
  if (started) return;
  started = true;
  // Exécution immédiate au démarrage puis planification quotidienne
  void executeJob();
  scheduleNext();
}
