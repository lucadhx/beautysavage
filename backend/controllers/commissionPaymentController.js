/**
 * commissionPaymentController.js
 * Gestion des paiements de commissions mensuels via Stripe Developer.
 *
 * Endpoints :
 *   GET  /api/commissions/payments               — liste + mois manquants (admin + dev)
 *   POST /api/commissions/payments/:id/create-intent — crée PaymentIntent (admin + dev)
 *   GET  /api/commissions/payments/:id/check-status  — vérifie + met à jour status (admin + dev)
 *   GET  /api/commissions/settings               — délai retard (dev only)
 *   PATCH /api/commissions/settings              — met à jour délai retard (dev only)
 */

import Contract from '../models/Contract.js';
import CommissionPayment from '../models/CommissionPayment.js';
import CommissionSettings from '../models/CommissionSettings.js';
import Sale from '../models/Sale.js';
import RefundRequest from '../models/RefundRequest.js';
import { getStripeDevClient } from '../utils/stripeDevClient.js';
// Sprint F2B — domaine Stripe Dev extrait vers services/stripe/dev/*.
import { generateCommissionInvoice } from '../services/stripe/dev/stripeDevInvoiceService.js';
import { createCommissionPaymentIntent } from '../services/stripe/dev/stripeDevPaymentService.js';
// Sprint U3 — UnifiedCheckout plateforme (Stripe Dev) + Checkout hébergé derrière flag.
import { isPlatformCheckoutHostedEnabled } from '../services/checkout/unified/unifiedCheckoutConfig.js';
import { createPlatformUnifiedCheckoutRecord } from '../services/checkout/unified/unifiedCheckoutFactory.js';
import { updateCheckout } from '../services/checkout/unified/unifiedCheckoutRepository.js';
import { createDevPaymentCheckoutSession } from '../services/stripe/dev/stripeDevHostedCheckoutService.js';
import { emitCommissionEvent } from '../services/businessEventService.js';
import {
  getOrComputeCommissionPayment,
  getMonthsFromContractStart,
  getCommissionSettings,
  refreshCommissionPayment
} from '../services/commissionPaymentService.js';
import { executeJob } from '../automatisme/commissionReminderJob.js';
import { getNow } from '../utils/simulatedDate.js';


function respondError(res, error, context) {
  console.error(`[CommissionPaymentController:${context}]`, error);
  const status = error?.status || 500;
  return res.status(status).json({
    ok: false,
    code: error?.code || 'COMMISSION_ERROR',
    error: error?.message || 'Erreur interne.'
  });
}

// ---------------------------------------------------------------------------
// finalizeCommissionPaymentById — marque un CommissionPayment réglé (paid). SOURCE de
// finalisation serveur partagée par le webhook Dev ET le polling check-status.
// Idempotent : un mois déjà 'paid' ne re-déclenche ni event ni facture.
// ---------------------------------------------------------------------------
export async function finalizeCommissionPaymentById(commissionPaymentId) {
  const payment = await CommissionPayment.findById(commissionPaymentId);
  if (!payment) return { ok: false, reason: 'not_found' };
  if (payment.status === 'succeeded' && payment.settledReason === 'paid') {
    return { ok: true, idempotent: true, payment };
  }
  payment.status = 'succeeded';
  payment.settledReason = 'paid';
  payment.paidAt = payment.paidAt || new Date();
  payment.paymentInProgress = false;
  payment.paymentInProgressAt = null;
  await payment.save();
  await emitCommissionEvent('commission.paid', payment);
  // Facture Stripe Dev (non bloquante).
  await generateCommissionInvoice(payment.toObject()).catch(err =>
    console.error('[CommissionPayment] Erreur génération facture:', err)
  );
  return { ok: true, payment };
}

// Clé d'idempotence stable par mois (et montant) pour le PaymentIntent commission.
function buildCommissionIdempotencyKey(payment, amountCents) {
  return `commission_payment_${payment.year}_${payment.month}_${amountCents}`;
}

// ---------------------------------------------------------------------------
// GET /api/commissions/payments
// ---------------------------------------------------------------------------
export async function getCommissionPayments(req, res) {
  try {
    // Récupérer le contrat actif pour connaître la date de départ
    const contract = await Contract.findOne({ status: 'active' }).lean();
    if (!contract) {
      return res.status(404).json({ ok: false, error: 'Aucun contrat actif.' });
    }

    const activatedAt = contract.activatedAt;
    if (!activatedAt) {
      return res.status(400).json({ ok: false, error: 'Date d\'activation du contrat introuvable.' });
    }

    const settings = await getCommissionSettings();
    const now = await getNow();
    const months = getMonthsFromContractStart(activatedAt, now);

    // SÉQUENTIEL (du plus ancien au plus récent) : le carry-over négatif d'un mois
    // dépend du mois précédent. Un calcul parallèle casserait le report.
    const payments = [];
    for (const { month, year } of months) {
      // eslint-disable-next-line no-await-in-loop
      payments.push(await getOrComputeCommissionPayment(month, year));
    }

    return res.json({
      ok: true,
      payments,
      settings: { latePaymentDays: settings.latePaymentDays },
      contractActivatedAt: activatedAt
    });
  } catch (error) {
    return respondError(res, error, 'GetPayments');
  }
}

// ---------------------------------------------------------------------------
// POST /api/commissions/payments/:id/create-intent
// ---------------------------------------------------------------------------
export async function createCommissionIntent(req, res) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return res.status(500).json({ ok: false, error: 'Client Stripe Developer non configuré.' });
    }

    const existingPayment = await CommissionPayment.findById(req.params.id);
    if (!existingPayment) {
      return res.status(404).json({ ok: false, error: 'Paiement introuvable.' });
    }
    if (existingPayment.status === 'succeeded' && existingPayment.settledReason === 'paid') {
      return res.status(409).json({ ok: false, error: 'Ce mois a déjà été réglé.' });
    }

    // ── REFRESH OBLIGATOIRE ── recalcul du mois (source unique + carry-over) AVANT toute
    // création de PaymentIntent → on ne paie jamais un montant figé/périmé.
    await refreshCommissionPayment(req.params.id);
    const payment = await CommissionPayment.findById(req.params.id);

    const amountCents = Math.round((payment.netAmountDue || 0) * 100);

    // netAmountDue === 0 → mois soldé sans paiement (settled_zero), aucun PaymentIntent.
    if (amountCents <= 0) {
      return res.json({ ok: true, settledZero: true, status: payment.status, netAmountDue: payment.netAmountDue || 0 });
    }

    // Sprint U3 — Stripe Checkout HÉBERGÉ plateforme (flag). Le PaymentIntent hérite de
    // metadata.commissionPaymentId → le webhook Dev payment_intent.succeeded EXISTANT finalise
    // (finalizeCommissionPaymentById). Le polling check-status reste fonctionnel.
    if (isPlatformCheckoutHostedEnabled()) {
      const productName = `Commissions Beauty Savage ${payment.year}-${String(Number(payment.month) + 1).padStart(2, '0')}`;
      const { checkout } = await createPlatformUnifiedCheckoutRecord({
        kind: 'commission',
        amountToPay: payment.netAmountDue || 0,
        userId: req.sessionUser?._id || null,
        source: 'platform_commission',
        idempotencyKey: buildCommissionIdempotencyKey(payment, amountCents),
        inputSnapshot: { commissionPaymentId: String(payment._id), month: payment.month, year: payment.year }
      });
      const session = await createDevPaymentCheckoutSession({
        amountCents,
        productName,
        paymentIntentMetadata: {
          type: 'commission',
          commissionPaymentId: String(payment._id),
          month: String(payment.month),
          year: String(payment.year),
          label: productName
        },
        sessionMetadata: {
          unifiedCheckoutId: checkout.checkoutId,
          commissionPaymentId: String(payment._id),
          kind: 'commission',
          year: String(payment.year),
          month: String(payment.month)
        }
      });
      if (session?.payment_intent) {
        payment.stripePaymentIntentId = session.payment_intent;
        await payment.save();
      }
      await updateCheckout(checkout.checkoutId, {
        'payment.stripeCheckoutSessionId': session.id,
        'payment.stripePaymentIntentId': session.payment_intent || null
      }).catch(() => {});
      return res.json({ ok: true, mode: 'hosted', url: session.url, checkoutId: checkout.checkoutId, amountCents });
    }

    // Idempotence — réutiliser un intent existant si cohérent en montant.
    if (payment.stripePaymentIntentId) {
      try {
        const pi = await stripeDevClient.paymentIntents.retrieve(payment.stripePaymentIntentId);
        switch (pi.status) {
          case 'succeeded':
            await finalizeCommissionPaymentById(payment._id);
            return res.json({ ok: true, alreadySucceeded: true });
          case 'requires_confirmation':
          case 'requires_action':
          case 'processing':
            if (Number(pi.amount) === amountCents) {
              return res.json({ ok: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, amountCents });
            }
            // Montant changé depuis le refresh → annuler l'ancien PI et en recréer un.
            try { await stripeDevClient.paymentIntents.cancel(pi.id); } catch (_) { /* best-effort */ }
            payment.stripePaymentIntentId = null;
            await payment.save();
            break;
          case 'canceled':
          case 'requires_payment_method':
          default:
            payment.stripePaymentIntentId = null;
            await payment.save();
        }
      } catch (_) {
        payment.stripePaymentIntentId = null;
        await payment.save();
      }
    }

    // ── VERROU ANTI DOUBLE-CLIC ── claim atomique : un seul appel concurrent passe.
    const claimed = await CommissionPayment.findOneAndUpdate(
      { _id: payment._id, status: 'pending', paymentInProgress: { $ne: true } },
      { $set: { paymentInProgress: true, paymentInProgressAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      // Un autre appel crée déjà l'intent. Retourner l'intent en cours s'il existe.
      const fresh = await CommissionPayment.findById(payment._id);
      if (fresh?.stripePaymentIntentId) {
        try {
          const pi = await stripeDevClient.paymentIntents.retrieve(fresh.stripePaymentIntentId);
          return res.json({ ok: true, clientSecret: pi.client_secret, paymentIntentId: pi.id, amountCents });
        } catch (_) { /* fallthrough */ }
      }
      return res.status(409).json({ ok: false, code: 'PAYMENT_IN_PROGRESS', error: 'Un paiement est déjà en cours pour ce mois.' });
    }

    try {
      const paymentIntent = await createCommissionPaymentIntent({
        payment,
        amountCents,
        idempotencyKey: buildCommissionIdempotencyKey(payment, amountCents)
      });

      claimed.stripePaymentIntentId = paymentIntent.id;
      await claimed.save();

      return res.json({
        ok: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents
      });
    } catch (createErr) {
      // Libérer le verrou si la création échoue, pour permettre une nouvelle tentative.
      claimed.paymentInProgress = false;
      claimed.paymentInProgressAt = null;
      await claimed.save().catch(() => {});
      throw createErr;
    }
  } catch (error) {
    return respondError(res, error, 'CreateIntent');
  }
}

// ---------------------------------------------------------------------------
// GET /api/commissions/payments/:id/check-status
// ---------------------------------------------------------------------------
export async function checkCommissionStatus(req, res) {
  const stripeDevClient = await getStripeDevClient();
  try {
    if (!stripeDevClient) {
      return res.status(500).json({ ok: false, error: 'Client Stripe Developer non configuré.' });
    }

    const payment = await CommissionPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ ok: false, error: 'Paiement introuvable.' });
    }

    if (payment.status === 'succeeded') {
      return res.json({ ok: true, status: 'succeeded', paidAt: payment.paidAt });
    }

    if (!payment.stripePaymentIntentId) {
      return res.json({ ok: true, status: payment.status });
    }

    const pi = await stripeDevClient.paymentIntents.retrieve(payment.stripePaymentIntentId);

    if (pi.status === 'succeeded' && payment.status !== 'succeeded') {
      // Fallback UX : le webhook Dev est la source de finalisation serveur, mais le
      // polling peut finaliser aussi (idempotent via finalizeCommissionPaymentById).
      await finalizeCommissionPaymentById(payment._id);
      const updated = await CommissionPayment.findById(payment._id).lean();
      return res.json({ ok: true, status: 'succeeded', paidAt: updated.paidAt });
    }

    if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
      payment.status = 'failed';
      payment.paymentInProgress = false;
      payment.paymentInProgressAt = null;
      await payment.save();
      return res.json({ ok: true, status: 'failed' });
    }

    return res.json({ ok: true, status: payment.status, stripeStatus: pi.status });
  } catch (error) {
    return respondError(res, error, 'CheckStatus');
  }
}

// ---------------------------------------------------------------------------
// POST /api/commissions/payments/:id/reset — dev only, non-production
// Remet un paiement succeeded à l'état pending pour tests
// ---------------------------------------------------------------------------
export async function resetCommissionPayment(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ ok: false, error: 'Interdit en production.' });
    }

    const payment = await CommissionPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ ok: false, error: 'Paiement introuvable.' });
    }

    payment.status = 'pending';
    payment.settledReason = null;
    payment.stripePaymentIntentId = null;
    payment.paymentInProgress = false;
    payment.paymentInProgressAt = null;
    payment.stripeInvoiceId = null;
    payment.stripeInvoicePdfUrl = null;
    payment.paidAt = null;
    await payment.save();

    return res.json({ ok: true, message: 'Paiement remis à pending.' });
  } catch (error) {
    return respondError(res, error, 'ResetPayment');
  }
}

// ---------------------------------------------------------------------------
// GET /api/commissions/settings — dev only
// ---------------------------------------------------------------------------
export async function getCommissionSettingsHandler(req, res) {
  try {
    const settings = await getCommissionSettings();
    return res.json({
      ok: true,
      settings: {
        latePaymentDays: settings.latePaymentDays,
        reminders: (settings.reminders || []).map(r => ({ daysBeforeDue: r.daysBeforeDue })),
        simulatedDate: settings.simulatedDate ? settings.simulatedDate.toISOString().slice(0, 10) : null,
        // RX2.5 — termes de paiement étendus (grace period + mode de blocage).
        gracePeriodDays: settings.gracePeriodDays ?? 0,
        blockingMode: settings.blockingMode || 'none',
        suspensionWarningAfterDays: settings.suspensionWarningAfterDays ?? 0
      }
    });
  } catch (error) {
    return respondError(res, error, 'GetSettings');
  }
}

// ---------------------------------------------------------------------------
// POST /api/commissions/settings/simulated-date — dev only
// Stocke une date simulée en base. { date: 'YYYY-MM-DD' } ou { date: null } pour réinitialiser.
// Déclenche ensuite le job de rappel pour propager l'effet immédiatement.
// ---------------------------------------------------------------------------
export async function setSimulatedDate(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ ok: false, error: 'Interdit en production.' });
    }

    const rawDate = req.body?.date ?? null;
    let simulatedDate = null;
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ ok: false, error: 'Date invalide.' });
      }
      simulatedDate = parsed;
    }

    await CommissionSettings.findOneAndUpdate(
      {},
      { $set: { simulatedDate } },
      { upsert: true }
    );

    // Réinitialisation : supprimer les CommissionPayment futurs créés pendant la simulation
    if (!simulatedDate) {
      const realNow = new Date();
      const firstDayOfCurrentMonth = new Date(realNow.getFullYear(), realNow.getMonth(), 1);
      await CommissionPayment.deleteMany({ periodStart: { $gt: firstDayOfCurrentMonth } });
    }

    // Déclencher le job de rappel avec la nouvelle date simulée
    void executeJob();

    return res.json({ ok: true, simulatedDate: simulatedDate ? simulatedDate.toISOString().slice(0, 10) : null });
  } catch (error) {
    return respondError(res, error, 'SetSimulatedDate');
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/commissions/settings — dev only
// Quand latePaymentDays diminue, supprime automatiquement les rappels hors tranche
// ---------------------------------------------------------------------------
export async function updateCommissionSettingsHandler(req, res) {
  try {
    const { latePaymentDays } = req.body || {};
    const days = Number(latePaymentDays);
    if (!Number.isFinite(days) || days < 2) {
      return res.status(400).json({ ok: false, error: 'latePaymentDays invalide (min 2).' });
    }

    let settings = await CommissionSettings.findOne();
    if (!settings) settings = new CommissionSettings();

    settings.latePaymentDays = Math.round(days);
    // Purge les rappels devenus invalides (daysBeforeDue >= nouveau latePaymentDays)
    settings.reminders = (settings.reminders || []).filter(
      r => r.daysBeforeDue >= 1 && r.daysBeforeDue < settings.latePaymentDays
    );
    // RX2.5 — termes de paiement étendus (optionnels, validés).
    if (req.body?.gracePeriodDays !== undefined) {
      const grace = Number(req.body.gracePeriodDays);
      if (!Number.isFinite(grace) || grace < 0) {
        return res.status(400).json({ ok: false, error: 'gracePeriodDays invalide (≥ 0).' });
      }
      settings.gracePeriodDays = Math.round(grace);
    }
    if (req.body?.blockingMode !== undefined) {
      const allowed = ['none', 'warning_only', 'block_purchases', 'block_manager'];
      if (!allowed.includes(req.body.blockingMode)) {
        return res.status(400).json({ ok: false, error: 'blockingMode invalide.' });
      }
      settings.blockingMode = req.body.blockingMode;
    }
    if (req.body?.suspensionWarningAfterDays !== undefined) {
      const warn = Number(req.body.suspensionWarningAfterDays);
      if (!Number.isFinite(warn) || warn < 0) {
        return res.status(400).json({ ok: false, error: 'suspensionWarningAfterDays invalide (≥ 0).' });
      }
      settings.suspensionWarningAfterDays = Math.round(warn);
    }
    settings.updatedAt = new Date();
    await settings.save();

    return res.json({
      ok: true,
      settings: {
        latePaymentDays: settings.latePaymentDays,
        reminders: settings.reminders.map(r => ({ daysBeforeDue: r.daysBeforeDue })),
        gracePeriodDays: settings.gracePeriodDays ?? 0,
        blockingMode: settings.blockingMode || 'none',
        suspensionWarningAfterDays: settings.suspensionWarningAfterDays ?? 0
      }
    });
  } catch (error) {
    return respondError(res, error, 'UpdateSettings');
  }
}

// ---------------------------------------------------------------------------
// POST /api/commissions/settings/reminders — dev only
// Ajoute un rappel. daysBeforeDue doit être 1 ≤ d < latePaymentDays
// ---------------------------------------------------------------------------
export async function addReminderHandler(req, res) {
  try {
    const { daysBeforeDue } = req.body || {};
    const days = Number(daysBeforeDue);
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ ok: false, error: 'daysBeforeDue invalide.' });
    }

    let settings = await CommissionSettings.findOne();
    if (!settings) settings = new CommissionSettings();

    if (days >= settings.latePaymentDays) {
      return res.status(400).json({
        ok: false,
        error: `daysBeforeDue doit être inférieur à latePaymentDays (${settings.latePaymentDays}).`
      });
    }

    const exists = (settings.reminders || []).some(r => r.daysBeforeDue === days);
    if (exists) {
      return res.status(409).json({ ok: false, error: 'Un rappel existe déjà pour ce nombre de jours.' });
    }

    settings.reminders = [...(settings.reminders || []), { daysBeforeDue: days }]
      .sort((a, b) => b.daysBeforeDue - a.daysBeforeDue);
    settings.updatedAt = new Date();
    await settings.save();

    return res.json({
      ok: true,
      reminders: settings.reminders.map(r => ({ daysBeforeDue: r.daysBeforeDue }))
    });
  } catch (error) {
    return respondError(res, error, 'AddReminder');
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/commissions/settings/reminders/:days — dev only
// ---------------------------------------------------------------------------
export async function removeReminderHandler(req, res) {
  try {
    const days = Number(req.params.days);
    if (!Number.isFinite(days)) {
      return res.status(400).json({ ok: false, error: 'Valeur invalide.' });
    }

    let settings = await CommissionSettings.findOne();
    if (!settings) settings = new CommissionSettings();

    const before = (settings.reminders || []).length;
    settings.reminders = (settings.reminders || []).filter(r => r.daysBeforeDue !== days);
    if (settings.reminders.length === before) {
      return res.status(404).json({ ok: false, error: 'Rappel introuvable.' });
    }
    settings.updatedAt = new Date();
    await settings.save();

    return res.json({
      ok: true,
      reminders: settings.reminders.map(r => ({ daysBeforeDue: r.daysBeforeDue }))
    });
  } catch (error) {
    return respondError(res, error, 'RemoveReminder');
  }
}
