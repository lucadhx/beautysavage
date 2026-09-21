/**
 * OUVRIR UN PAIEMENT — en demandant un VERBE, jamais en tenant une clé (L6.2B).
 *
 * ══ CE QUI A CHANGÉ ═════════════════════════════════════════════════════════
 *
 * Le projet appelait `checkout.sessions.create` avec SA clé secrète Stripe. Il
 * décidait donc, seul : quel compte encaisse, quel monde (TEST/PROD), quel
 * montant, quelle clé d'idempotence. Quatre décisions dont aucune n'était
 * vérifiable ailleurs qu'ici.
 *
 * Il demande désormais `billing.checkout.create`. Il apporte l'INTENTION — quel
 * contrat, où revenir, et l'identité de l'acte — et rien d'autre. Le montant,
 * le compte, le monde et la clé d'idempotence sont décidés par le Panel, qui
 * est le seul à pouvoir les confronter à ce qu'il sait du projet.
 *
 * ══ AUCUN REPLI, ET C'EST LE POINT ══════════════════════════════════════════
 *
 * Il n'y a pas de `try capability / catch stripe local`. Un repli sur la clé
 * locale n'est pas une sécurité : c'est la garantie que le jour d'un incident,
 * l'argent repassera par le chemin qu'on croyait fermé — sans que rien ne le
 * signale. Panel injoignable ⇒ échec explicite, et personne ne paie deux fois.
 *
 * ══ POURQUOI L'IDENTITÉ DE L'ACTE N'EST PAS INVENTÉE ICI ════════════════════
 *
 * `operationId` est la clé d'idempotence QUE LE PROJET UTILISAIT DÉJÀ
 * (`Payment.idempotencyKey`) : stable par tentative, persistée, historique. La
 * réutiliser plutôt que d'en fabriquer une nouvelle garantit qu'une reprise
 * après crash désigne le même acte qu'avant le crash — y compris pour les
 * paiements ouverts avant ce lot.
 */
import { invokeCapability } from '../panelBridge/capabilityClient.js';

export const CHECKOUT_CAPABILITY = 'billing.checkout.create';
export const CHECKOUT_READ_CAPABILITY = 'billing.checkout.retrieve';
export const SUBSCRIPTION_READ_CAPABILITY = 'billing.subscription.retrieve';
export const CANCEL_AT_PERIOD_END_CAPABILITY = 'billing.subscription.cancel_at_period_end';
export const CANCEL_NOW_CAPABILITY = 'billing.subscription.cancel_now';

/**
 * Demande au Panel d'ouvrir — ou de RETROUVER — la session des frais de
 * lancement d'un contrat.
 *
 * Rendre `creation: 'REUSED'` n'est pas un échec : c'est la preuve que l'acte
 * avait déjà eu lieu et que le Panel l'a retrouvé au lieu d'en produire un
 * second. L'appelant doit le traiter comme un succès.
 *
 * @param {object} args
 * @param {object} args.contract      le contrat, tel que le projet le détient
 * @param {string} args.successUrl
 * @param {string} args.cancelUrl
 * @param {string} args.operationId   identité de l'ACTE — stable par tentative
 * @param {string} [args.paymentRef]  corrélation vers le journal local (metadata)
 * @returns {Promise<{checkoutSessionId: string, url: string|null, status: string|null,
 *   paymentStatus: string|null, creation: 'CREATED'|'REUSED', operationId: string}>}
 * @throws {BridgeError} refus de la passerelle, ou Panel injoignable. LÈVE.
 */
export async function createLaunchCheckoutViaPanel({
  contract, successUrl, cancelUrl, operationId, paymentRef = null,
}) {
  const envelope = await invokeCapability(CHECKOUT_CAPABILITY, {
    contractRef: String(contract._id),
    paymentType: 'LAUNCH_FEE',
    successUrl,
    cancelUrl,
    ...(paymentRef ? { correlation: { paymentRef: String(paymentRef) } } : {}),
    operationId,
  });

  /**
   * L'enveloppe porte l'issue, la capacité et le monde ; `result` porte le
   * constat métier. On ne relaie que le second : le reste appartient au
   * diagnostic de la passerelle, et le faire entrer dans le service de
   * paiement y ferait entrer le vocabulaire du pont.
   */
  const result = envelope?.result ?? null;
  if (!result?.checkoutSessionId) {
    const err = new Error('Le Panel n’a pas rendu de session de paiement exploitable.');
    err.code = 'CHECKOUT_RESULT_INVALID';
    throw err;
  }
  return result;
}

/**
 * LIT l'état d'une session de paiement — si elle appartient à ce projet (L6.2C).
 *
 * ══ CE QUE LE PROJET N'A PLUS À FAIRE ═══════════════════════════════════════
 *
 * Il ne lit plus la session avec sa propre clé Stripe. C'était le dernier
 * chemin par lequel le parcours de frais touchait encore le fournisseur — et
 * c'était le plus trompeur des deux : une lecture semble inoffensive, alors
 * qu'elle interrogeait potentiellement un compte qui n'est plus celui où la
 * session a été créée. Ne rien trouver ne dit PAS que la session n'existe pas.
 *
 * ══ CE QUE LE PANEL VÉRIFIE AVANT DE RÉPONDRE ═══════════════════════════════
 *
 * Que la session est liée à CE projet. Posséder l'identifiant ne suffit pas :
 * c'est précisément la doctrine du lot. Un refus est indistinguable — inconnue,
 * à un autre, révoquée rendent le même code et le même message — et il ne coûte
 * AUCUN appel à Stripe.
 *
 * @param {object} args
 * @param {string} args.checkoutSessionId
 * @param {string} args.operationId  identité de la LECTURE, ≥ 16 caractères
 * @returns {Promise<{checkoutSessionId: string, status: string|null,
 *   paymentStatus: string|null, url: string|null, expiresAt: number|null,
 *   paymentIntentId: string|null, customerId: string|null}>}
 * @throws {BridgeError} LÈVE — il n'y a pas de repli local.
 */
export async function readCheckoutViaPanel({ checkoutSessionId, operationId }) {
  const envelope = await invokeCapability(CHECKOUT_READ_CAPABILITY, {
    checkoutSessionId,
    operationId,
  });
  const result = envelope?.result ?? null;
  if (!result?.checkoutSessionId) {
    const err = new Error('Le Panel n’a pas rendu d’état de session exploitable.');
    err.code = 'CHECKOUT_READ_RESULT_INVALID';
    throw err;
  }
  return result;
}

/**
 * Ouvre — ou REPREND — la session d'ABONNEMENT d'un contrat (L6.2E).
 *
 * ══ CE QUE LE PROJET N'APPORTE PLUS ═════════════════════════════════════════
 *
 * Ni client, ni tarif. Le Panel garantit les deux lui-même, avec sa clé, avant
 * de composer la session — c'est ce qui rend l'abonnement migrable là où il ne
 * l'était pas : une session qui référencerait des objets créés sur un autre
 * compte serait refusée par Stripe, devant un client qui paie.
 *
 * Ni montant, ni devise, ni périodicité : ils vivent dans le Price, que le Panel
 * dérive de sa projection de contrat.
 *
 * ══ MÊME VERBE QUE LES FRAIS ════════════════════════════════════════════════
 *
 * `billing.checkout.create` avec `paymentType: 'SUBSCRIPTION'`. Une seconde
 * capacité pour le même acte aurait fini par diverger sur l'idempotence.
 */
export async function createSubscriptionCheckoutViaPanel({
  contract, successUrl, cancelUrl, operationId,
}) {
  const envelope = await invokeCapability(CHECKOUT_CAPABILITY, {
    contractRef: String(contract._id),
    paymentType: 'SUBSCRIPTION',
    successUrl,
    cancelUrl,
    operationId,
  });
  const result = envelope?.result ?? null;
  if (!result?.checkoutSessionId) {
    const err = new Error('Le Panel n’a pas rendu de session d’abonnement exploitable.');
    err.code = 'SUBSCRIPTION_CHECKOUT_RESULT_INVALID';
    throw err;
  }
  return result;
}

/**
 * LIT l'état d'un abonnement — si il appartient à ce projet (L6.2F).
 *
 * ══ POURQUOI CETTE LECTURE N'EXISTAIT PAS AVANT ═════════════════════════════
 *
 * Un abonnement n'est créé par personne de notre côté : Stripe le fabrique au
 * moment où le client paie. Il n'avait donc aucun propriétaire prouvable, et
 * l'ouvrir aurait donné à n'importe quel projet le droit de lire n'importe quel
 * abonnement du compte.
 *
 * Le Panel sait désormais l'ADOPTER, depuis la session de paiement qui l'a
 * produit — session dont l'appartenance, elle, était déjà prouvée. C'est cette
 * filiation qui rend la lecture possible, et sûre.
 *
 * @param {object} args
 * @param {string} args.subscriptionId
 * @param {string} args.operationId  identité de la LECTURE, ≥ 16 caractères
 * @throws {BridgeError} LÈVE — il n'y a pas de repli local.
 */
export async function readSubscriptionViaPanel({ subscriptionId, operationId }) {
  const envelope = await invokeCapability(SUBSCRIPTION_READ_CAPABILITY, {
    subscriptionId,
    operationId,
  });
  const result = envelope?.result ?? null;
  if (!result?.subscriptionId) {
    const err = new Error('Le Panel n’a pas rendu d’état d’abonnement exploitable.');
    err.code = 'SUBSCRIPTION_READ_RESULT_INVALID';
    throw err;
  }
  /**
   * Traduit vers la forme qu'attendent les mutateurs historiques
   * (`projectSubscription`). Leur verdict métier ne change pas : seule la porte
   * par laquelle l'information arrive a changé.
   */
  return {
    id: result.subscriptionId,
    status: result.status,
    cancel_at_period_end: result.cancelAtPeriodEnd,
    current_period_start: result.currentPeriodStart,
    current_period_end: result.currentPeriodEnd,
    latest_invoice: result.latestInvoiceId,
    customer: result.customerId,
  };
}

/**
 * RÉSILIE un abonnement — à l'échéance, ou immédiatement (L6.2G).
 *
 * ══ CE QUE LE PROJET NE DÉCIDE PLUS ═════════════════════════════════════════
 *
 * Ni la clé Stripe, ni le monde, ni l'identité de l'acte. Le contrat d'entrée
 * n'accepte QUE l'identifiant d'abonnement : le Panel dérive l'identité du
 * monde et de cet abonnement, vérifie qu'il nous appartient, puis relit son
 * ÉTAT avant de muter quoi que ce soit.
 *
 * ══ POURQUOI L'IDENTITÉ N'EST PAS FOURNIE ═══════════════════════════════════
 *
 * Une résiliation est terminale : elle n'a pas de seconde tentative légitime,
 * seulement des rejeux. Pouvoir la nommer permettrait d'en fabriquer deux —
 * c'est-à-dire de couper deux fois ce qui ne se coupe qu'une.
 *
 * ══ `ALREADY_CANCELLED` EST UN SUCCÈS ═══════════════════════════════════════
 *
 * Il signifie que le Panel a CONSTATÉ l'acte au lieu de le refaire — après une
 * réponse perdue, un double clic ou un redémarrage. Le traiter comme un échec
 * ferait rejouer, et c'est exactement ce que ce chemin empêche.
 *
 * @param {'AT_PERIOD_END'|'NOW'} mode
 * @returns {Promise<{subscriptionId, status, cancelAtPeriodEnd, currentPeriodStart,
 *   currentPeriodEnd, latestInvoiceId, customerId, outcome}>}
 * @throws {BridgeError} LÈVE — il n'y a pas de repli local.
 */
export async function cancelSubscriptionViaPanel({ subscriptionId, mode }) {
  const code = mode === 'NOW' ? CANCEL_NOW_CAPABILITY : CANCEL_AT_PERIOD_END_CAPABILITY;
  const envelope = await invokeCapability(code, { subscriptionId });
  const result = envelope?.result ?? null;
  if (!result?.subscriptionId) {
    const err = new Error('Le Panel n’a pas rendu d’état de résiliation exploitable.');
    err.code = 'SUBSCRIPTION_CANCEL_RESULT_INVALID';
    throw err;
  }
  /**
   * Traduit vers la forme qu'attendent les mutateurs historiques — leur verdict
   * métier ne change pas, seule la porte par laquelle l'état arrive a changé.
   */
  return {
    ...result,
    stripeSubscription: {
      id: result.subscriptionId,
      status: result.status,
      cancel_at_period_end: result.cancelAtPeriodEnd,
      current_period_start: result.currentPeriodStart,
      current_period_end: result.currentPeriodEnd,
      latest_invoice: result.latestInvoiceId,
      customer: result.customerId,
    },
  };
}

export default {
  CHECKOUT_CAPABILITY,
  CHECKOUT_READ_CAPABILITY,
  createLaunchCheckoutViaPanel,
  createSubscriptionCheckoutViaPanel,
  readCheckoutViaPanel,
  readSubscriptionViaPanel,
  cancelSubscriptionViaPanel,
};

/* -------------------------------------------------------------------------- */
/*  L6.3B — LES FACTURES ET LE PORTAIL                                        */
/* -------------------------------------------------------------------------- */

export const INVOICE_LIST_CAPABILITY = 'billing.invoice.list';
export const INVOICE_READ_CAPABILITY = 'billing.invoice.retrieve';
export const PORTAL_CAPABILITY = 'billing.portal.create';

/**
 * Les factures d'un contrat — demandées, jamais listées soi-même (L6.3B).
 *
 * ══ CE QUE LE PROJET N'APPORTE PLUS ═════════════════════════════════════════
 *
 * Le `customerId`. Il le fournissait, et c'est ce qui rendait la lecture
 * dangereuse : lister les factures d'un client, c'est lire des montants, des
 * adresses et un historique de paiement. Un identifiant mal choisi — copié d'un
 * autre contrat, hérité d'une reprise de données — ouvrait le dossier de
 * quelqu'un d'autre sans que l'appel ait l'air anormal.
 *
 * Il nomme désormais son CONTRAT. Le Panel remonte au client par le lien
 * d'appartenance qu'il a lui-même écrit, et un contrat qui n'est pas au projet
 * est refusé avant que Stripe ne soit contacté.
 *
 * @returns {Promise<{invoices: object[], hasMore: boolean}>}
 * @throws LÈVE — aucun repli local.
 */
export async function listInvoicesViaPanel({ contractRef, operationId, limit }) {
  const envelope = await invokeCapability(INVOICE_LIST_CAPABILITY, {
    contractRef: String(contractRef),
    operationId,
    ...(limit ? { limit } : {}),
  });
  const result = envelope?.result ?? null;
  if (!Array.isArray(result?.invoices)) {
    const err = new Error('Le Panel n’a pas rendu de liste de factures exploitable.');
    err.code = 'INVOICE_LIST_RESULT_INVALID';
    throw err;
  }
  return result;
}

/**
 * UNE facture du contrat (L6.3B).
 *
 * Le Panel vérifie que la facture appartient bien au client du contrat, et
 * refuse exactement comme si elle n'existait pas dans le cas contraire. Le
 * projet ne peut donc pas s'en servir pour sonder l'existence d'une facture.
 */
export async function readInvoiceViaPanel({ contractRef, invoiceId, operationId }) {
  const envelope = await invokeCapability(INVOICE_READ_CAPABILITY, {
    contractRef: String(contractRef),
    invoiceId,
    operationId,
  });
  const result = envelope?.result ?? null;
  if (!result?.invoiceId) {
    const err = new Error('Le Panel n’a pas rendu de facture exploitable.');
    err.code = 'INVOICE_READ_RESULT_INVALID';
    throw err;
  }
  return result;
}

/**
 * Ouvre le PORTAIL CLIENT d'un contrat (L6.3B).
 *
 * ══ POURQUOI CELUI-CI COMPTE PLUS QUE LES AUTRES ════════════════════════════
 *
 * Le portail donne accès aux moyens de paiement, aux factures et aux
 * abonnements d'un client. C'est le verbe où se tromper de client coûte le plus
 * cher — pas en argent, en données personnelles — et c'est le seul dont
 * l'erreur serait invisible : l'appel réussirait, l'écran s'ouvrirait, et
 * personne ne saurait qu'il s'agissait du dossier de quelqu'un d'autre.
 *
 * Le projet ne désigne donc plus le client. Il nomme son contrat.
 *
 * ══ AUCUNE CLÉ D'IDEMPOTENCE, ET C'EST VOULU ════════════════════════════════
 *
 * Une session de portail est à usage unique et expire. Rejouer un acte
 * identique doit rendre une session NEUVE — rendre l'ancienne rendrait une URL
 * morte. Le double clic se traite en amont, pas ici.
 */
export async function openBillingPortalViaPanel({ contractRef, returnUrl, operationId }) {
  const envelope = await invokeCapability(PORTAL_CAPABILITY, {
    contractRef: String(contractRef),
    returnUrl,
    operationId,
  });
  const result = envelope?.result ?? null;
  if (!result?.url) {
    const err = new Error('Le Panel n’a pas rendu d’adresse de portail exploitable.');
    err.code = 'PORTAL_RESULT_INVALID';
    throw err;
  }
  return result;
}
