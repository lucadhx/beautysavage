import { monthlyEquivalentCents } from '../utils/money.js';
import { recurrenceOf, describeRecurrence } from '../utils/subscriptionRecurrence.js';
import { Payment } from '../models/Payment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { resolveProviderEnvironment } from './integratedApiEnvironment.js';
import { logContractAudit } from '../models/ContractAuditLog.model.js';
import { logger } from '../utils/logger.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { EVENT_ACTOR_TYPE } from '../utils/domainEventConstants.js';
import { mapSubscriptionStatus } from './stripe/stripe.service.js';
import { openBillingPortalViaPanel, readInvoiceViaPanel } from './stripe/checkoutCapability.js';
import { ensureCustomerViaPanel } from './stripe/customerCapability.js';
import {
  createSubscriptionCheckoutViaPanel,
  readCheckoutViaPanel,
  readSubscriptionViaPanel,
} from './stripe/checkoutCapability.js';
import { reconcileSiteStatus } from './siteEnforcement.service.js';
import * as sm from './contractStateMachine.js';
import {
  CONTRACT_STATUS as S,
  PAYMENT_TYPE,
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_ENTITLED_STATUSES,
  SUBSCRIPTION_TERMINAL_STATUSES,
  AUDIT_ACTOR_TYPE,
  CONTRACT_AUDIT_ACTION,
} from '../utils/contractConstants.js';

/**
 * Abonnement Stripe (mensuel, récurrent). Source de vérité = Stripe (webhooks) +
 * réconciliation ; `contract.stripe.subscription` en est la PROJECTION lisible. La
 * confirmation « actif » ne vient JAMAIS d'une redirection navigateur. Montants en
 * CENTIMES, issus du snapshot contractuel VERROUILLÉ (jamais du frontend).
 *
 * Product/Price Stripe : IMMUABLES par version de contrat (voir §Product/Price).
 * Le site ne s'active PAS automatiquement au webhook : l'activation finale reste
 * une action ADMIN explicite (voir contract.service.activateContract).
 */

export const SUBSCRIPTION_NOT_PAYABLE = 'SUBSCRIPTION_NOT_PAYABLE';

// --- Conditions d'accès (contrôle serveur) ----------------------------------

/**
 * Raisons empêchant de souscrire l'abonnement (vide = OK). Codes stables :
 * CONTRACT_NOT_FULLY_SIGNED, LAUNCH_FEE_NOT_PAID, SUBSCRIPTION_NOT_CONFIGURED,
 * SUBSCRIPTION_ALREADY_ACTIVE. (Stripe prêt vérifié à part via assertProviderReady.)
 */
export function subscriptionPayableIssues(contract) {
  const missing = [];
  if (!sm.signatureSatisfied(contract)) missing.push('CONTRACT_NOT_FULLY_SIGNED');
  if (sm.launchFeeRequired(contract) && !sm.launchFeeSatisfied(contract)) missing.push('LAUNCH_FEE_NOT_PAID');
  const sub = contract?.pricing?.subscription;
  if (!sub?.enabled || !(sub.amountIncludingTax > 0)) missing.push('SUBSCRIPTION_NOT_CONFIGURED');
  const st = contract?.stripe?.subscription?.status;
  if (SUBSCRIPTION_ENTITLED_STATUSES.includes(st)) missing.push('SUBSCRIPTION_ALREADY_ACTIVE');
  return missing;
}

export function assertSubscriptionPayable(contract) {
  const missing = subscriptionPayableIssues(contract);
  if (missing.length) {
    throw new ApiError(400, "L'abonnement ne peut pas encore être souscrit.", {
      code: SUBSCRIPTION_NOT_PAYABLE,
      missing,
    });
  }
}

// --- Customer / Product / Price (idempotents, immuables par version) ---------

function clientEmail(contract) {
  const signer = (contract.signatureConfiguration?.signers || []).find((s) => s.role === 'CLIENT');
  return signer?.email || '';
}

/**
 * ── LE CLIENT ET LE TARIF NE SE FABRIQUENT PLUS ICI (L6.2E) ─────────────────
 *
 * `ensureCustomer` (migrée en L6.2D) et `ensureProductAndPrice` vivaient toutes
 * deux à cet endroit. Elles n'ont plus d'appelant : le Panel garantit le client
 * ET le tarif avant de composer la session d'abonnement, avec sa clé, et lie les
 * trois ressources.
 *
 * Elles sont SUPPRIMÉES, pas laissées en place. Un constructeur inutilisé est le
 * repli du prochain incident : il suffirait d'un appel oublié pour que des
 * objets Stripe repartent sur l'ancien compte, sans que rien ne le signale —
 * même raison qu'au retrait du pilote Brevo local (L8.2), du repli DNS (L9.2) et
 * du constructeur de frais (L6.2B).
 *
 * ── CE QUE CELA CHANGE POUR LE JOURNAL LOCAL ────────────────────────────────
 *
 * `contract.stripe.subscription.productId` et `.priceId` ne sont plus écrits :
 * le projet ne possède plus ces ressources. Les valeurs déjà enregistrées ne
 * sont PAS effacées, et la vue de support du DEV continue de les afficher pour
 * les contrats antérieurs. `contract.stripe.customerId`, lui, reste renseigné —
 * la facturation locale le relit (`billing.service.js`).
 */

// --- Projection Stripe -> contrat ---// --- Projection Stripe -> contrat -------------------------------------------

function toDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function actorTypeOf(actor) {
  if (!actor) return AUDIT_ACTOR_TYPE.WEBHOOK;
  if (actor.role === 'DEV') return AUDIT_ACTOR_TYPE.DEV;
  return AUDIT_ACTOR_TYPE.ADMIN;
}

/**
 * L'OBSERVATION EST-ELLE PLUS ANCIENNE QUE CELLE DÉJÀ APPLIQUÉE ?
 *
 * ══ CE QU'ON COMPARE, ET CE QU'ON NE COMPARE PAS ════════════════════════════
 *
 * On compare la date à laquelle chaque instantané a été PRODUIT chez le
 * fournisseur — jamais l'ordre dans lequel nos serveurs les ont reçus. Les deux
 * divergent réellement : le 21 août, `customer.subscription.created` est arrivé
 * APRÈS `invoice.paid` tout en décrivant un état ANTÉRIEUR à lui.
 *
 * ══ POURQUOI `<` STRICT, ET NON `<=` ════════════════════════════════════════
 *
 * `evt.created` est à la SECONDE. Quatre annonces d'un même règlement tombent
 * donc régulièrement dans la même seconde, et les départager par leur horodatage
 * serait tirer à pile ou face. À égalité, on laisse passer : c'est la garde
 * métier de `settleFromSubscription` — « incomplete » ne défait pas une facture
 * payée — qui tranche ces cas-là, et elle tranche sur une PREUVE, pas sur une
 * horloge.
 */
function observationPerimee(s, observedAt) {
  if (!observedAt) return false;
  const applique = s.statusObservedAt ? new Date(s.statusObservedAt).getTime() : null;
  if (!applique) return false;
  return new Date(observedAt).getTime() < applique;
}

/**
 * Projette un objet Subscription Stripe sur la vue métier du contrat (sans save).
 *
 * `observedAt` est l'instant où le fournisseur a produit cet instantané :
 * `evt.created` pour un webhook, « maintenant » pour une lecture directe. Une
 * observation périmée n'écrit NI le statut, NI la période, NI la résiliation —
 * les trois décrivent le même instant et se déduisent l'un l'autre.
 *
 * Les identités (`subscriptionId`, `latestInvoiceId`, `customerId`) sont
 * écrites DANS TOUS LES CAS : elles ne décrivent pas un état qui régresse, elles
 * nomment des objets. Un instantané ancien qui nous apprend l'identifiant d'un
 * abonnement nous l'apprend quand même — c'est même souvent la seule annonce à
 * le porter.
 *
 * `identitiesOnly` dit ce refus EXPLICITEMENT, pour l'appelant qui a déjà
 * prouvé la péremption autrement que par l'horloge.
 */
export function projectSubscription(contract, stripeSub, { observedAt = null, identitiesOnly = false } = {}) {
  const s = contract.stripe.subscription;
  s.subscriptionId = stripeSub.id || s.subscriptionId;
  if (stripeSub.latest_invoice) {
    s.latestInvoiceId = typeof stripeSub.latest_invoice === 'string' ? stripeSub.latest_invoice : stripeSub.latest_invoice.id;
  }
  if (stripeSub.customer) {
    contract.stripe.customerId = (typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id) || contract.stripe.customerId;
  }

  if (identitiesOnly || observationPerimee(s, observedAt)) return { applied: false };

  const cancelAtPeriodEnd = Boolean(stripeSub.cancel_at_period_end);
  s.status = mapSubscriptionStatus(stripeSub.status, { cancelAtPeriodEnd });
  s.currentPeriodStart = toDate(stripeSub.current_period_start) || s.currentPeriodStart;
  s.currentPeriodEnd = toDate(stripeSub.current_period_end) || s.currentPeriodEnd;
  s.cancelAtPeriodEnd = cancelAtPeriodEnd;
  if (observedAt) s.statusObservedAt = new Date(observedAt);
  return { applied: true };
}

async function audit(contract, action, { actor, meta } = {}) {
  await logContractAudit({
    contractId: contract._id,
    action,
    actorType: actorTypeOf(actor),
    actorId: actor?._id || null,
    provider: 'STRIPE',
    metadataSafe: meta || {},
  });
}

/**
 * LA FACTURE DE CET INSTANTANÉ A-T-ELLE DÉJÀ ÉTÉ ENCAISSÉE CHEZ NOUS ?
 *
 * ══ POURQUOI CETTE QUESTION SUFFIT À TRANCHER ═══════════════════════════════
 *
 * Chez Stripe, `incomplete` a UN sens et un seul : « la première facture de cet
 * abonnement n'est pas réglée ». Si nous détenons un règlement PAYÉ portant
 * exactement cette facture, l'instantané ne décrit pas un autre état du monde —
 * il décrit un état RÉVOLU du même. Le refuser n'est pas une préférence pour la
 * bonne nouvelle : c'est refuser une information dont on sait qu'elle est
 * périmée, sur la foi d'une écriture qu'on a nous-mêmes constatée.
 *
 * ══ POURQUOI CETTE GARDE EN PLUS DE L'HORODATAGE ════════════════════════════
 *
 * `evt.created` est à la seconde, et les quatre annonces d'un premier
 * règlement tombent dans la même. L'horloge ne les départage pas ; cette
 * preuve-ci le fait, et elle ne dépend d'aucune horloge.
 *
 * Aucun autre statut n'est protégé : `past_due`, `unpaid`, `canceled` décrivent
 * des faits POSTÉRIEURS à un encaissement et doivent pouvoir s'appliquer.
 */
async function factureDejaEncaissee(contract, invoiceId) {
  if (!invoiceId) return false;
  const regle = await Payment.findOne({
    contractId: contract._id,
    type: PAYMENT_TYPE.SUBSCRIPTION,
    externalInvoiceId: invoiceId,
    status: PAYMENT_STATUS.PAID,
  }).select('_id').lean();
  return Boolean(regle);
}

/**
 * Applique l'état d'un objet Subscription Stripe au contrat (idempotent) :
 * projection, transitions d'audit (activation, fin), et — À LA FIN EFFECTIVE
 * uniquement — passage du contrat en ENDED + suspension automatique du site.
 * Ne déclenche JAMAIS l'activation du site (action ADMIN explicite).
 *
 * `observedAt` — voir `projectSubscription`. Absent, l'instantané est réputé
 * frais : c'est le cas des lectures directes et des appels d'outillage.
 */
export async function settleFromSubscription(contract, stripeSub, { actor, observedAt = null } = {}) {
  const previous = contract.stripe.subscription.status;

  /**
   * LA RÉGRESSION QUI A BLOQUÉ UN CONTRAT PAYÉ — refusée ici, et journalisée.
   *
   * On ne se contente pas d'ignorer le statut : on projette quand même le
   * reste (identités, période), parce que l'instantané ancien reste porteur
   * d'informations qui ne régressent pas.
   */
  const entrant = mapSubscriptionStatus(stripeSub.status, {
    cancelAtPeriodEnd: Boolean(stripeSub.cancel_at_period_end),
  });
  if (entrant === SUBSCRIPTION_STATUS.INCOMPLETE
      && SUBSCRIPTION_ENTITLED_STATUSES.includes(previous)) {
    const facture = typeof stripeSub.latest_invoice === 'string'
      ? stripeSub.latest_invoice
      : stripeSub.latest_invoice?.id || contract.stripe.subscription.latestInvoiceId;
    if (await factureDejaEncaissee(contract, facture)) {
      logger.warn(
        `[stripe] instantané d'abonnement PÉRIMÉ ignoré pour ${contract.reference || contract._id} : `
        + `« incomplete » annoncé alors que la facture ${facture} est encaissée. `
        + `L'abonnement reste ${previous}.`,
      );
      /**
       * L'instantané est refusé pour son ÉTAT, pas pour ses identités : on le
       * projette avec une observation volontairement « périmée », ce qui écrit
       * `subscriptionId` / `latestInvoiceId` / `customerId` et rien d'autre.
       */
      projectSubscription(contract, stripeSub, { identitiesOnly: true });
      await contract.save();
      return { changed: false, status: previous, staleIgnored: true };
    }
  }

  projectSubscription(contract, stripeSub, { observedAt });
  const next = contract.stripe.subscription.status;

  // Première activation confirmée (jamais d'activation de site ici).
  if (SUBSCRIPTION_ENTITLED_STATUSES.includes(next) && !SUBSCRIPTION_ENTITLED_STATUSES.includes(previous) && next !== SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END) {
    await audit(contract, CONTRACT_AUDIT_ACTION.SUBSCRIPTION_ACTIVATED, { actor });
  }

  // Fin EFFECTIVE de l'abonnement (Stripe `canceled`/ENDED) : entitlement retiré,
  // contrat terminé, site suspendu automatiquement — jamais avant.
  if (next === SUBSCRIPTION_STATUS.ENDED) {
    contract.stripe.subscription.endedAt = contract.stripe.subscription.endedAt || new Date();
    if ([S.ACTIVE, S.CANCEL_AT_PERIOD_END].includes(contract.status)) {
      contract.status = sm.assertTransition(contract.status, S.ENDED);
      await audit(contract, CONTRACT_AUDIT_ACTION.CONTRACT_ENDED, { actor });
    }
    if (previous !== SUBSCRIPTION_STATUS.ENDED) {
      await audit(contract, CONTRACT_AUDIT_ACTION.SUBSCRIPTION_ENDED, { actor });
    }
    await contract.save();
    await reconcileSiteStatus({ actor }); // suspension automatique au titre du contrat
    return { changed: previous !== next, status: next };
  }

  /**
   * ── LE CONTRAT SUIT LA RÉSILIATION PROGRAMMÉE (LOT PORTAL) ───────────────
   *
   * ══ CE QUI MANQUAIT, ET CE QUE PERSONNE NE VOYAIT ══════════════════════
   *
   * Un client qui résiliait depuis le portail Stripe voyait bien son ABONNEMENT
   * passer en `CANCEL_AT_PERIOD_END` — la projection le faisait déjà. Mais le
   * CONTRAT restait `ACTIVE`, sans la moindre mention. Le Manager affichait donc
   * « Actif » sur un engagement dont Stripe avait planifié l'arrêt, et personne
   * — ni le client, ni l'exploitant — ne pouvait le savoir avant l'échéance.
   *
   * Le vocabulaire existait pourtant en entier : `S.CANCEL_AT_PERIOD_END` est
   * déclaré, la transition `ACTIVE → CANCEL_AT_PERIOD_END` est autorisée, le
   * statut figure dans `LIVE_CONTRACT_STATUSES`, et l'interface sait déjà le
   * peindre. Il ne manquait que le geste.
   *
   * ══ « RÉSILIATION PROGRAMMÉE » N'EST PAS « RÉSILIÉ » ═══════════════════
   *
   * Le contrat reste VIVANT : la période est payée, le site reste servi, et
   * `SUBSCRIPTION_ENTITLED_STATUSES` inclut délibérément
   * `CANCEL_AT_PERIOD_END`. La fin réelle n'arrive qu'avec `ENDED`, plus haut,
   * qui seul suspend le site. Basculer le contrat hors des statuts vivants dès
   * la programmation couperait un service que le client a déjà réglé.
   *
   * ══ ET LA MARCHE ARRIÈRE COMPTE AUTANT ════════════════════════════════
   *
   * Le portail permet d'annuler une résiliation programmée. La transition
   * inverse est déclarée elle aussi (« ACTIVE = reprise »), et sans elle le
   * contrat resterait marqué « résiliation programmée » pour toujours — un
   * client qui se ravise verrait son engagement continuer à annoncer sa fin.
   *
   * ══ POURQUOI SEULEMENT SI L'OBSERVATION A ÉTÉ APPLIQUÉE ═══════════════
   *
   * `projectSubscription` refuse les instantanés périmés — un webhook ancien
   * arrivé tard décrit un monde révolu. Le contrat ne doit pas suivre ce qu'on
   * vient de refuser : on ne bouge donc que sur `next`, qui est l'état
   * RÉELLEMENT retenu. Sans cette garde, un `updated(cancel=true)` en retard
   * reprogrammerait une résiliation que le client a déjà annulée.
   */
  const programmee = next === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END;
  const reprise = next === SUBSCRIPTION_STATUS.ACTIVE || next === SUBSCRIPTION_STATUS.TRIALING;

  if (programmee && contract.status === S.ACTIVE) {
    contract.status = sm.assertTransition(contract.status, S.CANCEL_AT_PERIOD_END);
    await audit(contract, CONTRACT_AUDIT_ACTION.CANCELLATION_REQUESTED, {
      actor,
      meta: {
        source: 'PROVIDER',
        effectiveAt: contract.stripe.subscription.currentPeriodEnd ?? null,
      },
    });
  } else if (reprise && contract.status === S.CANCEL_AT_PERIOD_END) {
    contract.status = sm.assertTransition(contract.status, S.ACTIVE);
    await audit(contract, CONTRACT_AUDIT_ACTION.CANCELLATION_REVOKED, {
      actor,
      meta: { source: 'PROVIDER' },
    });
  }

  await contract.save();
  return { changed: previous !== next, status: next };
}

/**
 * Applique une Checkout Session `mode: subscription` : vérifie le mode + la
 * présence de la Subscription, récupère son statut RÉEL et le projette (jamais
 * « actif » sur la seule foi de la session).
 */
export async function settleFromCheckoutSession(contract, session, { actor, observedAt = null } = {}) {
  if (session.mode && session.mode !== 'subscription') return { changed: false };
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null;
  contract.stripe.subscription.checkoutSessionId = session.id || contract.stripe.subscription.checkoutSessionId;
  if (session.customer) contract.stripe.customerId = (typeof session.customer === 'string' ? session.customer : session.customer.id) || contract.stripe.customerId;
  if (!subId) {
    if (contract.stripe.subscription.status === SUBSCRIPTION_STATUS.NONE || contract.stripe.subscription.status === SUBSCRIPTION_STATUS.PENDING) {
      contract.stripe.subscription.status = SUBSCRIPTION_STATUS.CHECKOUT_CREATED;
    }
    await contract.save();
    return { changed: false };
  }
  contract.stripe.subscription.subscriptionId = subId;
  try {
    /**
     * L6.2F — l'abonnement est lu par le PANEL, qui a prouvé qu'il nous
     * appartient avant d'interroger Stripe. Le lire avec la clé locale
     * interrogeait potentiellement un autre compte, et un échec n'aurait rien
     * appris : « introuvable » ne dit pas « n'existe pas ».
     */
    const stripeSub = await readSubscriptionViaPanel({
      subscriptionId: subId,
      operationId: `sub-read-${contract._id}-${subId}`,
    });
    /**
     * L'ABONNEMENT EST LU MAINTENANT, PAS RACONTÉ PAR LA SESSION.
     *
     * `observedAt` de la session ne s'applique donc PAS à cet instantané : il
     * vient d'être lu chez le fournisseur, il est frais par construction. Le
     * transmettre aurait daté une lecture d'aujourd'hui de l'heure d'un
     * événement d'hier — et fait refuser la plus fiable de nos observations.
     */
    return settleFromSubscription(contract, stripeSub, { actor, observedAt: new Date() });
  } catch {
    await contract.save();
    return { changed: false };
  }
}

/**
 * Enregistre un paiement de cycle (invoice.paid) + audit. Idempotence : par invoice.
 *
 * ══ LE POINT DE PASSAGE UNIQUE DU RÈGLEMENT D'ABONNEMENT ════════════════════
 *
 * Trois chemins mènent ici, et un seul d'entre eux est un webhook : le webhook
 * `invoice.paid`, la réconciliation (`reconcileAndDescribe`), et l'outillage de
 * rattrapage. C'est donc ICI que se pose l'événement métier — jamais dans le
 * webhook, qui laisserait les deux autres muets. C'est la leçon déjà tirée sur
 * les frais de lancement (`payment.service.markPaid`).
 */
export async function markInvoicePaid(contract, invoice, { actor, observedAt = null } = {}) {
  const mode = resolveProviderEnvironment('STRIPE');
  const existing = invoice.id ? await Payment.findOne({ contractId: contract._id, type: PAYMENT_TYPE.SUBSCRIPTION, externalInvoiceId: invoice.id }) : null;
  let paiement = existing;
  if (!existing) {
    const sub = contract.pricing.subscription;
    /**
     * ══ ZÉRO EST UN MONTANT, PAS UNE ABSENCE ═══════════════════════════════
     *
     * `invoice.amount_paid || invoice.total || sub.amountIncludingTax` : les
     * deux premiers termes sont FAUX quand la facture vaut zéro — période
     * d'essai, coupon à 100 %, avoir de proratisation. Le repli s'appliquait
     * donc et le paiement était enregistré au prix du CONTRAT.
     *
     * Mesuré en base le 22 août : une facture d'essai à 0,00 € enregistrée en
     * paiement de 1 007,86 € TTC. De l'argent qui n'est jamais entré, inscrit
     * au dossier d'un client.
     *
     * C'est la doctrine du lot financier, prise en défaut dans un coin : le
     * montant vient du FOURNISSEUR, jamais d'une formule tarifaire ni d'un
     * instantané contractuel. `??` distingue « absent » de « zéro » ; le
     * dernier repli reste `0`, parce qu'une facture sans montant lisible n'a
     * rien encaissé — et surtout pas le prix du contrat.
     */
    const ttc = invoice.amount_paid ?? invoice.total ?? 0;
    /**
     * LA VENTILATION SUIT LE MONTANT RÉEL. Reprendre le HT et la TVA du
     * contrat sur une facture de zéro produirait un paiement dont les trois
     * lignes ne s'additionnent pas — 839,88 + 167,98 = 1 007,86 pour un
     * encaissement nul. On ne ventile depuis le contrat que si le montant
     * encaissé est bien celui du contrat.
     */
    const memePrix = ttc === sub.amountIncludingTax;
    paiement = await Payment.create({
      contractId: contract._id,
      type: PAYMENT_TYPE.SUBSCRIPTION,
      status: PAYMENT_STATUS.PAID,
      providerMode: mode,
      applicationEnvironment: config.env,
      environment: config.env,
      amountExcludingTax: memePrix ? sub.amountExcludingTax : ttc,
      taxAmount: memePrix ? sub.taxAmount : 0,
      amountIncludingTax: ttc,
      currency: (invoice.currency || sub.currency || 'EUR').toUpperCase(),
      externalInvoiceId: invoice.id || null,
      paidAt: new Date(),
    });
    await audit(contract, CONTRACT_AUDIT_ACTION.SUBSCRIPTION_PAYMENT_SUCCEEDED, { actor });
  }
  if (invoice.id) contract.stripe.subscription.latestInvoiceId = invoice.id;
  /**
   * UNE FACTURE PAYÉE VAUT ABONNEMENT EN RÈGLE — d'où qu'on vienne.
   *
   * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────
   * La promotion était conditionnée au seul statut `PAST_DUE`. Depuis
   * `CHECKOUT_CREATED` — l'état normal juste après une première souscription —
   * `invoice.paid` enregistrait donc le règlement, posait la période, et
   * laissait le contrat bloqué à l'étape « abonnement à régler ». L'argent
   * était encaissé chez Stripe et tracé ici, mais le parcours ne repartait
   * jamais.
   *
   * Les statuts TERMINAUX sont exclus : une facture tardive ne ressuscite pas
   * un abonnement annulé ou clos.
   */
  if (!SUBSCRIPTION_TERMINAL_STATUSES.includes(contract.stripe.subscription.status)) {
    contract.stripe.subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
    contract.stripe.subscription.lastError = { code: null, message: null, at: null };
    /**
     * L'ENCAISSEMENT DATE L'ÉTAT QU'IL VIENT DE POSER.
     *
     * Sans cette ligne, la promotion en ACTIVE n'aurait aucune date
     * d'observation, et le premier instantané tardif — même antérieur — la
     * remplacerait sans que rien ne s'y oppose. C'est exactement ce qui s'est
     * produit le 21 août.
     */
    if (observedAt) contract.stripe.subscription.statusObservedAt = new Date(observedAt);
    // La facture porte l'identifiant de la souscription : c'est souvent la
    // première occasion de le connaître quand la session n'a pas été appliquée.
    const subId = invoice.subscription
      ? (typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id)
      : null;
    if (subId) contract.stripe.subscription.subscriptionId = subId;
  }
  if (invoice.period_end) contract.stripe.subscription.currentPeriodEnd = toDate(invoice.period_end) || contract.stripe.subscription.currentPeriodEnd;
  await contract.save();

  /**
   * ÉVÉNEMENT MÉTIER — un règlement d'abonnement encaissé, et rien d'autre.
   *
   * ── POURQUOI SEULEMENT QUAND LE PAIEMENT EST NEUF ────────────────────────
   * `existing` non nul signifie que cette facture a déjà été portée au journal :
   * un rejeu de webhook, une réconciliation, une relecture. Rien de neuf n'a
   * été encaissé, donc rien de neuf n'est annoncé.
   *
   * ── POURQUOI LA CLÉ PORTE LE PAIEMENT ────────────────────────────────────
   * Un paiement = une facture = un cycle. La clé est donc stable pour toute la
   * vie de ce règlement, y compris si deux processus passent ici en même
   * temps : l'index unique tranche, et il ne part qu'un message.
   *
   * ── POURQUOI `emitAndDispatch` ───────────────────────────────────────────
   * `emitSafe` persisterait le fait sans matérialiser d'exécution d'action :
   * le message attendrait un dispatch qui ne viendrait jamais. Même piège que
   * sur les frais de lancement, même remède.
   *
   * Jamais bloquant : un journal qui hoquette ne remet pas en cause un
   * encaissement déjà acquis chez le fournisseur.
   */
  if (!existing && paiement) {
    await emitAndDispatch({
      type: 'subscription.paid',
      entityType: 'Contract',
      entityId: contract._id,
      actor: actor
        ? { type: EVENT_ACTOR_TYPE.USER, id: actor._id, role: actor.role }
        : { type: EVENT_ACTOR_TYPE.SYSTEM },
      payloadSafe: {
        reference: contract.reference || '',
        paymentId: String(paiement._id),
        invoiceId: invoice.id || '',
        amountIncludingTax: paiement.amountIncludingTax ?? 0,
        currency: paiement.currency || 'EUR',
        paidAt: paiement.paidAt ? new Date(paiement.paidAt).toISOString() : null,
        periodStart: contract.stripe.subscription.currentPeriodStart
          ? new Date(contract.stripe.subscription.currentPeriodStart).toISOString() : null,
        periodEnd: contract.stripe.subscription.currentPeriodEnd
          ? new Date(contract.stripe.subscription.currentPeriodEnd).toISOString() : null,
      },
      idempotencyKey: `subscription-paid:${paiement._id}`,
    });
  }

  return { changed: !existing };
}

/**
 * Échec d'un paiement de cycle (invoice.payment_failed). POLITIQUE V1 : l'abonnement
 * passe PAST_DUE, une alerte est tracée, mais le SITE RESTE ACTIF tant que Stripe
 * considère l'abonnement récupérable. La suspension ne survient qu'à la fin
 * effective (statut terminal : unpaid/canceled/deleted).
 */
export async function markInvoiceFailed(contract, invoice, { actor } = {}) {
  const mode = resolveProviderEnvironment('STRIPE');
  const existing = invoice.id ? await Payment.findOne({ contractId: contract._id, type: PAYMENT_TYPE.SUBSCRIPTION, externalInvoiceId: invoice.id, status: PAYMENT_STATUS.FAILED }) : null;
  if (!existing) {
    const sub = contract.pricing.subscription;
    await Payment.create({
      contractId: contract._id,
      type: PAYMENT_TYPE.SUBSCRIPTION,
      status: PAYMENT_STATUS.FAILED,
      providerMode: mode,
      applicationEnvironment: config.env,
      environment: config.env,
      amountExcludingTax: sub.amountExcludingTax,
      taxAmount: sub.taxAmount,
      amountIncludingTax: sub.amountIncludingTax,
      currency: (invoice.currency || sub.currency || 'EUR').toUpperCase(),
      externalInvoiceId: invoice.id || null,
      failedAt: new Date(),
    });
  }
  if (!SUBSCRIPTION_TERMINAL_STATUSES.includes(contract.stripe.subscription.status)) {
    contract.stripe.subscription.status = SUBSCRIPTION_STATUS.PAST_DUE;
  }
  contract.stripe.subscription.lastError = { code: 'invoice_payment_failed', message: "Le dernier paiement d'abonnement a échoué.", at: new Date() };
  await contract.save();
  await audit(contract, CONTRACT_AUDIT_ACTION.SUBSCRIPTION_PAYMENT_FAILED, { actor });
  return { changed: true };
}

// --- Création / réutilisation du Checkout ------------------------------------

/**
 * CLÉ D'IDEMPOTENCE — portée par la TENTATIVE, jamais par le clic.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * Cette clé était stable pour un contrat donné. Après un paiement réussi, un
 * clic sur « Reprendre » rappelait donc `checkout.sessions.create` avec la même
 * clé : Stripe rejouait sa réponse d'origine et renvoyait l'URL de la session
 * DÉJÀ COMPLÉTÉE. L'utilisateur atterrissait sur la page hébergée de Stripe
 * — « Vous avez terminé » — alors que l'application le croyait toujours à
 * payer.
 *
 * La rendre unique à chaque appel aurait ouvert la porte à deux souscriptions
 * pour un même contrat. Elle porte donc le numéro de TENTATIVE : plusieurs
 * clics pendant une même tentative retombent sur la même session Stripe, et
 * seule une tentative nouvelle — décidée sur un fait constaté chez Stripe —
 * en crée une autre.
 */
function buildIdempotencyKey(contract, mode) {
  const version = contract.signatureConfiguration?.version || 0;
  const sub = contract.pricing?.subscription || {};
  /**
   * L'INTERVALLE ENTRE DANS LA CLÉ, PAS SEULEMENT L'UNITÉ.
   *
   * Sans lui, « tous les mois » et « tous les 3 mois » à montant identique
   * produiraient la MÊME clé d'idempotence : Stripe rejouerait sa réponse
   * d'origine et rendrait la session de l'ancienne périodicité. Le client
   * paierait alors une fréquence que le contrat ne dit plus.
   */
  const { unit, interval } = recurrenceOf(sub);
  const periodicite = `${unit === 'YEAR' ? 'year' : 'month'}x${interval}`;
  const attempt = contract.stripe?.subscription?.attempt || 0;
  return `checkout-sub-${contract._id}-v${version}-${periodicite}-${sub.amountIncludingTax || 0}-${mode}-a${attempt}`;
}

/**
 * Crée (ou réutilise) une Checkout Session d'abonnement. Réutilise une session
 * `CHECKOUT_CREATED` encore ouverte (anti double-clic). Crée Customer + Product +
 * Price immuables, puis la session `mode: subscription` avec metadata + clé
 * d'idempotence. Retourne { url, reused }.
 */
export async function createOrReuseSubscriptionCheckout(contract, { successUrl, cancelUrl }, actor) {
  assertSubscriptionPayable(contract);
  const mode = resolveProviderEnvironment('STRIPE');

  /**
   * CE QUE DIT STRIPE DE LA SESSION EN COURS — et ce qu'on en fait.
   *
   *   · `open`     → on la réutilise. C'est le garde anti-double-clic : la
   *                  tentative est la même, la session doit l'être aussi.
   *   · `complete` → on ne la réutilise JAMAIS, et on ne paie pas deux fois :
   *                  on réconcilie l'état local et on rend la main. Le paiement
   *                  a eu lieu ; ce qui manquait, c'est de le constater.
   *   · `expired`  → la tentative est close sans paiement : on en ouvre une
   *                  nouvelle, donc une nouvelle clé d'idempotence.
   */
  const existingSessionId = contract.stripe.subscription.checkoutSessionId;
  if (existingSessionId) {
    /**
     * ── LA RELECTURE PASSE PAR LE PANEL (L6.2E) ─────────────────────────────
     *
     * Elle interrogeait Stripe avec la clé du PROJET. Depuis que la session est
     * créée par le Panel, cette lecture s'adresse potentiellement à un autre
     * compte — et ne rien y trouver ne dit pas que la session n'existe pas,
     * cela dit qu'on a demandé au mauvais endroit.
     *
     * Le `catch` ouvrait alors une NOUVELLE tentative, donc une seconde session
     * d'abonnement pendant que la première restait ouverte. Même défaut que sur
     * les frais, corrigé de la même façon : un silence ne fait plus repartir
     * l'acte, il le fait échouer explicitement.
     */
    let vue = null;
    try {
      vue = await readCheckoutViaPanel({
        checkoutSessionId: existingSessionId,
        operationId: buildIdempotencyKey(contract, mode),
      });
    } catch (err) {
      /**
       * Session non reconnue par le Panel : elle est ANTÉRIEURE à la bascule
       * (créée avec la clé locale, donc sans lien). On ne peut ni la relire ni
       * la reprendre — mais on ne doit pas non plus en ouvrir une seconde à
       * l'aveugle. On ouvre une tentative NEUVE, ce qui est le geste correct
       * ici : l'ancienne session n'est pas la nôtre, et le Panel en créera une
       * qui l'est.
       */
      if (err?.code !== 'CAPABILITY_RESOURCE_NOT_OWNED') throw err;
      await ouvrirNouvelleTentative(contract);
      vue = null;
    }

    if (vue?.status === 'open' && vue?.url) {
      return { url: vue.url, reused: true };
    }
    if (vue?.status === 'complete') {
      // Le paiement est passé : réconcilier, ne rien recréer.
      await settleFromCheckoutSession(contract, sessionDepuisVue(vue), { actor });
      return { url: null, alreadyPaid: true, reconciled: true };
    }
    if (vue?.status === 'expired') {
      await ouvrirNouvelleTentative(contract);
    }
  }

  /**
   * ── LE PANEL COMPOSE CLIENT + TARIF + SESSION (L6.2E) ─────────────────────
   *
   * `ensureCustomer` et `ensureProductAndPrice` ne sont plus appelés ici : le
   * Panel garantit les deux ressources lui-même, avec SA clé, avant de composer
   * la session. Les appeler encore créerait les mêmes objets deux fois — une
   * fois par le projet, une fois par le Panel — pour un seul contrat.
   *
   * Le client rendu est persisté : la facturation locale le relit
   * (`billing.service.js`), et son sens a changé — il porte désormais une
   * référence rendue par l'autorité, plus un identifiant produit ici.
   */
  const session = await createSubscriptionCheckoutViaPanel({
    contract,
    successUrl,
    cancelUrl,
    operationId: buildIdempotencyKey(contract, mode),
  });

  contract.stripe.subscription.checkoutSessionId = session.checkoutSessionId;
  if (session.customerId) contract.stripe.customerId = session.customerId;
  contract.stripe.subscription.status = SUBSCRIPTION_STATUS.CHECKOUT_CREATED;
  await contract.save();

  await audit(contract, CONTRACT_AUDIT_ACTION.SUBSCRIPTION_CHECKOUT_CREATED, { actor, meta: { mode } });
  return { url: session.url, reused: false };
}

/**
 * Traduit la vue rendue par le Panel vers la forme qu'attendent les mutateurs
 * historiques. Ils lisent `session.subscription`, `session.customer`,
 * `session.status` — on ne les réécrit pas : leur verdict métier n'a pas changé,
 * seule la porte par laquelle l'information arrive a changé.
 */
function sessionDepuisVue(vue) {
  return {
    id: vue.checkoutSessionId,
    mode: 'subscription',
    status: vue.status,
    payment_status: vue.paymentStatus,
    customer: vue.customerId,
    subscription: vue.subscriptionId,
  };
}

/**
 * RETROUVE la souscription d'un contrat quand le local ne la connaît pas.
 *
 * Deux voies, dans cet ordre, et aucune ne fait confiance au navigateur :
 *   1. la Checkout Session stockée côté serveur — elle porte la souscription
 *      dès qu'elle est complète ;
 *   2. à défaut, les souscriptions du client Stripe du contrat.
 *
 * Rend `null` plutôt qu'un identifiant deviné : mieux vaut ne rien réparer que
 * de rattacher un contrat à la souscription d'un autre.
 */
async function retrouverSubscriptionId(contract) {
  /**
   * ── LE REPLI PAR METADATA A DISPARU (L6.2F) ───────────────────────────────
   *
   * Cette fonction avait deux voies. La seconde listait les abonnements du
   * client Stripe du contrat et retenait celui dont `metadata.contractId`
   * correspondait — c'est-à-dire qu'elle faisait décider l'appartenance par un
   * champ ÉDITABLE depuis le tableau de bord Stripe, sur une liste qu'on avait
   * demandée plus large que son dû.
   *
   * C'est exactement ce que la doctrine du plan de contrôle interdit, et ce
   * n'est plus nécessaire : la session porte son abonnement, le Panel l'a
   * adopté, et son appartenance est prouvée par filiation.
   *
   * Il ne reste donc qu'une voie, et c'est la bonne : demander au Panel l'état
   * de NOTRE session.
   */
  const sessionId = contract.stripe?.subscription?.checkoutSessionId;
  if (!sessionId) return null;
  try {
    const vue = await readCheckoutViaPanel({
      checkoutSessionId: sessionId,
      operationId: `sub-find-${contract._id}-${sessionId}`,
    });
    return vue.subscriptionId || null;
  } catch {
    /**
     * Session inconnue du Panel (antérieure à la bascule) ou fournisseur
     * indisponible. On rend `null` plutôt qu'un identifiant deviné : mieux vaut
     * ne rien réparer que de rattacher un contrat à l'abonnement d'un autre.
     */
    return null;
  }
}

/**
 * Ouvre une nouvelle tentative de paiement.
 *
 * Le compteur n'avance QUE sur un fait constaté chez Stripe : session expirée
 * ou introuvable. Jamais sur une intention de l'utilisateur — sans quoi deux
 * clics créeraient deux souscriptions.
 */
async function ouvrirNouvelleTentative(contract) {
  contract.stripe.subscription.attempt = (contract.stripe.subscription.attempt || 0) + 1;
  contract.stripe.subscription.checkoutSessionId = null;
  await contract.save();
}

// --- Réconciliation ----------------------------------------------------------

/**
 * Réconcilie l'abonnement d'UN contrat avec Stripe (statut, période, résiliation,
 * fin). Idempotente ; ne crée jamais d'abonnement. Renvoie les changements.
 */
export async function reconcileSubscription(contract, { actor } = {}) {
  /**
   * SANS IDENTIFIANT, ON LE CHERCHE — on ne renonce pas.
   *
   * Cette fonction sortait immédiatement quand `subscriptionId` était absent.
   * Or cet identifiant n'est écrit que par les webhooks : tant qu'aucun n'avait
   * été appliqué, la seule réparation possible du produit ne faisait RIEN,
   * définitivement. Un abonnement payé chez Stripe restait donc « à régler »
   * pour toujours.
   */
  const subId = contract.stripe?.subscription?.subscriptionId
    || (await retrouverSubscriptionId(contract));
  /**
   * AUCUN IDENTIFIANT — il n'y a rien à relire, et ce n'est PAS une panne.
   *
   * Le cas normal : aucune souscription n'a encore été ouverte. Le distinguer
   * d'une autorité muette compte, parce que les deux appellent des phrases
   * opposées à l'écran — « il n'y a rien à vérifier » contre « nous n'avons pas
   * pu vérifier ».
   */
  if (!subId) return { changes: [], authorityReached: true, nothingToRead: true };

  contract.stripe.subscription.subscriptionId = subId;
  const before = contract.stripe.subscription.status;
  try {
    const stripeSub = await readSubscriptionViaPanel({
      subscriptionId: subId,
      operationId: `sub-reconcile-${contract._id}-${subId}`,
    });
    // Lecture DIRECTE : l'instantané le plus frais qui existe. Il prime sur
    // toute annonce déjà appliquée, et c'est ce qui rend la réparation possible.
    await settleFromSubscription(contract, stripeSub, { actor, observedAt: new Date() });
  } catch (err) {
    /**
     * ══ L'AUTORITÉ N'A PAS RÉPONDU, ET L'ÉCRAN DOIT LE SAVOIR ══════════════
     *
     * Ce `catch` rendait `{ changes: [] }` — exactement ce que rend une
     * réconciliation qui a RÉUSSI sans rien trouver à changer. Les deux étaient
     * indiscernables, et le parcours affichait « État du paiement vérifié » sur
     * une vérification qui n'avait pas eu lieu.
     *
     * C'est la pire des issues pour ce bouton : l'utilisateur, à qui l'on vient
     * de confirmer que tout est vérifié, voit l'écran répéter qu'il doit payer.
     * Il en conclut que son paiement n'est pas passé.
     *
     * On ne LÈVE toujours pas — le bouton doit rendre un état, pas une 500 —
     * mais on RAPPORTE. La phrase se décide à l'écran, sur un fait honnête.
     */
    logger.warn(
      `[stripe] réconciliation d'abonnement impossible pour ${contract.reference || contract._id} : `
      + `l'autorité n'a pas répondu (${err?.code ?? err?.message ?? 'motif inconnu'}). `
      + "L'état local est conservé tel quel.",
    );
    return { changes: [], authorityReached: false, reason: err?.code ?? 'AUTHORITY_UNAVAILABLE' };
  }
  const after = contract.stripe.subscription.status;
  return {
    changes: after !== before ? [`subscription:${after}`] : [],
    authorityReached: true,
  };
}

// --- Moyen de paiement (ADMIN) -----------------------------------------------

/**
 * OUVRE LE PORTAIL CLIENT STRIPE pour modifier le moyen de paiement.
 *
 * ── CE QUE NOUS NE FAISONS PAS ────────────────────────────────────────────
 * Aucun numéro de carte n'entre ici, n'y transite, n'y est stocké. Nous
 * demandons une session à Stripe et renvoyons son URL ; tout le reste — saisie,
 * authentification forte, cartes expirées, moyens locaux — se passe chez lui.
 * C'est aussi pourquoi le retour du navigateur ne vaut RIEN : la vérité arrive
 * par les webhooks (`customer.subscription.updated`), déjà traités.
 *
 * L'identifiant client ne sort jamais vers le navigateur : il est résolu ici, à
 * partir du contrat, et n'apparaît dans aucune réponse.
 */
export async function openBillingPortal(contract, returnUrl) {
  /**
   * L6.3B — LE PROJET NE DÉSIGNE PLUS LE CLIENT.
   *
   * Il lisait `contract.stripe.customerId` et le passait à Stripe. L'écran
   * s'ouvrait donc sur le client que la fiche locale nommait — pas sur celui
   * que le contrat possède réellement. Une reprise de données, une copie de
   * contrat, un identifiant hérité, et le portail ouvrait le dossier de
   * quelqu'un d'autre : moyens de paiement, factures, abonnements. L'appel
   * aurait réussi, et rien ne l'aurait signalé.
   *
   * Il nomme désormais son CONTRAT. Le Panel remonte au client par le lien
   * d'appartenance qu'il a lui-même écrit en L6.2D, et refuse un contrat qui
   * n'est pas à ce projet AVANT de contacter Stripe.
   *
   * On garde le contrôle local sur `customerId` : non plus pour désigner le
   * client, mais pour dire franchement « aucun moyen de paiement rattaché »
   * plutôt que de laisser le Panel répondre « ressource non possédée » à un
   * client qui n'a simplement jamais payé.
   */
  if (!contract?.stripe?.customerId) {
    throw new ApiError(409, "Aucun moyen de paiement n'est encore rattaché à ce contrat.", {
      code: 'BILLING_CUSTOMER_MISSING',
    });
  }

  const { url } = await openBillingPortalViaPanel({
    contractRef: String(contract._id),
    returnUrl,
    /**
     * L'identité de l'acte porte le contrat et l'instant.
     *
     * Une session de portail est ÉPHÉMÈRE : deux ouvertures à une heure
     * d'intervalle sont deux actes distincts, et leur rendre la même URL
     * rendrait la seconde morte. L'instant est donc ici une propriété du
     * geste, pas une négligence — contrairement à un paiement, où il serait
     * une faute.
     */
    operationId: `portal-${contract._id}-${Date.now()}`,
  });
  return { url };
}

/**
 * Ce que l'ADMIN peut voir de son moyen de paiement — et rien de plus.
 *
 * Aucune donnée bancaire n'est stockée côté projet : on ne peut donc pas
 * afficher les quatre derniers chiffres. On dit ce qu'on sait réellement —
 * qu'un moyen de paiement est rattaché, et quand tombe la prochaine échéance.
 */
export function getPaymentMethodView(contract) {
  const s = contract?.stripe?.subscription || {};
  const required = sm.subscriptionRequired(contract);
  return {
    // Un client Stripe existe : un moyen de paiement a donc été enregistré au
    // moins une fois, lors du premier règlement.
    hasCustomer: Boolean(contract?.stripe?.customerId),
    canUpdate: Boolean(contract?.stripe?.customerId),
    subscriptionRequired: required,
    currentPeriodEnd: s.currentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
  };
}

/**
 * RÉCONCILIE l'abonnement avec Stripe, puis dit où l'on en est.
 *
 * Point d'entrée de la réparation : le retour de Checkout, un clic de
 * vérification, ou simplement l'ouverture de la page. Idempotent — il ne crée
 * jamais de souscription, ne prend aucun identifiant du navigateur, et rend un
 * état métier plutôt qu'un statut Stripe brut.
 */
export async function reconcileAndDescribe(contract, { actor } = {}) {
  const avant = contract.stripe?.subscription?.status;
  const relecture = await reconcileSubscription(contract, { actor });

  // La facture porte la vérité du PAIEMENT ; la souscription, celle du CYCLE.
  // On lit la facture quand on la connaît : « payée » prime sur tout le reste.
  const invoiceId = contract.stripe?.subscription?.latestInvoiceId;
  if (invoiceId) {
    /**
     * L6.3B — LA FACTURE SE LIT PAR LE PANEL.
     *
     * L'identifiant vient de l'abonnement, que le Panel possède depuis L6.2F ;
     * le Panel vérifie de son côté que la facture appartient bien au client du
     * contrat. Le projet ne présente donc plus un identifiant sur sa seule foi.
     *
     * Le `catch` reste, et sa raison n'a pas changé : cette lecture est un
     * ENRICHISSEMENT. « Payée » précise ce que l'abonnement dit déjà ; ne pas
     * l'obtenir laisse la souscription comme source, elle ne fabrique aucun
     * état faux. Ce n'est pas un repli vers Stripe — il n'y en a plus.
     */
    try {
      const facture = await readInvoiceViaPanel({
        contractRef: String(contract._id),
        invoiceId,
        operationId: `invoice-read-${contract._id}-${invoiceId}`,
      });
      /**
       * `markInvoicePaid` reçoit aussi des factures brutes venant des webhooks
       * Stripe : on lui rend donc la forme qu'il connaît, plutôt que de lui
       * apprendre un second vocabulaire. Deux formes pour un même objet
       * finiraient par diverger, et c'est le montant qui en souffrirait.
       */
      if (facture?.paid) {
        await markInvoicePaid(contract, {
          id: facture.invoiceId,
          amount_paid: facture.amountPaid,
          total: facture.amountPaid,
          hosted_invoice_url: facture.hostedInvoiceUrl,
          invoice_pdf: facture.invoicePdfUrl,
          number: facture.number,
          currency: facture.currency,
          status: facture.status,
        }, { actor });
      }
    } catch { /* la souscription reste la source de repli */ }
  }

  const apres = contract.stripe?.subscription?.status;
  return {
    ...getSubscriptionStatus(contract),
    outcome: decrireIssue(contract),
    changed: avant !== apres,
    /**
     * A-T-ON RÉELLEMENT PU RELIRE L'AUTORITÉ ?
     *
     * `false` signifie « l'état ci-dessus est le dernier connu, pas un état
     * fraîchement constaté ». L'écran doit alors proposer de réessayer plutôt
     * que d'affirmer une vérification — et surtout ne pas laisser croire au
     * client que son paiement a été examiné et refusé.
     */
    authorityReached: relecture.authorityReached !== false,
  };
}

/**
 * L'issue MÉTIER de la tentative — ce que l'écran doit dire, et rien d'autre.
 *
 * Aucun de ces états ne se déduit du retour navigateur : ils viennent tous de
 * ce que Stripe a confirmé et de ce que le contrat porte réellement.
 */
export function decrireIssue(contract) {
  const s = contract?.stripe?.subscription || {};
  if (!sm.subscriptionRequired(contract)) return 'NOT_REQUIRED';
  if (SUBSCRIPTION_TERMINAL_STATUSES.includes(s.status)) return 'ENDED';
  if (sm.subscriptionSatisfied(contract)) return 'PAID';
  if (s.status === SUBSCRIPTION_STATUS.PAST_DUE) return 'FAILED';
  if (s.status === SUBSCRIPTION_STATUS.INCOMPLETE) return 'PROCESSING';
  if (s.status === SUBSCRIPTION_STATUS.CHECKOUT_CREATED) return 'AWAITING_PAYMENT';
  return 'TO_PAY';
}

// --- Vue de statut (ADMIN) ---------------------------------------------------

/** Statut public de l'abonnement (aucune donnée Stripe sensible). */
export function getSubscriptionStatus(contract) {
  const sub = contract.pricing?.subscription;
  const required = sm.subscriptionRequired(contract);
  const s = contract.stripe?.subscription || {};
  const recurrence = recurrenceOf(sub);
  return {
    required,
    status: required ? s.status || SUBSCRIPTION_STATUS.PENDING : SUBSCRIPTION_STATUS.NOT_REQUIRED,
    currentPeriodStart: s.currentPeriodStart || null,
    currentPeriodEnd: s.currentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
    lastError: s.lastError?.message ? { message: s.lastError.message, at: s.lastError.at } : null,
    amount: {
      excludingTax: sub?.amountExcludingTax || 0,
      tax: sub?.taxAmount || 0,
      includingTax: sub?.amountIncludingTax || 0,
      currency: sub?.currency || 'EUR',
      /**
       * LA RÉCURRENCE COMPLÈTE — la seule forme sur laquelle un écran décide.
       * `label` voyage avec elle pour que la grammaire française ne soit pas
       * réécrite dans chaque interface ; la structure reste ce qui fait foi.
       */
      recurrence,
      recurrenceLabel: describeRecurrence(recurrence),
      /**
       * `interval` — l'UNITÉ seule, sous son ancien nom. Conservé pour les
       * clients non encore rechargés ; un écran à jour lit `recurrence`.
       */
      interval: recurrence.unit,
      // INFORMATIF uniquement : jamais un montant débité.
      monthlyEquivalentExcludingTax: monthlyEquivalentCents(sub?.amountExcludingTax || 0, recurrence),
      monthlyEquivalentIncludingTax: monthlyEquivalentCents(sub?.amountIncludingTax || 0, recurrence),
    },
  };
}
