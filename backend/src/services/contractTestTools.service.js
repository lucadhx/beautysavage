import { Contract } from '../models/Contract.model.js';
import { Payment } from '../models/Payment.model.js';
import { Invoice } from '../models/Invoice.model.js';
import { ContractAuditLog, logContractAudit } from '../models/ContractAuditLog.model.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { signatureOf } from './signature/signatureRecord.js';
import { logger } from '../utils/logger.js';
import * as subscriptionSvc from './subscription.service.js';
import { cancelSubscriptionViaPanel } from './stripe/checkoutCapability.js';
import { cancelSignatureRequest } from './signature/signature.service.js';
import { deleteContractStorage } from './contractDocument.service.js';
import { reconcileSiteStatus, setTechnicalSuspension } from './siteEnforcement.service.js';
import {
  CONTRACT_STATUS as S,
  AUDIT_ACTOR_TYPE,
  CONTRACT_AUDIT_ACTION,
  SUBSCRIPTION_STATUS,
} from '../utils/contractConstants.js';

/**
 * Outils de RECETTE — disponibles UNIQUEMENT en ENV=TEST.
 *
 * Ils n'existent que pour rejouer un parcours commercial sans attendre une fin
 * de période réelle (un mois). Ils ne créent aucune règle métier : ils
 * réutilisent les services existants pour atteindre un état que la production
 * atteindrait naturellement.
 *
 * ⚠️ Le garde-fou est ICI, dans le service — pas dans l'interface. Masquer un
 * bouton n'empêche personne d'appeler l'API : `assertTestEnvironment()` est
 * appelée en tête de CHAQUE outil, et couverte par des tests.
 */

/** Fail-closed : tout ce qui suit est interdit hors TEST, y compris via l'API. */
export function assertTestEnvironment() {
  if (config.env !== 'TEST') {
    throw ApiError.forbidden("Outil de recette indisponible : réservé à l'environnement TEST.");
  }
}

/**
 * Termine immédiatement le contrat, comme si l'échéance venait d'arriver.
 *
 * Passe par `settleFromSubscription` — le MÊME chemin que le webhook Stripe de
 * fin d'abonnement : statuts, timeline, suspension du site et factures suivent
 * donc exactement la production. Aucune écriture directe en base.
 */
export async function endContractNow(contract, actor) {
  assertTestEnvironment();
  if (![S.ACTIVE, S.CANCEL_AT_PERIOD_END].includes(contract.status)) {
    throw ApiError.badRequest(
      `Seul un contrat actif peut être terminé immédiatement (statut actuel : ${contract.status}).`
    );
  }

  const subId = contract.stripe?.subscription?.subscriptionId;
  const now = Math.floor(Date.now() / 1000);

  // Couper réellement l'abonnement chez Stripe (mode TEST) pour que l'état
  // distant corresponde au local — sinon la prochaine réconciliation, qui relit
  // Stripe, ressusciterait l'abonnement et contredirait l'écran.
  if (subId) {
    try {
      // L6.2G — même porte que le parcours réel : outil de recette ou non, une
      // coupure d'abonnement passe par l'ownership et le registre du Panel.
      await cancelSubscriptionViaPanel({ subscriptionId: subId, mode: 'NOW' });
    } catch (err) {
      logger.warn(`Recette : annulation Stripe immédiate impossible (${err?.message}). Poursuite en local.`);
    }
  }

  // Abonnement « canceled » : forme d'un objet Stripe de fin d'abonnement.
  await subscriptionSvc.settleFromSubscription(
    contract,
    {
      id: subId || contract.stripe?.subscription?.subscriptionId || null,
      status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: now,
      canceled_at: now,
    },
    { actor }
  );

  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CONTRACT_ENDED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id || null,
    metadataSafe: { tool: 'endContractNow', environment: config.env },
  });

  const fresh = await Contract.findById(contract._id);
  return { contract: fresh, subscriptionStatus: fresh.stripe?.subscription?.status || SUBSCRIPTION_STATUS.ENDED };
}

/**
 * Remet la recette à zéro : plus aucun contrat, aucun paiement, aucune facture,
 * aucune suspension technique — le site revient à « aucun contrat ».
 *
 * Les demandes de signature et abonnements Stripe/Yousign créés en TEST sont
 * annulés côté fournisseur AVANT la purge locale : sans cela, la sandbox
 * accumulerait des demandes orphelines à chaque itération de recette.
 */
export async function resetRecette(actor) {
  assertTestEnvironment();

  const contracts = await Contract.find({});
  const summary = { contracts: 0, payments: 0, invoices: 0, auditEvents: 0, signaturesCancelled: 0, stripeCancelled: 0 };

  for (const contract of contracts) {
    // 1. Couper l'abonnement Stripe (best-effort : un échec distant ne doit pas
    //    bloquer la remise à zéro locale — on le journalise).
    const subId = contract.stripe?.subscription?.subscriptionId;
    if (subId) {
      try {
        await cancelSubscriptionViaPanel({ subscriptionId: subId, mode: 'NOW' });
        summary.stripeCancelled += 1;
      } catch (err) {
        logger.warn(`Recette : abonnement Stripe ${subId} non annulé (${err?.message}).`);
      }
    }

    // 2. Annuler/supprimer la demande de signature Yousign.
    const srId = signatureOf(contract).requestId;
    if (srId) {
      try {
        /**
         * ANNULER SUFFIT — la suppression n'est plus exposée (R10.5C).
         *
         * Supprimer une demande n'est possible que sur un BROUILLON, et il
         * n'en subsiste plus : le Panel nettoie les siens dans l'acte
         * d'ouverture. Ce qu'un outil de recette doit pouvoir faire, c'est
         * interrompre une demande VIVANTE — et c'est exactement .
         */
        await cancelSignatureRequest(srId, 'recette');
        summary.signaturesCancelled += 1;
      } catch (err) {
        logger.warn(`Recette : demande de signature ${srId} non supprimée (${err?.message}).`);
      }
    }

    // 3. Purge locale du contrat et de ses documents.
    await deleteContractStorage(contract._id);
    const [pay, inv, audits] = await Promise.all([
      Payment.deleteMany({ contractId: contract._id }),
      Invoice.deleteMany({ contractId: contract._id }),
      ContractAuditLog.deleteMany({ contractId: contract._id }),
    ]);
    summary.payments += pay.deletedCount || 0;
    summary.invoices += inv.deletedCount || 0;
    summary.auditEvents += audits.deletedCount || 0;
    await Contract.deleteOne({ _id: contract._id });
    summary.contracts += 1;
  }

  // 4. Lever la suspension TECHNIQUE (indépendante du contrat, donc jamais
  //    levée par l'enforcement) : c'est précisément ce qui rendait la recette
  //    pénible — un site resté suspendu après activation.
  await setTechnicalSuspension({ active: false, reason: '', actorEmail: actor?.email, actor });

  // 5. Réaligner le statut du site sur la réalité : aucun contrat.
  await reconcileSiteStatus({ actor });

  logger.info(
    `Recette réinitialisée (${summary.contracts} contrat(s), ${summary.payments} paiement(s), ${summary.invoices} facture(s)).`
  );
  return summary;
}
