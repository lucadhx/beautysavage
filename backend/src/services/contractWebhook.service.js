import {
  claimWebhookEvent, settleWebhookEvent, classifyWebhookError,
  statusAfterFailure, CLAIM_OUTCOME, MAX_PROCESSING_ATTEMPTS,
} from './webhooks/webhookLease.js';
import { Contract } from '../models/Contract.model.js';
import { Payment } from '../models/Payment.model.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { resolveProviderEnvironment } from './integratedApiEnvironment.js';
import * as paymentSvc from './payment.service.js';
import * as subscriptionSvc from './subscription.service.js';
import * as billingSvc from './billing.service.js';
import { wakePendingActionsForContract } from './events/pendingActionWakeup.js';
import {
  CONTRACT_STATUS as S,
  PAYMENT_TYPE,
  WEBHOOK_PROCESSING_STATUS,
} from '../utils/contractConstants.js';

/**
 * Traitement IDEMPOTENT des webhooks Stripe. `WebhookEvent` (index unique
 * provider + externalEventId) porte l'unicité ; son ÉTAT porte la décision. Un
 * événement CONCLU n'est jamais rejoué ; un événement ABANDONNÉ l'est, et c'est
 * ce qui rattrape un crash — voir `webhooks/webhookLease.js`.
 *
 * La vérité vient TOUJOURS du webhook signé, jamais d'une redirection navigateur.
 */

/**
 * ══ RÉCLAMATION, ET NON PLUS SIMPLE VERROU ══════════════════════════════════
 *
 * Ce qui se trouvait ici était le défaut :
 *
 *     create(PENDING)  →  E11000  →  { duplicate: true }
 *
 * Une ligne existante suffisait à déclarer l'événement consommé. Un crash entre
 * cette insertion et l'application métier rendait donc l'événement définitivement
 * inapplicable — Stripe rejouait, nous répondions « déjà vu », et l'effet
 * n'existait jamais.
 *
 * `webhookLease.js` porte désormais la décision, et elle dépend de l'ÉTAT :
 * un rejeu d'événement conclu reste un doublon, un rejeu d'événement ABANDONNÉ
 * est une reprise.
 */
async function finalize(event, status, { contractId, error } = {}) {
  if (!event) return;
  await settleWebhookEvent({
    provider: event.provider,
    externalEventId: event.externalEventId,
    status,
    contractId,
    error,
  });
}

// --- STRIPE -----------------------------------------------------------------

/**
 * Traite un événement Stripe concernant les FRAIS DE LANCEMENT (paiement unique).
 * Résout le Payment (journal), vérifie la cohérence de mode, applique l'état via
 * payment.service (idempotent). Le paiement n'est JAMAIS acquitté prématurément.
 */
async function handleLaunchFeeEvent(contract, type, obj, meta, mode) {
  const isSession = type.startsWith('checkout.session');
  const checkoutSessionId = isSession ? obj.id : null;
  let paymentIntentId = null;
  if (type.startsWith('payment_intent')) paymentIntentId = obj.id;
  else if (type === 'charge.refunded') paymentIntentId = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id || null;
  else if (isSession) paymentIntentId = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id || null;

  let payment = await paymentSvc.findLaunchPaymentFor(contract, { paymentId: meta.paymentId, checkoutSessionId, paymentIntentId });
  if (!payment) {
    // Aucun remboursement ne doit créer un paiement de rattrapage (incohérent).
    if (type === 'charge.refunded') return { handled: false, contract };
    payment = await paymentSvc.backfillLaunchPayment(contract, {
      mode,
      checkoutSessionId,
      paymentIntentId,
      customerId: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id || null,
    });
  }

  // Cohérence de mode : un événement d'un mode ne modifie jamais un paiement de
  // l'autre mode (jamais de bascule silencieuse).
  if (payment.providerMode && payment.providerMode !== mode) {
    logger.warn(`[webhook] Stripe mode mismatch paiement ${payment._id} (${payment.providerMode} != ${mode})`);
    return { handled: false, contract };
  }

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await paymentSvc.settleFromSession(contract, payment, obj);
      break;
    case 'checkout.session.async_payment_failed':
      await paymentSvc.markFailed(contract, payment, { reason: 'async_payment_failed', paymentIntentId });
      break;
    case 'checkout.session.expired':
      await paymentSvc.markExpired(contract, payment);
      break;
    case 'payment_intent.succeeded':
      await paymentSvc.settleFromPaymentIntent(contract, payment, obj);
      break;
    case 'payment_intent.payment_failed':
      await paymentSvc.markFailed(contract, payment, { reason: obj.last_payment_error?.message || 'payment_failed', paymentIntentId: obj.id });
      break;
    case 'charge.refunded':
      await paymentSvc.markRefunded(contract, payment);
      break;
    default:
      return { handled: false, contract };
  }
  return { handled: true, contract };
}

/**
 * Traite un événement de FACTURE Stripe (miroir + rattachement contrat). La
 * facture est reflétée dans tous les cas (numéro, liens PDF/hosted). Le contrat
 * est résolu par metadata → abonnement → client (les factures d'abonnement
 * n'héritent pas des metadata). Pour une facture d'ABONNEMENT payée/échouée, on
 * met aussi à jour l'état d'abonnement (cycle mensuel).
 */
async function handleInvoiceEvent(type, obj, observedAt = null) {
  const contract = await billingSvc.resolveContractForInvoice(obj);
  await billingSvc.upsertInvoiceFromStripe(obj, contract);
  const isSubscription = billingSvc.invoiceType(obj) === PAYMENT_TYPE.SUBSCRIPTION;
  if (contract && isSubscription) {
    if (type === 'invoice.paid') await subscriptionSvc.markInvoicePaid(contract, obj, { observedAt });
    else if (type === 'invoice.payment_failed') await subscriptionSvc.markInvoiceFailed(contract, obj, {});
  }

  /**
   * LA FACTURE VIENT D'ARRIVER — CE QUI L'ATTENDAIT PEUT REPARTIR.
   *
   * ══ LE DÉFAUT OBSERVÉ EN RECETTE RÉELLE ═════════════════════════════════
   *
   * Le 21 août, le règlement des frais de lancement a été annoncé à 12:33:19
   * et la facture émise à 12:33:22 — trois secondes plus tard. La confirmation
   * au client a donc refusé de partir, correctement : son bouton « Voir ma
   * facture » n'aurait mené à rien.
   *
   * Elle s'est déclarée REJOUABLE, ce qui est exact — mais ce dépôt n'a pas de
   * minuterie de reprise, et l'assume : un `FAILED` retryable attend le
   * prochain démarrage. Le message serait donc resté en attente indéfiniment,
   * pour trois secondes de décalage.
   *
   * ══ POURQUOI ICI, ET PAS UNE MINUTERIE ══════════════════════════════════
   *
   * Parce que ce que le message attendait n'est pas un DÉLAI, c'est un FAIT —
   * et ce fait, c'est précisément l'événement qu'on est en train de traiter.
   * Sonder en boucle chercherait ce qu'on tient déjà dans la main.
   *
   * Best-effort et jamais bloquant : la facture est reflétée, le paiement est
   * acté, et un envoi qui ne repart pas ici repartira au démarrage suivant.
   */
  if (contract) await wakePendingActionsForContract(contract._id);

  return { handled: true, contract };
}

async function processStripeEvent(evt, ctx = {}) {
  const type = evt.type;
  const obj = evt.data?.object || {};
  /**
   * QUAND LE FOURNISSEUR A PRODUIT CET INSTANTANÉ — jamais quand nous l'avons reçu.
   *
   * Stripe ne garantit aucun ordre de livraison, et chaque événement transporte
   * l'objet TEL QU'IL ÉTAIT à `evt.created`. C'est donc cette date, et elle
   * seule, qui permet de refuser une annonce tardive porteuse d'un état ancien.
   * Voir `Contract.stripe.subscription.statusObservedAt`.
   */
  const observedAt = Number.isFinite(evt.created) ? new Date(evt.created * 1000) : null;
  const meta = obj.metadata || {};
  let contract = meta.contractId ? await Contract.findById(meta.contractId) : null;
  const mode = ctx.mode || resolveProviderEnvironment('STRIPE');

  switch (type) {
    case 'checkout.session.completed': {
      if (!contract) return { handled: false };
      contract.stripe.customerId = obj.customer || contract.stripe.customerId;
      if (meta.paymentType === PAYMENT_TYPE.SUBSCRIPTION || obj.mode === 'subscription') {
        // Abonnement : ne jamais marquer « actif » sur la seule session — on
        // récupère le statut RÉEL de la Subscription (délégué au service).
        await subscriptionSvc.settleFromCheckoutSession(contract, obj, { observedAt });
        return { handled: true, contract };
      }
      // Frais de lancement (paiement unique) — délégué au service Payment.
      await contract.save(); // persiste customerId avant projection
      return handleLaunchFeeEvent(contract, type, obj, meta, mode);
    }

    // Frais de lancement — paiements asynchrones, PaymentIntent, remboursement.
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'charge.refunded': {
      // Le PaymentIntent/charge n'a pas toujours nos metadata : on résout le
      // contrat par le paiement rattaché à l'identifiant PaymentIntent.
      if (!contract && (type === 'charge.refunded' || type.startsWith('payment_intent'))) {
        const piId = type === 'charge.refunded'
          ? (typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id)
          : obj.id;
        if (piId) {
          const p = await Payment.findOne({ 'stripe.paymentIntentId': piId });
          if (p) contract = await Contract.findById(p.contractId);
        }
      }
      if (!contract) return { handled: false };
      if (meta.paymentType && meta.paymentType !== PAYMENT_TYPE.LAUNCH_FEE) return { handled: false, contract };
      return handleLaunchFeeEvent(contract, type, obj, meta, mode);
    }

    // Factures Stripe (frais de lancement via invoice_creation + cycles d'abonnement).
    // `finalized` capte le numéro + le PDF dès l'émission ; `paid`/`payment_failed`
    // reflètent le règlement. Politique impayé V1 : abonnement PAST_DUE, SITE
    // MAINTENU ACTIF (Stripe gère ses relances) — voir STRIPE_SUBSCRIPTION_FLOW.md.
    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return handleInvoiceEvent(type, obj, observedAt);

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (!contract) contract = await Contract.findOne({ 'stripe.subscription.subscriptionId': obj.id });
      if (!contract) return { handled: false };
      // `deleted` = fin effective : le service passe le contrat en ENDED et
      // suspend le site. Sinon : projection du statut réel (jamais d'activation).
      const stripeSub = type === 'customer.subscription.deleted' ? { ...obj, status: 'canceled' } : obj;
      await subscriptionSvc.settleFromSubscription(contract, stripeSub, { observedAt });
      return { handled: true, contract };
    }

    default:
      return { handled: false };
  }
}

// --- YOUSIGN : plus rien ici (R10.5C) ---------------------------------------
//
// Yousign n'appelle plus ce projet. Le Panel reçoit le webhook, le vérifie,
// résout l'appartenance de la demande, le normalise en `SIGNATURE_EVENT` et le
// projette DURABLEMENT par le pont. L'application du fait vit désormais dans
// `services/signature/signatureEvent.applier.js`.
//
// Le traitement local a été RETIRÉ plutôt que laissé en sommeil : une seconde
// implémentation du même parcours, plus branchée sur rien, aurait divergé en
// silence de celle qui fait foi — et c'est elle qu'on aurait relue le jour d'un
// incident.

// --- Dispatchers publics ----------------------------------------------------

/** L'événement appartient-il au mode actif ? (sinon : acquitté mais non traité) */
function isActiveModeEvent(verification) {
  if (!verification || !verification.matchedMode) return true; // pas de routage -> mode actif
  return verification.matchedMode === verification.activeMode;
}

export async function handleStripeWebhook(evt, verification = {}) {
  const reclamation = await claimWebhookEvent({
    provider: 'STRIPE',
    externalEventId: evt.id,
    eventType: evt.type,
    environment: config.env,
  });

  /**
   * `duplicate` ne signifie plus « la ligne existait ». Il signifie « il n'y a
   * rien à faire » — soit l'événement est conclu, soit un autre processus le
   * tient sous un bail valide. Les deux méritent un 200 ; ils ne méritent pas
   * le même mot dans un incident, d'où `reason`.
   */
  if (reclamation.outcome === CLAIM_OUTCOME.TERMINAL) {
    return { duplicate: true, reason: 'ALREADY_SETTLED' };
  }
  if (reclamation.outcome === CLAIM_OUTCOME.IN_FLIGHT) {
    return { duplicate: true, reason: 'IN_FLIGHT' };
  }
  if (reclamation.outcome === CLAIM_OUTCOME.RECLAIMED) {
    logger.warn(
      `[webhook] ${evt.id} (${evt.type}) REPRIS — tentative ${reclamation.attempts} : `
      + 'un traitement précédent ne s’est jamais achevé.',
    );
  }

  const event = { provider: 'STRIPE', externalEventId: evt.id };

  // Événement d'un mode NON actif (retardé après bascule) : on acquitte sans
  // traiter (aucune pollution inter-mode).
  if (!isActiveModeEvent(verification)) {
    await finalize(event, WEBHOOK_PROCESSING_STATUS.IGNORED, {
      error: {
        code: 'MODE_MISMATCH',
        message: `mode_mismatch:${verification.matchedMode}!=${verification.activeMode}`,
        retryable: false,
      },
    });
    return { duplicate: false, handled: false, ignored: 'mode_mismatch', matchedMode: verification.matchedMode };
  }
  try {
    const mode = verification.matchedMode || verification.activeMode;
    const { handled, contract } = await processStripeEvent(evt, { mode });
    await finalize(
      event,
      handled ? WEBHOOK_PROCESSING_STATUS.PROCESSED : WEBHOOK_PROCESSING_STATUS.IGNORED,
      { contractId: contract?._id },
    );
    return { duplicate: false, handled, reclaimed: reclamation.outcome === CLAIM_OUTCOME.RECLAIMED };
  } catch (e) {
    /**
     * ── L'ÉCHEC EST CLASSÉ, PAS SEULEMENT CONSIGNÉ ────────────────────────
     *
     * `FAILED` était un cul-de-sac : l'événement y restait, et le rejeu
     * suivant le voyait comme un doublon. Il est désormais REPRENABLE tant que
     * l'erreur peut changer d'issue et que le plafond n'est pas atteint —
     * `DEAD_LETTER`, supervisé, au-delà.
     */
    const cause = classifyWebhookError(e);
    const statut = statusAfterFailure({ retryable: cause.retryable, attempts: reclamation.attempts });
    await finalize(event, statut, { error: cause });
    if (statut === WEBHOOK_PROCESSING_STATUS.DEAD_LETTER) {
      logger.error(
        `[webhook] ${evt.id} (${evt.type}) ABANDONNÉ après ${reclamation.attempts} tentative(s) — `
        + `${cause.retryable ? `plafond de ${MAX_PROCESSING_ATTEMPTS} atteint` : 'erreur terminale'} : ${cause.code}.`,
      );
    }
    throw e;
  }
}
