import { Payment } from '../models/Payment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { resolveProviderEnvironment } from './integratedApiEnvironment.js';
import { logContractAudit } from '../models/ContractAuditLog.model.js';
import { createLaunchCheckoutViaPanel, readCheckoutViaPanel } from './stripe/checkoutCapability.js';
import * as sm from './contractStateMachine.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { EVENT_ACTOR_TYPE } from '../utils/domainEventConstants.js';
import {
  PAYMENT_TYPE,
  PAYMENT_STATUS,
  PAYMENT_OPEN_STATUSES,
  PAYMENT_TERMINAL_STATUSES,
  LAUNCH_FEE_STATUS,
  AUDIT_ACTOR_TYPE,
  CONTRACT_AUDIT_ACTION,
} from '../utils/contractConstants.js';

/**
 * Paiements Stripe — frais de lancement (paiement UNIQUE). Le journal `Payment`
 * est la SOURCE DE VÉRITÉ ; `contract.stripe.launchFee` n'en est qu'une PROJECTION
 * lisible. La confirmation d'un paiement ne vient JAMAIS d'une redirection
 * navigateur : uniquement d'un webhook Stripe signé ou de la réconciliation
 * serveur. Montants en CENTIMES. Le montant facturé provient TOUJOURS du snapshot
 * contractuel verrouillé (jamais du frontend).
 *
 * Périmètre LOT F : frais de lancement uniquement. Aucune activation de site,
 * aucun abonnement, aucune résiliation ne sont déclenchés ici.
 */

export const LAUNCH_FEE_NOT_PAYABLE = 'LAUNCH_FEE_NOT_PAYABLE';

// --- Conditions d'accès au paiement (contrôle SERVEUR) ----------------------

/**
 * Renvoie la liste (stable, documentée) des raisons empêchant le paiement des
 * frais de lancement. Vide = payable. Codes : CONTRACT_NOT_VALIDATED,
 * CONTRACT_NOT_FULLY_SIGNED, LAUNCH_FEE_NOT_CONFIGURED, LAUNCH_FEE_ALREADY_PAID.
 * (La disponibilité du fournisseur Stripe est vérifiée à part via assertProviderReady.)
 */
export function launchFeePayableIssues(contract) {
  const missing = [];
  if (!contract?.signatureConfiguration?.locked) missing.push('CONTRACT_NOT_VALIDATED');
  if (!sm.signatureSatisfied(contract)) missing.push('CONTRACT_NOT_FULLY_SIGNED');
  const fee = contract?.pricing?.launchFee;
  if (!fee?.enabled || !(fee.amountIncludingTax > 0)) missing.push('LAUNCH_FEE_NOT_CONFIGURED');
  if (contract?.stripe?.launchFee?.status === LAUNCH_FEE_STATUS.PAID) missing.push('LAUNCH_FEE_ALREADY_PAID');
  return missing;
}

/** Lève une erreur structurée si les frais ne sont pas payables (contrôle backend). */
export function assertLaunchFeePayable(contract) {
  const missing = launchFeePayableIssues(contract);
  if (missing.length) {
    throw new ApiError(400, 'Les frais de lancement ne peuvent pas encore être réglés.', {
      code: LAUNCH_FEE_NOT_PAYABLE,
      missing,
    });
  }
}

// --- Projection Payment -> contrat ------------------------------------------

function mapPaymentToLaunchStatus(status) {
  switch (status) {
    case PAYMENT_STATUS.PENDING:
      return LAUNCH_FEE_STATUS.CHECKOUT_CREATED;
    case PAYMENT_STATUS.PROCESSING:
      return LAUNCH_FEE_STATUS.PROCESSING;
    case PAYMENT_STATUS.PAID:
      return LAUNCH_FEE_STATUS.PAID;
    case PAYMENT_STATUS.FAILED:
      return LAUNCH_FEE_STATUS.FAILED;
    case PAYMENT_STATUS.CANCELLED:
      return LAUNCH_FEE_STATUS.CANCELLED;
    case PAYMENT_STATUS.EXPIRED:
      return LAUNCH_FEE_STATUS.EXPIRED;
    case PAYMENT_STATUS.REFUNDED:
      return LAUNCH_FEE_STATUS.REFUNDED;
    default:
      return LAUNCH_FEE_STATUS.PENDING;
  }
}

/** Projette un Payment (frais de lancement) sur la vue métier du contrat. */
export function projectLaunchFee(contract, payment) {
  const lf = contract.stripe.launchFee;
  lf.paymentId = payment._id;
  lf.checkoutSessionId = payment.stripe?.checkoutSessionId || lf.checkoutSessionId;
  lf.paymentIntentId = payment.stripe?.paymentIntentId || lf.paymentIntentId;
  lf.status = mapPaymentToLaunchStatus(payment.status);
  lf.attempt = payment.attempt;
  lf.paidAt = payment.paidAt || lf.paidAt;
  lf.lastError = payment.lastError || null;
}

// --- Recherche de la tentative courante -------------------------------------

/** Tentative « ouverte » réutilisable (PENDING/PROCESSING), la plus récente. */
export function findOpenLaunchPayment(contractId) {
  return Payment.findOne({
    contractId,
    type: PAYMENT_TYPE.LAUNCH_FEE,
    status: { $in: PAYMENT_OPEN_STATUSES },
  }).sort({ createdAt: -1 });
}

/** Paiement des frais déjà réglé (au plus un par contrat). */
export function findPaidLaunchPayment(contractId) {
  return Payment.findOne({ contractId, type: PAYMENT_TYPE.LAUNCH_FEE, status: PAYMENT_STATUS.PAID });
}

/** Dernière tentative connue (tous statuts) — pour l'affichage/réconciliation. */
export function findLatestLaunchPayment(contractId) {
  return Payment.findOne({ contractId, type: PAYMENT_TYPE.LAUNCH_FEE }).sort({ createdAt: -1 });
}

/**
 * Résout le Payment (frais de lancement) rattaché à un événement Stripe, par ordre
 * de fiabilité : metadata.paymentId -> session -> PaymentIntent -> tentative ouverte.
 */
export async function findLaunchPaymentFor(contract, { paymentId, checkoutSessionId, paymentIntentId } = {}) {
  if (paymentId) {
    const byId = await Payment.findById(paymentId).catch(() => null);
    if (byId) return byId;
  }
  if (checkoutSessionId) {
    const byCs = await Payment.findOne({ 'stripe.checkoutSessionId': checkoutSessionId });
    if (byCs) return byCs;
  }
  if (paymentIntentId) {
    const byPi = await Payment.findOne({ 'stripe.paymentIntentId': paymentIntentId });
    if (byPi) return byPi;
  }
  return findOpenLaunchPayment(contract._id);
}

/**
 * Crée un Payment « de rattrapage » quand un événement Stripe légitime référence
 * un paiement de frais dont aucune tentative n'est connue (rare : webhook reçu
 * avant persistance, ou données pré-existantes). Le journal reste cohérent.
 */
export async function backfillLaunchPayment(contract, { mode, checkoutSessionId, paymentIntentId, customerId } = {}) {
  const fee = contract.pricing.launchFee;
  return Payment.create({
    contractId: contract._id,
    provider: 'STRIPE',
    providerMode: mode || 'TEST',
    applicationEnvironment: config.env,
    environment: config.env,
    type: PAYMENT_TYPE.LAUNCH_FEE,
    status: PAYMENT_STATUS.PENDING,
    amountExcludingTax: fee.amountExcludingTax,
    taxAmount: fee.taxAmount,
    amountIncludingTax: fee.amountIncludingTax,
    currency: fee.currency || 'EUR',
    contractVersion: contract.signatureConfiguration?.version || 0,
    attempt: (contract.stripe.launchFee.attempt || 0) + 1,
    stripe: {
      checkoutSessionId: checkoutSessionId || null,
      paymentIntentId: paymentIntentId || null,
      customerId: customerId || null,
    },
  });
}

// --- Création / réutilisation de la Checkout Session ------------------------

/**
 * Clé d'idempotence STABLE par tentative : (contrat, version verrouillée, n° de
 * tentative, mode). Un double clic sur la MÊME tentative renvoie la même session
 * Stripe ; une nouvelle tentative (après expiration/échec) porte un n° distinct.
 */
function buildIdempotencyKey(contract, mode, attempt) {
  const version = contract.signatureConfiguration?.version || 0;
  return `launch-${contract._id}-v${version}-a${attempt}-${mode}`;
}

function actorTypeOf(actor) {
  if (!actor) return AUDIT_ACTOR_TYPE.SYSTEM;
  if (actor.role === 'DEV') return AUDIT_ACTOR_TYPE.DEV;
  return AUDIT_ACTOR_TYPE.ADMIN;
}

/**
 * Crée — ou REPREND — la session de paiement des frais de lancement.
 *
 * Depuis L6.2B, les deux gestes sont le MÊME appel au Panel : `operationId`
 * identifie l'acte, et le Panel décide s'il ouvre ou s'il retrouve. Le projet
 * ne parle plus à Stripe sur ce chemin, et n'a donc plus à arbitrer.
 *
 *  · tentative ouverte encore valable  → la même URL, `reused: true` ;
 *  · déjà payée                        → réconciliation, aucune URL ;
 *  · expirée                           → tentative suivante, clé suivante.
 *
 * `provider` reste injecté : il ne sert plus au paiement des frais, mais la
 * signature est publique et ses appelants la passent encore.
 * Retourne { payment, url, reused }.
 */
export async function createOrReuseLaunchCheckout(contract, { successUrl, cancelUrl }, actor) {
  assertLaunchFeePayable(contract);
  // L2 — le monde vient du runtime. Une nouvelle opération porte donc
  // TOUJOURS `providerMode === environment`.
  const mode = resolveProviderEnvironment('STRIPE');

  // Réutilisation d'une tentative ouverte encore valide.
  /**
   * ── LA TENTATIVE OUVERTE EST RELUE PAR LE PANEL, PLUS LOCALEMENT (L6.2B) ───
   *
   * Ce bloc appelait `provider.retrieveCheckoutSession()` avec la clé Stripe du
   * PROJET, pour décider si la session en cours était encore ouverte, déjà
   * payée, ou expirée. Depuis que la session est créée par le Panel, avec SA
   * clé, cette lecture interroge potentiellement un autre compte — et une
   * lecture qui ne trouve rien ne dit PAS que la session n'existe pas.
   *
   * Le défaut n'était pas théorique : le silence tombait dans un `catch` qui
   * ouvrait une NOUVELLE tentative, donc une seconde session Stripe, pendant
   * que la première restait ouverte à côté.
   *
   * On redemande donc le MÊME acte — même `operationId` — au Panel. Il retrouve
   * la session par son registre de liens, la relit avec la clé qui l'a créée,
   * et rend son état réel. Rien n'est créé : le lien existe déjà.
   *
   * Ce n'est PAS l'ouverture d'une capacité de lecture au projet : c'est le même
   * verbe « ouvrir ou reprendre » qu'il demandait déjà, et c'est le Panel qui
   * lit, chez lui, ce qui lui appartient.
   */
  const open = await findOpenLaunchPayment(contract._id);
  if (open && open.stripe?.checkoutSessionId && open.idempotencyKey) {
    const reprise = await createLaunchCheckoutViaPanel({
      contract,
      successUrl,
      cancelUrl,
      operationId: open.idempotencyKey,
      paymentRef: open._id,
    });

    // Le verdict métier ne change pas : mêmes états, mêmes conséquences.
    const session = {
      status: reprise.status,
      payment_status: reprise.paymentStatus,
      payment_intent: reprise.paymentIntentId,
      customer: reprise.customerId,
    };

    if (reprise.status === 'open' && reprise.url) {
      return { payment: open, url: reprise.url, reused: true };
    }
    if (reprise.paymentStatus === 'paid' || reprise.status === 'complete') {
      await settleFromSession(contract, open, session, { actor });
      return { payment: open, url: null, reused: true, alreadyPaid: true };
    }
    if (reprise.status === 'expired') {
      await markExpired(contract, open, { actor });
    }
  }

  const fee = contract.pricing.launchFee;
  const attempt = (contract.stripe.launchFee.attempt || 0) + 1;
  const idempotencyKey = buildIdempotencyKey(contract, mode, attempt);

  const payment = await Payment.create({
    contractId: contract._id,
    provider: 'STRIPE',
    providerMode: mode,
    applicationEnvironment: config.env,
    environment: config.env,
    type: PAYMENT_TYPE.LAUNCH_FEE,
    status: PAYMENT_STATUS.PENDING,
    amountExcludingTax: fee.amountExcludingTax,
    taxAmount: fee.taxAmount,
    amountIncludingTax: fee.amountIncludingTax,
    currency: fee.currency || 'EUR',
    contractVersion: contract.signatureConfiguration?.version || 0,
    attempt,
    idempotencyKey,
  });

  /**
   * L'OUVERTURE PASSE PAR LE PANEL — et par lui seul (L6.2B).
   *
   * `customerId` n'est plus transmis : un client Stripe créé avec la clé du
   * projet n'existe pas nécessairement sur le compte du Panel, et l'y
   * référencer ferait échouer la session au pire moment. Checkout collecte
   * l'adresse lui-même, et `invoice_creation` continue d'émettre une vraie
   * facture — c'est le Panel qui la demande, avec les mêmes metadata.
   */
  const session = await createLaunchCheckoutViaPanel({
    contract,
    successUrl,
    cancelUrl,
    operationId: idempotencyKey,
    paymentRef: payment._id,
  });

  try {
    payment.stripe.checkoutSessionId = session.checkoutSessionId;
    payment.stripe.customerId = contract.stripe.customerId || null;
    payment.stripe.sessionStatus = session.status || 'open';
    await payment.save();
  } catch (e) {
    // Concurrence : une autre requête a déjà rattaché cette session (index unique).
    if (e.code === 11000) {
      await Payment.deleteOne({ _id: payment._id, status: PAYMENT_STATUS.PENDING });
      const winner = await Payment.findOne({ 'stripe.checkoutSessionId': session.checkoutSessionId });
      if (winner) return { payment: winner, url: session.url, reused: true };
    }
    throw e;
  }

  contract.stripe.launchFee.attempt = attempt;
  projectLaunchFee(contract, payment);
  await contract.save();

  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CHECKOUT_CREATED,
    actorType: actorTypeOf(actor),
    actorId: actor?._id || null,
    provider: 'STRIPE',
    metadataSafe: { type: 'LAUNCH_FEE', attempt, mode },
  });

  return { payment, url: session.url, reused: false };
}

// --- Mutateurs d'état (webhook + réconciliation) ----------------------------

function isTerminal(payment) {
  return PAYMENT_TERMINAL_STATUSES.includes(payment.status);
}

async function auditContract(contract, action, { actor, meta } = {}) {
  await logContractAudit({
    contractId: contract._id,
    action,
    actorType: actor ? actorTypeOf(actor) : AUDIT_ACTOR_TYPE.WEBHOOK,
    actorId: actor?._id || null,
    provider: 'STRIPE',
    metadataSafe: { type: 'LAUNCH_FEE', ...(meta || {}) },
  });
}

/** Marque le paiement PAYÉ (confirmation bancaire). Idempotent. */
export async function markPaid(contract, payment, { paymentIntentId, customerId, actor } = {}) {
  if (paymentIntentId) payment.stripe.paymentIntentId = paymentIntentId;
  if (customerId) payment.stripe.customerId = customerId;
  if (payment.status === PAYMENT_STATUS.PAID) {
    // Déjà payé : on met à jour les réfs sans réémettre d'événement.
    await payment.save();
    projectLaunchFee(contract, payment);
    await contract.save();
    return { changed: false };
  }
  payment.status = PAYMENT_STATUS.PAID;
  payment.paidAt = payment.paidAt || new Date();
  payment.lastError = null;
  payment.stripe.paymentStatus = 'paid';
  if (paymentIntentId) payment.externalPaymentId = paymentIntentId;
  await payment.save();
  projectLaunchFee(contract, payment);
  if (customerId) contract.stripe.customerId = customerId || contract.stripe.customerId;
  await contract.save();
  await auditContract(contract, CONTRACT_AUDIT_ACTION.PAYMENT_SUCCEEDED, { actor });

  /**
   * ÉVÉNEMENT MÉTIER — APRÈS l'encaissement acté, en best-effort.
   *
   * ── POURQUOI ICI, ET PAS DANS LE WEBHOOK ─────────────────────────────────
   * Deux chemins mènent à « payé » : le webhook Stripe et la réconciliation
   * serveur. Émettre dans le webhook aurait laissé le second silencieux — donc
   * un client réconcilié après un webhook perdu n'aurait jamais eu son message.
   * `markPaid` est le seul point que les deux traversent.
   *
   * ── POURQUOI SEULEMENT QUAND `changed` ───────────────────────────────────
   * Le retour anticipé au-dessus (`status === PAID`) sort AVANT cette ligne :
   * un webhook rejoué met à jour ses références et ne réémet rien. C'est la
   * première des deux gardes d'idempotence ; la clé ci-dessous est la seconde,
   * et elle tient même si deux processus passent ici en même temps.
   *
   * ── POURQUOI `emitAndDispatch` ET NON `emitSafe` ─────────────────────────
   * `emitSafe` PERSISTE le fait sans le dispatcher : aucune exécution d'action
   * n'est matérialisée, et `processPendingEventActions` — qui ne reprend que
   * des exécutions EXISTANTES — n'a alors rien à reprendre. Le message
   * attendrait le prochain dispatch de CET événement, c'est-à-dire jamais.
   *
   * C'est le piège de ce couplage : le fait est bien en base, le registre est
   * bien câblé, et pourtant personne ne reçoit rien. Un client qui vient de
   * payer doit être confirmé tout de suite.
   *
   * Ni l'une ni l'autre n'échoue vers l'appelant : un journal qui hoquette ne
   * doit pas faire échouer un paiement déjà encaissé chez le fournisseur.
   */
  await emitAndDispatch({
    type: 'launch_fee.paid',
    entityType: 'Contract',
    entityId: contract._id,
    actor: actor
      ? { type: EVENT_ACTOR_TYPE.USER, id: actor._id, role: actor.role }
      : { type: EVENT_ACTOR_TYPE.SYSTEM },
    payloadSafe: {
      reference: contract.reference || '',
      amountIncludingTax: payment.amountIncludingTax ?? 0,
      currency: payment.currency || 'EUR',
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
    },
    /**
     * UN SEUL FAIT PAR PAIEMENT — jamais par tentative, jamais par livraison.
     * L'index unique de la clé tranche les courses : deux webhooks simultanés
     * produisent un événement, donc un e-mail.
     */
    idempotencyKey: `launch-fee-paid:${payment._id}`,
  });

  return { changed: true };
}

/** Marque le paiement EN COURS (paiement asynchrone non encore confirmé). */
export async function markProcessing(contract, payment, { paymentIntentId, actor } = {}) {
  if (paymentIntentId) payment.stripe.paymentIntentId = paymentIntentId;
  if (isTerminal(payment) || payment.status === PAYMENT_STATUS.PROCESSING) {
    await payment.save();
    projectLaunchFee(contract, payment);
    await contract.save();
    return { changed: false };
  }
  payment.status = PAYMENT_STATUS.PROCESSING;
  payment.stripe.paymentStatus = 'unpaid';
  await payment.save();
  projectLaunchFee(contract, payment);
  await contract.save();
  await auditContract(contract, CONTRACT_AUDIT_ACTION.PAYMENT_PROCESSING, { actor });
  return { changed: true };
}

/** Marque le paiement ÉCHOUÉ (refus bancaire). */
export async function markFailed(contract, payment, { reason, paymentIntentId, actor } = {}) {
  if (paymentIntentId) payment.stripe.paymentIntentId = paymentIntentId;
  if (isTerminal(payment)) {
    await payment.save();
    return { changed: false };
  }
  payment.status = PAYMENT_STATUS.FAILED;
  payment.failedAt = new Date();
  payment.lastError = reason ? String(reason).slice(0, 300) : 'payment_failed';
  await payment.save();
  projectLaunchFee(contract, payment);
  await contract.save();
  await auditContract(contract, CONTRACT_AUDIT_ACTION.PAYMENT_FAILED, { actor, meta: { reason: payment.lastError } });
  return { changed: true };
}

/** Marque la tentative EXPIRÉE (session Stripe expirée : abandon, non bancaire). */
export async function markExpired(contract, payment, { actor } = {}) {
  if (isTerminal(payment) || payment.status === PAYMENT_STATUS.EXPIRED) return { changed: false };
  payment.status = PAYMENT_STATUS.EXPIRED;
  payment.cancelledAt = new Date();
  payment.stripe.sessionStatus = 'expired';
  await payment.save();
  projectLaunchFee(contract, payment);
  await contract.save();
  await auditContract(contract, CONTRACT_AUDIT_ACTION.PAYMENT_CANCELLED, { actor, meta: { reason: 'expired' } });
  return { changed: true };
}

/** Marque le paiement REMBOURSÉ (charge.refunded). */
export async function markRefunded(contract, payment, { actor } = {}) {
  if (payment.status === PAYMENT_STATUS.REFUNDED) return { changed: false };
  payment.status = PAYMENT_STATUS.REFUNDED;
  payment.refundedAt = new Date();
  await payment.save();
  projectLaunchFee(contract, payment);
  await contract.save();
  // La conséquence contractuelle d'un remboursement (désactivation, etc.) sera
  // définie dans un lot ultérieur (documenté). Ici : projection + trace seulement.
  await auditContract(contract, CONTRACT_AUDIT_ACTION.PAYMENT_REFUNDED, { actor });
  return { changed: true };
}

/**
 * Applique l'état d'une Checkout Session (retour de réconciliation ou événement
 * `checkout.session.*`) au paiement : payé / en cours / expiré.
 */
export async function settleFromSession(contract, payment, session, { actor } = {}) {
  const piRef = session.payment_intent;
  const paymentIntentId = typeof piRef === 'string' ? piRef : piRef?.id || null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
  payment.stripe.sessionStatus = session.status || payment.stripe.sessionStatus;
  if (session.payment_status) payment.stripe.paymentStatus = session.payment_status;

  if (session.payment_status === 'paid') {
    return markPaid(contract, payment, { paymentIntentId, customerId, actor });
  }
  if (session.status === 'expired') {
    return markExpired(contract, payment, { actor });
  }
  // Session complétée mais paiement pas encore acquitté -> asynchrone en cours.
  if (session.status === 'complete') {
    return markProcessing(contract, payment, { paymentIntentId, actor });
  }
  await payment.save();
  return { changed: false };
}

/** Applique l'état d'un PaymentIntent (événement `payment_intent.*` / réconciliation). */
export async function settleFromPaymentIntent(contract, payment, pi, { actor } = {}) {
  const customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
  if (pi.status === 'succeeded') return markPaid(contract, payment, { paymentIntentId: pi.id, customerId, actor });
  if (pi.status === 'processing') return markProcessing(contract, payment, { paymentIntentId: pi.id, actor });
  if (['requires_payment_method', 'canceled'].includes(pi.status)) {
    const reason = pi.last_payment_error?.message || (pi.status === 'canceled' ? 'canceled' : 'requires_payment_method');
    return markFailed(contract, payment, { reason, paymentIntentId: pi.id, actor });
  }
  return { changed: false };
}

// --- Réconciliation (filet de sécurité) -------------------------------------

/**
 * Réconcilie les frais de lancement d'UN contrat en interrogeant Stripe (session
 * + PaymentIntent). Idempotente ; ne crée JAMAIS de paiement. Renvoie les
 * changements appliqués.
 */
export async function reconcileLaunchFeePayment(contract, { actor } = {}) {
  const payment = await findOpenLaunchPayment(contract._id) || await findLatestLaunchPayment(contract._id);
  if (!payment || isTerminal(payment)) return { changes: [] };
  const changes = [];
  try {
    if (payment.stripe?.checkoutSessionId) {
      /**
       * ── LA LECTURE PASSE PAR LE PANEL (L6.2C) ─────────────────────────────
       *
       * C'était le DERNIER appel du parcours de frais qui touchait encore
       * Stripe avec la clé du projet. Il était aussi le plus trompeur : depuis
       * que la session est créée par le Panel, la lire avec la clé locale
       * interroge potentiellement un autre compte — et ne rien y trouver ne dit
       * pas que la session n'existe pas, cela dit qu'on a demandé au mauvais
       * endroit.
       *
       * Le Panel vérifie d'abord que la session est bien à ce projet, puis la
       * lit avec la clé qui l'a créée. `operationId` identifie la LECTURE : il
       * dérive de la tentative, donc deux réconciliations d'un même paiement
       * portent la même identité.
       *
       * Le verdict métier ne change pas : `settleFromSession` reçoit exactement
       * les mêmes champs qu'avant, sous les mêmes noms.
       */
      const vue = await readCheckoutViaPanel({
        checkoutSessionId: payment.stripe.checkoutSessionId,
        operationId: payment.idempotencyKey || `reconcile-${payment._id}`,
      });
      const session = {
        status: vue.status,
        payment_status: vue.paymentStatus,
        payment_intent: vue.paymentIntentId,
        customer: vue.customerId,
      };
      const before = payment.status;
      await settleFromSession(contract, payment, session, { actor });
      if (payment.status !== before) changes.push(`launchFee:${payment.status}`);
    }
    /**
     * ── L6.3C — IL N'Y A PLUS DE SECONDE BRANCHE ──────────────────────────
     *
     * Une branche relisait l'INTENTION DE PAIEMENT chez Stripe quand le
     * paiement n'était connu que par un `pi_…`, sans session. C'était le
     * dernier appel Stripe métier du projet, et donc le dernier verrou avant
     * le retrait de sa clé.
     *
     * Elle a été retirée, et non remplacée par une capacité. La raison n'est
     * pas la commodité :
     *
     *   · un `pi_…` seul ne prouve RIEN. Le Panel ne possède une intention que
     *     par filiation depuis une session ou un abonnement possédé (L10.4).
     *     Or ce chemin-ci part précisément d'un paiement SANS session — donc
     *     d'une intention que le Panel ne peut pas rattacher. Une capacité
     *     construite là-dessus aurait refusé exactement quand on l'appelle ;
     *
     *   · l'information arrive DÉJÀ. Un paiement sans session n'est connu que
     *     parce qu'un événement `payment_intent.*` l'a révélé — et cet
     *     événement porte l'objet complet, que `settleFromPaymentIntent`
     *     applique à la réception. Relire ensuite ne servait qu'au cas où ce
     *     même événement aurait été perdu, sur un paiement qui n'existe que
     *     grâce à lui.
     *
     * CE QUI EST PERDU, ET IL FAUT LE DIRE : un paiement de frais SANS session
     * dont l'événement Stripe se perdrait définitivement ne se réconcilie plus
     * seul. Stripe rejoue ses webhooks pendant trois jours ; au-delà, il faut
     * un arbitrage humain. Le rapport L6.3C le documente comme réserve, plutôt
     * que de garder une clé d'API pour un cas que rien ne peut plus autoriser
     * proprement.
     */
  } catch {
    /**
     * Panel ou Stripe indisponible, ou session non reconnue comme nôtre :
     * réessai au prochain passage. Une réconciliation est un FILET, pas une
     * autorité — elle n'a jamais eu le droit de conclure sur un silence, et ce
     * n'est pas ce lot qui va le lui donner.
     */
  }
  return { changes };
}

// --- Vue de statut (ADMIN) --------------------------------------------------

/** Statut public des frais de lancement (aucune donnée Stripe sensible). */
export async function getLaunchFeeStatus(contract) {
  const fee = contract.pricing?.launchFee;
  const required = sm.launchFeeRequired(contract);
  const lf = contract.stripe?.launchFee || {};
  const payment = await findLatestLaunchPayment(contract._id);
  return {
    required,
    status: required ? lf.status || LAUNCH_FEE_STATUS.PENDING : LAUNCH_FEE_STATUS.NOT_REQUIRED,
    paidAt: lf.paidAt || null,
    amount: {
      excludingTax: fee?.amountExcludingTax || 0,
      tax: fee?.taxAmount || 0,
      includingTax: fee?.amountIncludingTax || 0,
      currency: fee?.currency || 'EUR',
    },
    attempt: lf.attempt || 0,
    lastError: lf.lastError || null,
    hasOpenCheckout: Boolean(payment && PAYMENT_OPEN_STATUSES.includes(payment.status)),
  };
}
