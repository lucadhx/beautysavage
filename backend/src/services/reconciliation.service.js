import { Contract } from '../models/Contract.model.js';
import { logger } from '../utils/logger.js';
import { logContractAudit } from '../models/ContractAuditLog.model.js';
import { reconcileSiteStatus } from './siteEnforcement.service.js';
import {
  getSignatureRequestStatus, mapRequestStatus, downloadSignedDocument, downloadSignatureCertificate,
} from './signature/signature.service.js';
import { signatureOf, setSignatureField } from './signature/signatureRecord.js';
import { reconcileLaunchFeePayment } from './payment.service.js';
import { reconcileSubscription } from './subscription.service.js';
import { syncContractInvoices } from './billing.service.js';
import { storeSignedPdf, storeSignatureCertificate } from './contractDocument.service.js';
import * as sm from './contractStateMachine.js';
import {
  CONTRACT_STATUS as S,
  SIGNATURE_STATUS,
  SUBSCRIPTION_ENTITLED_STATUSES,
  SITE_SERVEABLE_STATUSES,
  AUDIT_ACTOR_TYPE,
  CONTRACT_AUDIT_ACTION,
} from '../utils/contractConstants.js';

/**
 * Réconciliation : FILET DE SÉCURITÉ (pas un substitut aux webhooks). Les
 * webhooks peuvent être retardés/perdus ; ce moteur interroge Yousign & Stripe,
 * corrige les états internes dérivables, réconcilie le statut du site, et produit
 * un rapport. Idempotent.
 */

const NON_TERMINAL = [
  S.PENDING_DEV_SIGNATURE,
  S.INACTIVE,
  S.ACTIVATION_IN_PROGRESS,
  S.ACTIVE,
  S.CANCEL_AT_PERIOD_END,
];

function toDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

/** Réconcilie UN contrat. Renvoie un résumé des corrections. */
export async function reconcileContract(contract, { actor } = {}) {
  const changes = [];

  // --- Yousign ---
  const sig = signatureOf(contract);
  if (sig.requestId && sig.status !== SIGNATURE_STATUS.DONE) {
    try {
      // Lecture PAR LE PANEL : aucune clé locale, aucun repli.
      const sr = await getSignatureRequestStatus(sig.requestId);
      const mapped = mapRequestStatus(sr?.status);
      if (mapped && mapped !== sig.status) {
        setSignatureField(contract, 'status', mapped);
        changes.push(`signature:${mapped}`);
      }
      if (mapped === SIGNATURE_STATUS.DONE) {
        if (!sig.devSignedAt) setSignatureField(contract, 'devSignedAt', new Date());
        if (!sig.clientSignedAt) setSignatureField(contract, 'clientSignedAt', new Date());
        if (contract.status === S.PENDING_DEV_SIGNATURE) {
          contract.status = sm.assertTransition(contract.status, S.INACTIVE);
          changes.push('status:INACTIVE');
        }
        if (!contract.document.signedFilename && sig.documentId) {
          try {
            const buf = await downloadSignedDocument(sig.requestId, sig.documentId);
            const meta = await storeSignedPdf(contract._id, buf, { filename: 'signed.pdf' });
            contract.document.signedFilename = meta.signedFilename;
            contract.document.signedChecksum = meta.signedChecksum;
            contract.document.signedFetchedAt = meta.signedFetchedAt;
            changes.push('signedPdf:fetched');
          } catch {
            /* réessai au prochain passage */
          }
        }
        /**
         * LA PREUVE D'AUDIT RATTRAPÉE SÉPARÉMENT.
         *
         * Elle a son propre `if` parce qu'elle a son propre sort : le contrat
         * signé peut être arrivé et pas le certificat, ou l'inverse. Les
         * imbriquer ferait qu'un dossier ayant déjà son PDF n'irait jamais
         * chercher sa preuve — et personne ne le remarquerait avant d'en avoir
         * besoin.
         *
         * `downloadSignatureCertificate` rend `null` quand il n'y en a pas
         * (demande non achevée, ou fournisseur historique) : la réconciliation
         * repassera sans rien consigner, ce qui est le comportement voulu.
         */
        if (!contract.document.certificateFilename) {
          try {
            const certificat = await downloadSignatureCertificate(sig.requestId);
            if (certificat) {
              const meta = await storeSignatureCertificate(contract._id, certificat.buffer, {
                contentType: certificat.contentType,
              });
              contract.document.certificateFilename = meta.certificateFilename;
              contract.document.certificateChecksum = meta.certificateChecksum;
              contract.document.certificateContentType = meta.certificateContentType;
              contract.document.certificateFetchedAt = meta.certificateFetchedAt;
              changes.push('certificate:fetched');
            }
          } catch {
            /* réessai au prochain passage */
          }
        }
      } else if (
        [SIGNATURE_STATUS.DECLINED, SIGNATURE_STATUS.EXPIRED, SIGNATURE_STATUS.CANCELED].includes(mapped) &&
        [S.PENDING_DEV_SIGNATURE, S.INACTIVE, S.ACTIVATION_IN_PROGRESS].includes(contract.status)
      ) {
        // Signature refusée/expirée/annulée -> état métier cohérent (FAILED).
        contract.status = sm.assertTransition(contract.status, S.FAILED);
        changes.push('status:FAILED');
      }
    } catch (err) {
      logger.warn(`[reconcile] signature ${contract.reference}: ${err.message}`);
    }
  }

  // --- Stripe frais de lancement (paiement unique) ---
  try {
    const res = await reconcileLaunchFeePayment(contract, { actor });
    if (res.changes?.length) changes.push(...res.changes);
  } catch (err) {
    logger.warn(`[reconcile] Stripe frais ${contract.reference}: ${err.message}`);
  }

  // --- Stripe abonnement (statut, période, résiliation, fin -> ENDED + site) ---
  try {
    const subRes = await reconcileSubscription(contract, { actor });
    if (subRes.changes?.length) changes.push(...subRes.changes);
  } catch (err) {
    logger.warn(`[reconcile] Stripe abonnement ${contract.reference}: ${err.message}`);
  }

  // --- Factures Stripe (miroir : numéro + liens PDF/hosted) ---
  try {
    const inv = await syncContractInvoices(contract);
    if (inv.upserted) changes.push(`invoices:+${inv.upserted}`);
  } catch (err) {
    logger.warn(`[reconcile] Stripe factures ${contract.reference}: ${err.message}`);
  }

  if (changes.length) {
    await contract.save();
    await logContractAudit({
      contractId: contract._id,
      action: CONTRACT_AUDIT_ACTION.RECONCILED,
      actorType: actor ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.SYSTEM,
      actorId: actor?._id || null,
      metadataSafe: { changes },
    });
  }
  return { reference: contract.reference, changes };
}

/**
 * Synchronisation YOUSIGN : relit tous les contrats non terminés ayant une
 * demande de signature, vérifie leur statut Yousign et corrige les états. Ne
 * touche PAS le site ni Stripe (dans le cadre de la signature seule).
 */
export async function syncAllContracts({ actor } = {}) {
  const contracts = await Contract.find({
    status: { $in: NON_TERMINAL },
    archived: false,
    /**
     * LES DEUX BLOCS SONT INTERROGÉS.
     *
     * Un contrat ouvert avant la bascule porte sa demande dans `yousign`, un
     * contrat récent dans `signature`. Ne chercher que le second aurait cessé
     * de réconcilier la moitié du parc — en silence, puisqu'un contrat non
     * trouvé n'est pas un contrat en erreur.
     */
    $or: [
      { 'signature.requestId': { $ne: null } },
      { 'yousign.signatureRequestId': { $ne: null } },
    ],
  });
  const report = [];
  for (const c of contracts) report.push(await reconcileContract(c, { actor }));
  return { contracts: report.length, corrected: report.filter((r) => r.changes.length).length, report };
}

/**
 * Synchronisation des PAIEMENTS (frais de lancement) : relit Stripe pour chaque
 * contrat ayant une tentative de paiement ouverte (PENDING/PROCESSING) et corrige
 * l'état. Ne crée jamais de paiement. Idempotente ; rapport sans secret.
 */
export async function syncAllPayments({ actor } = {}) {
  const { Payment } = await import('../models/Payment.model.js');
  const contractIds = await Payment.distinct('contractId', {
    type: 'LAUNCH_FEE',
    status: { $in: ['PENDING', 'PROCESSING'] },
  });
  const report = [];
  for (const id of contractIds) {
    const contract = await Contract.findById(id);
    if (!contract) continue;
    const res = await reconcileLaunchFeePayment(contract, { actor });
    report.push({ reference: contract.reference, changes: res.changes });
  }
  return { contracts: report.length, corrected: report.filter((r) => r.changes.length).length, report };
}

/**
 * Synchronisation des ABONNEMENTS : relit Stripe pour chaque contrat ayant un
 * abonnement non terminal et corrige statut/période/résiliation/fin, puis
 * réconcilie le site. Idempotente ; rapport sans secret.
 */
export async function syncAllSubscriptions({ actor } = {}) {
  const contracts = await Contract.find({
    status: { $in: NON_TERMINAL },
    archived: false,
    'stripe.subscription.subscriptionId': { $ne: null },
  });
  const report = [];
  for (const c of contracts) {
    const res = await reconcileSubscription(c, { actor });
    report.push({ reference: c.reference, changes: res.changes });
  }
  await reconcileSiteStatus({ actor });
  return { contracts: report.length, corrected: report.filter((r) => r.changes.length).length, report };
}

/**
 * Vérifie la COHÉRENCE entitlement contrat <-> abonnement <-> site (lecture seule).
 * Détecte : abonnement Stripe actif mais contrat incohérent ; contrat actif sans
 * abonnement valide (si requis) ; contrat terminé mais site encore actif ;
 * résiliation demandée non reflétée. Renvoie une liste d'anomalies (sans secret).
 */
export async function verifyEntitlements() {
  const contracts = await Contract.find({ archived: false });
  const anomalies = [];
  const site = await import('../models/SiteStatus.model.js').then((m) => getSingletonSite(m.SiteStatus));
  for (const c of contracts) {
    const sub = c.stripe?.subscription || {};
    const subRequired = Boolean(c.pricing?.subscription?.enabled);
    const entitledSub = SUBSCRIPTION_ENTITLED_STATUSES.includes(sub.status);
    if ([S.ACTIVE, S.CANCEL_AT_PERIOD_END].includes(c.status) && subRequired && !entitledSub) {
      anomalies.push({ reference: c.reference, issue: 'CONTRACT_LIVE_WITHOUT_VALID_SUBSCRIPTION', status: c.status, subscription: sub.status });
    }
    if (entitledSub && ![S.ACTIVE, S.CANCEL_AT_PERIOD_END, S.ACTIVATION_IN_PROGRESS, S.INACTIVE].includes(c.status)) {
      anomalies.push({ reference: c.reference, issue: 'SUBSCRIPTION_ACTIVE_BUT_CONTRACT_INCOHERENT', status: c.status, subscription: sub.status });
    }
    if (sub.cancelAtPeriodEnd && c.status === S.ACTIVE) {
      anomalies.push({ reference: c.reference, issue: 'CANCELLATION_REQUESTED_NOT_REFLECTED', status: c.status });
    }
  }
  const serveable = contracts.some((c) => SITE_SERVEABLE_STATUSES.includes(c.status));
  if (site && site.status === 'ACTIVE' && !serveable && site.suspensionSource !== 'TECHNICAL') {
    anomalies.push({ issue: 'SITE_ACTIVE_WITHOUT_SERVEABLE_CONTRACT' });
  }
  return { checked: contracts.length, anomalies };
}

async function getSingletonSite(SiteStatus) {
  const { getSingleton } = await import('../utils/singleton.js');
  return getSingleton(SiteStatus);
}

/** Réconcilie tous les contrats non terminés + le statut du site. */
export async function reconcileAll({ actor } = {}) {
  const contracts = await Contract.find({ status: { $in: NON_TERMINAL }, archived: false });
  const report = [];
  for (const c of contracts) {
    report.push(await reconcileContract(c, { actor }));
  }
  const site = await reconcileSiteStatus({ actor });
  return { contracts: report.length, corrected: report.filter((r) => r.changes.length).length, report, siteStatus: site.status };
}
