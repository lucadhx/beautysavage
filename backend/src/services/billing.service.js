import { Invoice } from '../models/Invoice.model.js';
import { Contract } from '../models/Contract.model.js';
import { config } from '../config/env.js';
import { listInvoicesViaPanel } from './stripe/checkoutCapability.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { INVOICE_STATUS, PAYMENT_TYPE } from '../utils/contractConstants.js';

/**
 * Facturation Stripe — MIROIR interne des factures Stripe (source juridique =
 * Stripe). On conserve numéro, montants (CENTIMES), statut, dates et surtout les
 * LIENS hébergés (hosted invoice + PDF). Aucune facture n'est fabriquée ici : on
 * reflète celles générées par Stripe (abonnement : automatiques ; frais de
 * lancement : via `invoice_creation` sur le Checkout). Jamais de suppression
 * physique. Ce lot ne fait PAS de facturation électronique.
 */

function toDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

/** Statut Stripe → statut interne (mapper centralisé). */
export function mapInvoiceStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'paid':
      return INVOICE_STATUS.PAID;
    case 'draft':
      return INVOICE_STATUS.DRAFT;
    case 'uncollectible':
      return INVOICE_STATUS.UNCOLLECTIBLE;
    case 'void':
      return INVOICE_STATUS.VOID;
    case 'open':
    default:
      return INVOICE_STATUS.OPEN;
  }
}

/**
 * Identifiant d'abonnement d'une facture, TOUTES versions d'API confondues.
 *
 * Stripe a DÉPLACÉ ce champ : jusqu'à `2025-02-24.acacia` il est en racine
 * (`invoice.subscription`) ; depuis `2025-03-31.basil` il vit sous
 * `invoice.parent.subscription_details.subscription`. Le SDK est épinglé pour
 * les appels SORTANTS, mais la forme des WEBHOOKS dépend de la version du compte
 * / de l'endpoint : les deux formes doivent donc être acceptées.
 */
export function invoiceSubscriptionId(stripeInvoice) {
  const candidate =
    stripeInvoice?.subscription ?? // ≤ acacia
    stripeInvoice?.parent?.subscription_details?.subscription ?? // ≥ basil
    null;
  if (!candidate) return null;
  return typeof candidate === 'string' ? candidate : candidate.id || null;
}

/**
 * Type métier d'une facture : `billing_reason` d'abord.
 *
 * ⚠️ Ne JAMAIS repartir de `stripeInvoice.subscription` comme discriminant
 * principal (incident RX-01) :
 *  - les factures d'abonnement n'héritent PAS des metadata de l'abonnement
 *    (`subscription_data.metadata` reste sur l'abonnement) → aucune metadata ;
 *  - et le champ racine `subscription` a disparu en `basil`.
 * Une facture d'abonnement était donc typée LAUNCH_FEE par défaut — avec deux
 * conséquences : un libellé faux, et surtout `handleInvoiceEvent` qui cessait
 * d'enregistrer les paiements de cycle et les passages en PAST_DUE.
 *
 * `billing_reason` est en racine et STABLE dans toutes les versions d'API :
 * c'est le seul discriminant fiable.
 */
export function invoiceType(stripeInvoice) {
  // 1. Metadata explicite (frais de lancement : posée via invoice_creation).
  const meta = stripeInvoice.metadata || {};
  if (meta.paymentType === PAYMENT_TYPE.SUBSCRIPTION) return PAYMENT_TYPE.SUBSCRIPTION;
  if (meta.paymentType === PAYMENT_TYPE.LAUNCH_FEE) return PAYMENT_TYPE.LAUNCH_FEE;

  // 2. billing_reason — l'autorité.
  const reason = stripeInvoice.billing_reason;
  if (typeof reason === 'string' && reason.startsWith('subscription')) {
    // subscription_create | subscription_cycle | subscription_update
    // | subscription_threshold | subscription
    return PAYMENT_TYPE.SUBSCRIPTION;
  }

  // 3. Repli : présence d'un abonnement, quelle que soit la version d'API.
  //    (`manual`, `quote_accept`, `upcoming`… → frais de lancement.)
  return invoiceSubscriptionId(stripeInvoice) ? PAYMENT_TYPE.SUBSCRIPTION : PAYMENT_TYPE.LAUNCH_FEE;
}

/**
 * Résout le contrat rattaché à une facture Stripe. Les factures d'ABONNEMENT
 * n'héritent PAS des metadata de l'abonnement : on résout donc dans l'ordre
 * metadata.contractId → abonnement → client.
 */
export async function resolveContractForInvoice(facture) {
  /**
   * L6.3B — accepte la vue du Panel comme l'objet brut d'un webhook. La même
   * normalisation que l'upsert : deux vocabulaires pour une même facture
   * finiraient par rattacher deux contrats différents.
   */
  const stripeInvoice = normaliserFacture(facture);
  const meta = stripeInvoice.metadata || {};
  if (meta.contractId) {
    const c = await Contract.findById(meta.contractId).catch(() => null);
    if (c) return c;
  }
  const subId = invoiceSubscriptionId(stripeInvoice);
  if (subId) {
    const c = await Contract.findOne({ 'stripe.subscription.subscriptionId': subId });
    if (c) return c;
    /**
     * ══ UNE FACTURE QUI NOMME UN AUTRE ABONNEMENT N'EST PAS À NOUS ═════════
     *
     * Le repli par CLIENT existe pour les factures qui ne nomment AUCUN
     * abonnement — typiquement une prestation ponctuelle, où le lien n'est pas
     * encore écrit. Il ne doit pas s'appliquer ici : la facture DÉSIGNE un
     * abonnement, et aucun contrat ne le porte. La réponse honnête est
     * « pas à nous », pas « au seul contrat de ce client ».
     *
     * ── LE DÉFAUT MESURÉ ────────────────────────────────────────────────────
     *
     * Un abonnement de recette créé sur le même client Stripe a produit sa
     * facture d'essai. Le contrat ne le portait pas, le repli a désigné le
     * contrat de démonstration, et un paiement fantôme y a été inscrit. Deux
     * abonnements chez un même client suffisent : rien d'exotique.
     */
    logger.warn(
      `[billing] facture ${stripeInvoice.id ?? '(sans id)'} rattachée à l'abonnement `
      + `${subId}, qu'aucun contrat ne porte — non attribuée.`,
    );
    return null;
  }
  const custId = typeof stripeInvoice.customer === 'string' ? stripeInvoice.customer : stripeInvoice.customer?.id;
  if (custId) {
    const c = await Contract.findOne({ 'stripe.customerId': custId });
    if (c) return c;
  }
  return null;
}

/**
 * Upsert IDEMPOTENT d'une facture Stripe (unique par `externalInvoiceId`). Ne
 * régresse jamais un lien/numéro déjà connu. Renvoie `{ invoice, created }`.
 */
/**
 * L6.3B — CETTE FONCTION LIT DÉSORMAIS DEUX FORMES, ET C'EST ASSUMÉ.
 *
 * Les webhooks apportent l'objet Stripe BRUT (`total`, `amount_due`,
 * `status_transitions.paid_at`) ; les capacités apportent la VUE du Panel
 * (`total`, `amountDue`, `paidAt`). Les deux décrivent la même facture.
 *
 * On normalise ici plutôt que d'écrire deux upserts : deux chemins d'écriture
 * pour un même document finiraient par produire deux montants, et c'est
 * exactement ce que l'unicité par `externalInvoiceId` cherche à empêcher.
 */
function normaliserFacture(f) {
  if (f?.invoiceId) {
    // La vue du Panel — champs nommés, jamais l'objet du fournisseur.
    return {
      id: f.invoiceId,
      number: f.number,
      status: f.status,
      total: f.total ?? f.amountPaid ?? f.amountDue ?? 0,
      amount_due: f.amountDue,
      amount_paid: f.amountPaid,
      tax: f.tax ?? 0,
      currency: f.currency,
      created: f.createdAt,
      due_date: f.dueAt,
      status_transitions: { paid_at: f.paidAt },
      hosted_invoice_url: f.hostedInvoiceUrl,
      invoice_pdf: f.invoicePdfUrl,
      billing_reason: f.billingReason,
      subscription: f.subscriptionId,
      customer: f.customerId,
    };
  }
  return f ?? {};
}

export async function upsertInvoiceFromStripe(facture, contract, { label, addedManually } = {}) {
  const stripeInvoice = normaliserFacture(facture);
  const amountTTC = stripeInvoice.total ?? stripeInvoice.amount_due ?? stripeInvoice.amount_paid ?? 0;
  const tax = stripeInvoice.tax || 0;
  const status = mapInvoiceStatus(stripeInvoice.status);
  const before = await Invoice.findOne({ provider: 'STRIPE', externalInvoiceId: stripeInvoice.id });
  const invoice = await Invoice.findOneAndUpdate(
    { provider: 'STRIPE', externalInvoiceId: stripeInvoice.id },
    {
      contractId: contract?._id || before?.contractId || null,
      number: stripeInvoice.number || before?.number || '',
      type: invoiceType(stripeInvoice),
      amountExcludingTax: Math.max(0, amountTTC - tax),
      taxAmount: tax,
      amountIncludingTax: amountTTC,
      currency: (stripeInvoice.currency || 'eur').toUpperCase(),
      status,
      invoiceDate: toDate(stripeInvoice.created) || before?.invoiceDate || null,
      dueDate: toDate(stripeInvoice.due_date) || before?.dueDate || null,
      paidAt:
        status === INVOICE_STATUS.PAID
          ? toDate(stripeInvoice.status_transitions?.paid_at) || before?.paidAt || new Date()
          : before?.paidAt || null,
      hostedInvoiceUrl: stripeInvoice.hosted_invoice_url || before?.hostedInvoiceUrl || '',
      invoicePdfUrl: stripeInvoice.invoice_pdf || before?.invoicePdfUrl || '',
      // Champs « humains » : posés au rattachement manuel, jamais écrasés par une
      // synchronisation ultérieure (qui ne connaît que Stripe).
      label: label ?? before?.label ?? '',
      addedManually: addedManually ?? before?.addedManually ?? false,
      snapshot: {
        number: stripeInvoice.number,
        total: amountTTC,
        status: stripeInvoice.status,
        billingReason: stripeInvoice.billing_reason,
      },
      environment: config.env,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { invoice, created: !before };
}

/**
 * Backfill/synchronise TOUTES les factures Stripe d'un contrat (via son Customer).
 * Idempotent ; ne crée aucune facture côté Stripe ; rafraîchit les liens. Filet de
 * sécurité pour un webhook manqué.
 */
export async function syncContractInvoices(contract) {
  /**
   * L6.3B — LA LISTE VIENT DU PANEL.
   *
   * Le projet listait les factures du `customerId` qu'il portait en fiche.
   * Il nomme désormais son CONTRAT ; le Panel remonte au client par le lien
   * d'appartenance et ne rend que les factures de celui-là.
   *
   * Le contrôle local sur `customerId` survit, mais il a changé de sens : il ne
   * désigne plus rien, il dit seulement « ce contrat n'a jamais rien payé »,
   * ce qui évite un aller-retour inutile.
   */
  if (!contract.stripe?.customerId) return { count: 0, upserted: 0 };
  let list = [];
  try {
    const vue = await listInvoicesViaPanel({
      contractRef: String(contract._id),
      operationId: `invoice-sync-${contract._id}`,
    });
    list = vue.invoices ?? [];
  } catch {
    /**
     * Panel injoignable ou contrat non possédé : on ne synchronise pas, et on
     * ne retombe sur RIEN. Ce n'est pas un repli manquant, c'est le point — la
     * synchronisation est un FILET, et un filet qui s'ouvrirait tout seul sur
     * la clé locale ne serait plus un filet.
     */
    return { count: 0, upserted: 0 };
  }
  let upserted = 0;
  for (const inv of list) {
    const { created } = await upsertInvoiceFromStripe(inv, contract);
    if (created) upserted += 1;
  }
  return { count: list.length, upserted };
}

const STRIPE_INVOICE_ID_RE = /\b(in_[A-Za-z0-9]+)\b/;
const HOSTED_INVOICE_HOSTS = ['invoice.stripe.com'];
const DASHBOARD_HOSTS = ['dashboard.stripe.com'];

/**
 * Extrait l'identifiant de facture d'une saisie DEV.
 *
 * Trois formes acceptées :
 *  - l'identifiant brut (`in_…`) ;
 *  - une URL de dashboard (`dashboard.stripe.com/…/invoices/in_…`) — contient l'id ;
 *  - une URL de facture hébergée (`invoice.stripe.com/i/acct_…/…`) — NE contient
 *    PAS l'id : elle devra être résolue via l'API (voir `resolveInvoiceFromUrl`).
 *
 * @returns {{kind:'id', id:string} | {kind:'hosted', url:string}}
 * @throws {ApiError} si la saisie n'est pas exploitable
 */
export function parseInvoiceReference(input) {
  const raw = String(input || '').trim();
  if (!raw) throw ApiError.badRequest('Lien ou identifiant de facture requis.');

  // Identifiant direct ou URL contenant l'identifiant.
  const direct = raw.match(STRIPE_INVOICE_ID_RE);

  let url = null;
  try {
    url = new URL(raw);
  } catch {
    /* pas une URL : on attend alors un identifiant brut */
  }

  if (!url) {
    if (direct) return { kind: 'id', id: direct[1] };
    throw ApiError.badRequest(
      "Saisie non reconnue. Collez le lien Stripe de la facture (hosted invoice ou dashboard), ou son identifiant « in_… »."
    );
  }

  if (url.protocol !== 'https:') {
    throw ApiError.badRequest('Le lien doit être en https.');
  }
  const host = url.hostname.toLowerCase();
  const known = [...HOSTED_INVOICE_HOSTS, ...DASHBOARD_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
  if (!known) {
    throw ApiError.badRequest(`Domaine inattendu (${host}). Attendu : invoice.stripe.com ou dashboard.stripe.com.`);
  }
  if (direct) return { kind: 'id', id: direct[1] };
  if (HOSTED_INVOICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { kind: 'hosted', url: raw };
  }
  throw ApiError.badRequest("Ce lien ne contient aucun identifiant de facture « in_… ».");
}

/** Compare deux URLs hébergées en ignorant la query (Stripe y ajoute un token). */
function sameHostedUrl(a, b) {
  const strip = (u) => {
    try {
      const x = new URL(u);
      return `${x.hostname}${x.pathname}`.replace(/\/$/, '').toLowerCase();
    } catch {
      return String(u || '').toLowerCase();
    }
  };
  return Boolean(a) && Boolean(b) && strip(a) === strip(b);
}

/**
 * Résout une facture Stripe à partir d'un lien/identifiant fourni par un DEV,
 * puis la reflète en base et la rattache à son contrat.
 *
 * Tout est DÉRIVÉ de Stripe (montants, statut, dates, numéro, liens, contrat) :
 * le seul champ saisi est le `label`, un nom libre d'affichage.
 *
 * Une URL hébergée ne contient pas l'identifiant : on la retrouve alors en
 * parcourant les factures des contrats connus. La recherche est BORNÉE — si le
 * lien n'est pas trouvé, on le dit clairement plutôt que de balayer sans fin.
 */
export async function attachInvoiceFromUrl(input, { label = '' } = {}) {
  const ref = parseInvoiceReference(input);

  /**
   * L6.3B — LES DEUX FORMES SE RÉSOLVENT PAR LE MÊME CHEMIN.
   *
   * Le projet retrouvait une facture par son identifiant en la lisant
   * directement chez Stripe : il présentait donc un `in_…` tapé à la main, et
   * le compte répondait — y compris pour une facture qui n'était à aucun de ses
   * contrats. C'était le seul endroit du parc où un identifiant saisi valait
   * autorisation.
   *
   * Les deux formes passent désormais par les factures des contrats CONNUS,
   * listées par le Panel, contrat par contrat. Une facture qui n'appartient à
   * aucun d'eux n'est pas trouvée — ce qui est la bonne réponse, et non une
   * limitation.
   *
   * Le coût est réel : la recherche parcourt les contrats au lieu d'un appel
   * direct. Elle reste bornée aux contrats ayant un client, et c'est un outil
   * d'administration, pas un chemin utilisateur.
   */
  const stripeInvoice = await findInvoiceParmiLesContrats(ref);
  if (!stripeInvoice) {
    throw ApiError.badRequest(
      ref.kind === 'id'
        ? `Facture ${ref.id} introuvable parmi les factures des contrats connus (mode actif).`
        : "Cette facture hébergée n'a pas été retrouvée parmi les contrats connus. Collez plutôt son identifiant « in_… » (visible dans le dashboard Stripe).",
    );
  }

  const contract = await resolveContractForInvoice(stripeInvoice);
  if (!contract) {
    throw ApiError.badRequest(
      "Cette facture Stripe n'est rattachable à aucun contrat (client Stripe inconnu de l'application)."
    );
  }

  const { invoice, created } = await upsertInvoiceFromStripe(stripeInvoice, contract, {
    label: String(label || '').trim(),
    addedManually: true,
  });
  return { invoice, created, contract };
}

/** Recherche une facture par son URL hébergée, parmi les Customers connus. */
/**
 * Retrouve une facture PARMI LES CONTRATS CONNUS — par identifiant ou par URL.
 *
 * Un seul parcours pour les deux formes : la question posée est la même —
 * « cette facture est-elle à l'un de nos contrats ? » — et y répondre
 * différemment selon la façon dont l'utilisateur l'a désignée aurait produit
 * deux niveaux d'autorisation pour un même objet.
 */
async function findInvoiceParmiLesContrats(ref) {
  const contracts = await Contract.find({ 'stripe.customerId': { $ne: null } }).select('_id stripe.customerId');
  for (const c of contracts) {
    let list = [];
    try {
      const vue = await listInvoicesViaPanel({
        contractRef: String(c._id),
        operationId: `invoice-search-${c._id}`,
      });
      list = vue.invoices ?? [];
    } catch {
      continue; // un contrat illisible ne doit pas interrompre la recherche
    }
    const hit = ref.kind === 'id'
      ? list.find((i) => i.invoiceId === ref.id)
      : list.find((i) => sameHostedUrl(i.hostedInvoiceUrl, ref.url));
    if (hit) return hit;
  }
  return null;
}

/** Synchronise les factures de tous les contrats ayant un Customer Stripe. */
export async function syncAllInvoices() {
  const contracts = await Contract.find({ archived: false, 'stripe.customerId': { $ne: null } });
  const report = [];
  for (const c of contracts) {
    const res = await syncContractInvoices(c);
    report.push({ reference: c.reference, count: res.count, upserted: res.upserted });
  }
  return { contracts: report.length, report };
}
