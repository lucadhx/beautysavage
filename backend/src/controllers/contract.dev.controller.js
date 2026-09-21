import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { Contract } from '../models/Contract.model.js';
import { Payment } from '../models/Payment.model.js';
import * as svc from '../services/contract.service.js';
import * as testTools from '../services/contractTestTools.service.js';
import { reconcileContract } from '../services/reconciliation.service.js';
import { reconcileLaunchFeePayment } from '../services/payment.service.js';
import { reconcileSubscription } from '../services/subscription.service.js';
import { syncContractInvoices } from '../services/billing.service.js';
import { Invoice } from '../models/Invoice.model.js';
import { reconcileSiteStatus } from '../services/siteEnforcement.service.js';
import {
  resolveProjectMediaAuthority, relayToProjectAuthority,
} from '../services/media/projectMediaAuthority.js';

/**
 * Contrats — parcours DEV (création, configuration, validation, signature,
 * résiliation, réconciliation). DEV uniquement (gating dans la route).
 */

async function load(req) {
  const contract = await Contract.findById(req.params.id);
  if (!contract) throw ApiError.notFound('Contrat introuvable.');
  return contract;
}

export const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.archived !== 'true') filter.archived = false;
  const contracts = await Contract.find(filter).sort({ createdAt: -1 });
  return ok(res, contracts.map((c) => svc.serializeContract(c, { role: 'DEV' })));
});

export const getOne = asyncHandler(async (req, res) => {
  const contract = await load(req);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const create = asyncHandler(async (req, res) => {
  const contract = await svc.createContract(req.user, { name: req.body?.name });
  return created(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const updateDraft = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.updateDraft(contract, req.body, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

/**
 * Politique de grâce en cas d'impayé — modifiable à TOUT stade du contrat,
 * y compris pendant un incident. Voir `updatePaymentGracePolicy`.
 */
export const updatePaymentGracePolicy = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.updatePaymentGracePolicy(contract, req.body, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const remove = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await svc.removeOrArchive(contract, req.user);
  return ok(res, result);
});

export const uploadDocument = asyncHandler(async (req, res) => {
  const contract = await load(req);
  if (!req.file?.buffer) throw ApiError.badRequest('Fichier PDF manquant.');

  /**
   * L'ÉCRITURE VA À L'AUTORITÉ, JAMAIS AU DISQUE DE PASSAGE.
   *
   * ══ POURQUOI LE MÊME MODULE QUE LES IMAGES ═══════════════════════════════
   *
   * Un PDF déposé depuis un poste de développement s'écrivait sur CE poste. Le
   * Manager déployé ne le voyait jamais, et son éditeur de zones ouvrait un
   * document introuvable — le symptôme se lisait comme un bug d'affichage
   * alors que le fichier n'avait tout simplement jamais traversé.
   *
   * Les médias image avaient déjà tranché : une seule instance STOCKE — le
   * backend déployé — les autres RELAIENT. On applique la même règle plutôt
   * que d'inventer une synchronisation propre aux contrats, qui aurait ses
   * propres conflits, son propre rattrapage et sa propre façon d'échouer.
   *
   * La VALIDATION reste chez l'autorité : c'est elle qui vérifie les octets
   * `%PDF`, le chiffrement, le nombre de pages et calcule l'empreinte. La
   * valider ici en plus donnerait deux verdicts pour un seul fichier.
   */
  const { isAuthority, authority } = await resolveProjectMediaAuthority();

  if (!isAuthority && authority) {
    const corps = new FormData();
    corps.append(
      'file',
      new Blob([req.file.buffer], { type: req.file.mimetype || 'application/pdf' }),
      req.file.originalname || 'contrat.pdf',
    );

    const amont = await relayToProjectAuthority(authority, req.originalUrl, {
      method: 'POST',
      headers: req.headers.authorization ? { authorization: req.headers.authorization } : {},
      body: corps,
    }).catch(() => null);

    /**
     * AUCUNE ÉCRITURE LOCALE SI LE RELAIS ÉCHOUE. Le repli recréerait les deux
     * vérités qu'on vient de supprimer — et celle-ci porterait un contrat.
     */
    if (!amont) {
      throw ApiError.badRequest(
        'Le stockage documentaire du projet est injoignable : l’import est refusé. '
        + 'Rien n’a été écrit localement — un contrat n’existe qu’à un seul endroit.',
        { code: 'PROJECT_DOCUMENT_AUTHORITY_UNREACHABLE' },
      );
    }

    const charge = await amont.json().catch(() => null);
    if (!amont.ok) {
      throw new ApiError(amont.status, charge?.message || 'Import du PDF refusé par l’autorité du projet.');
    }
    /** On rend la réponse de l'AUTORITÉ : c'est elle qui détient l'état vrai. */
    return res.status(amont.status).json(charge);
  }

  await svc.setDocument(contract, req.file.buffer, req.file.originalname, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const updateSignatureConfiguration = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.setSignatureConfiguration(contract, req.body.zones || [], req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const validate = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.validateContract(contract, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

export const startDevSignature = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const { signatureLink } = await svc.startDevSignature(contract, req.user);
  return ok(res, { contract: svc.serializeContract(contract, { role: 'DEV' }), signatureLink });
});

export const cancel = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.requestCancellation(contract, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

/**
 * RÉSILIATION IMMÉDIATE — l'exception administrative, y compris en PROD.
 *
 * ══ POURQUOI UNE ROUTE À PART ══════════════════════════════════════════════
 *
 * `POST /:id/cancel` reste la résiliation ORDINAIRE, avec sa doctrine
 * inchangée : immédiate en recette, à l'échéance en production. Les fondre
 * ferait dépendre l'effet d'un drapeau, et un drapeau finit toujours par être
 * envoyé par erreur.
 *
 * Deux verbes distincts, deux intentions distinctes : « je résilie ce contrat »
 * et « je corrige un contrat qui n'aurait pas dû exister ».
 *
 * Le routeur est déjà réservé aux comptes DEV (`authorize(ROLES.DEV)`), mais le
 * SERVICE revérifie : un contrôle qui ne vivrait que dans la route laisserait
 * passer tout autre appelant interne.
 */
export const cancelImmediately = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const issue = await svc.cancelContractImmediately(contract, req.user, {
    reason: req.body?.reason ?? null,
  });
  const fresh = await Contract.findById(contract._id);
  return ok(res, {
    contract: svc.serializeContract(fresh, { role: 'DEV' }),
    // « Déjà terminé » n'est pas une erreur : l'appelant doit pouvoir le dire
    // à l'écran sans le présenter comme un échec.
    alreadyEnded: issue.alreadyEnded,
    previousStatus: issue.previousStatus ?? null,
  });
});

export const reconcile = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await reconcileContract(contract, { actor: req.user });
  const fresh = await Contract.findById(contract._id);
  return ok(res, { result, contract: svc.serializeContract(fresh, { role: 'DEV' }) });
});

/** POST /:id/sync — synchronise le statut Yousign du contrat (filet de sécurité). */
export const sync = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await reconcileContract(contract, { actor: req.user });
  const fresh = await Contract.findById(contract._id);
  return ok(res, { result, contract: svc.serializeContract(fresh, { role: 'DEV' }) });
});

/** POST /:id/restart-signature — relance une signature en échec. */
export const restartSignature = asyncHandler(async (req, res) => {
  const contract = await load(req);
  await svc.restartSignature(contract, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'DEV' }));
});

/** GET /:id/timeline — journal d'événements (audit) du contrat. */
export const timeline = asyncHandler(async (req, res) => {
  const contract = await load(req);
  return ok(res, await svc.getContractTimeline(contract._id));
});

/** Raccourcit un identifiant Stripe pour l'affichage DEV (jamais de clé/secret). */
function shortenId(id, keep = 8) {
  if (!id) return null;
  const s = String(id);
  return s.length <= keep + 4 ? s : `${s.slice(0, keep)}…${s.slice(-4)}`;
}

/** Détail d'un paiement pour le DEV (support) — identifiants Stripe raccourcis. */
function serializePaymentDev(p) {
  return {
    _id: p._id,
    type: p.type,
    status: p.status,
    providerMode: p.providerMode,
    applicationEnvironment: p.applicationEnvironment,
    amountExcludingTax: p.amountExcludingTax,
    taxAmount: p.taxAmount,
    amountIncludingTax: p.amountIncludingTax,
    currency: p.currency,
    checkoutSessionId: shortenId(p.stripe?.checkoutSessionId),
    paymentIntentId: shortenId(p.stripe?.paymentIntentId),
    attempt: p.attempt,
    lastError: p.lastError,
    paidAt: p.paidAt,
    failedAt: p.failedAt,
    cancelledAt: p.cancelledAt,
    refundedAt: p.refundedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** GET /:id/payments — journal des paiements du contrat (DEV, support). */
export const payments = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const list = await Payment.find({ contractId: contract._id }).sort({ createdAt: -1 });
  return ok(res, list.map(serializePaymentDev));
});

/**
 * POST /:id/sync-payment — synchronise les frais de lancement avec Stripe (filet
 * de sécurité). Ne crée JAMAIS de paiement : lit la session/PaymentIntent et
 * corrige l'état. DEV uniquement.
 */
export const syncPayment = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await reconcileLaunchFeePayment(contract, { actor: req.user });
  const fresh = await Contract.findById(contract._id);
  const list = await Payment.find({ contractId: contract._id }).sort({ createdAt: -1 });
  return ok(res, { result, contract: svc.serializeContract(fresh, { role: 'DEV' }), payments: list.map(serializePaymentDev) });
});

/**
 * POST /:id/sync-subscription — synchronise l'abonnement avec Stripe (statut,
 * période, résiliation, fin) + réconcilie le site. Ne crée jamais d'abonnement.
 * DEV uniquement.
 */
export const syncSubscription = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await reconcileSubscription(contract, { actor: req.user });
  await reconcileSiteStatus({ actor: req.user });
  const fresh = await Contract.findById(contract._id);
  return ok(res, { result, contract: svc.serializeContract(fresh, { role: 'DEV' }) });
});

/**
 * POST /:id/sync-invoices — backfill des factures Stripe du contrat (via son
 * Customer). Idempotent ; ne crée aucune facture côté Stripe. DEV uniquement.
 */
export const syncInvoices = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const result = await syncContractInvoices(contract);
  const invoices = await Invoice.find({ contractId: contract._id }).sort({ createdAt: -1 });
  return ok(res, { result, invoices });
});

/**
 * OUTILS DE RECETTE (ENV=TEST uniquement) — le garde-fou vit dans le service
 * (`assertTestEnvironment`), pas ici : masquer un bouton ne protège rien.
 */

/** Termine immédiatement le contrat, comme si l'échéance venait d'arriver. */
export const endNow = asyncHandler(async (req, res) => {
  const contract = await load(req);
  const { contract: fresh } = await testTools.endContractNow(contract, req.user);
  return ok(res, svc.serializeContract(fresh, { role: 'DEV' }));
});

/** Remet la recette à zéro : aucun contrat, aucun paiement, aucune suspension. */
export const resetRecette = asyncHandler(async (req, res) => {
  const summary = await testTools.resetRecette(req.user);
  return ok(res, summary);
});
