// LE RETOUR DE SIGNATURE — appliqué localement, jamais redemandé (R10.5C).
//
// ══ POURQUOI CET APPLICATEUR EXISTE ═════════════════════════════════════════
//
// Le webhook Yousign n'arrive plus ici : il arrive au Panel, qui le vérifie,
// résout l'appartenance, le normalise et le projette DURABLEMENT par le pont.
//
// Sans cet applicateur, le fait serait poussé dans le vide : un contrat signé
// resterait « en cours » côté projet, et personne ne saurait pourquoi.
//
// ══ CE QU'IL NE FAIT JAMAIS ═════════════════════════════════════════════════
//
// Il n'appelle aucun fournisseur, ne lit aucune credential, et ne crée aucune
// ressource Yousign. Il APPLIQUE un fait déjà établi. La seule sortie qu'il
// s'autorise est la récupération du document signé — et elle passe par la
// capacité du Panel, comme tout le reste.
//
// ══ IDEMPOTENT ET MONOTONE ══════════════════════════════════════════════════
//
// Le même fait peut arriver deux fois (rejeu du fournisseur, relivraison du
// pont) et dans le désordre (un `done` avant un `signer.done` retardé). Deux
// règles suffisent :
//
//   · rejouer un fait déjà appliqué ne change rien ;
//   · un fait ne peut pas faire RECULER l'état.
//
// La seconde est la plus importante : sans elle, un `signer.done` arrivé en
// retard rouvrirait un contrat déjà signé, et le parcours d'activation
// repartirait en arrière sous les yeux du client.
import { Contract } from '../../models/Contract.model.js';
import { downloadSignedDocument, downloadSignatureCertificate, mapRequestStatus } from './signature.service.js';
import { storeSignedPdf, storeSignatureCertificate } from '../contractDocument.service.js';
import {
  CONTRACT_STATUS as S,
  SIGNATURE_STATUS,
  CONTRACT_AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
} from '../../utils/contractConstants.js';
import { logContractAudit } from '../../models/ContractAuditLog.model.js';
import * as sm from '../contractStateMachine.js';
import { logger } from '../../utils/logger.js';
import { signatureOf, setSignatureField, LEGACY_SIGNATURE_PROVIDER } from './signatureRecord.js';

/** Les faits que le Panel projette. Fermé : un verbe inconnu est ignoré, pas deviné. */
const EVENTS = Object.freeze({
  SIGNER_SIGNED: 'SIGNATURE_SIGNER_SIGNED',
  COMPLETED: 'SIGNATURE_COMPLETED',
  FAILED: 'SIGNATURE_FAILED',
});

/**
 * L'ORDRE DES ÉTATS — ce qui interdit de reculer.
 *
 * Un rang inférieur ou égal au rang courant n'écrase rien. C'est ce qui rend
 * inoffensifs le désordre et le rejeu, sans avoir à tenir un journal des faits
 * déjà vus : l'état lui-même porte la mémoire.
 */
const RANK = Object.freeze({
  [SIGNATURE_STATUS.NONE]: 0,
  [SIGNATURE_STATUS.DRAFT]: 1,
  [SIGNATURE_STATUS.ONGOING]: 2,
  [SIGNATURE_STATUS.DONE]: 3,
  [SIGNATURE_STATUS.DECLINED]: 3,
  [SIGNATURE_STATUS.EXPIRED]: 3,
  [SIGNATURE_STATUS.CANCELED]: 3,
});

function rankOf(status) {
  return RANK[status] ?? 0;
}

/**
 * Applique un `SIGNATURE_EVENT`.
 *
 * Branché sur les DEUX registres — poussée immédiate et rattrapage au pull.
 * Un type inscrit dans un seul des deux fonctionne tant que le projet est en
 * ligne, puis disparaît silencieusement dès qu'il a été absent, c'est-à-dire
 * exactement le cas que la bascule du webhook existe pour couvrir.
 *
 * La signature est `({ change })` — c'est la convention des DEUX registres, et
 * non un détail de style : recevoir `change` directement ferait lire une charge
 * utile absente, et l'applicateur répondrait « verbe inconnu » sur chaque fait,
 * en silence et sans jamais échouer.
 *
 * @param {{change: {payload: object, entityId?: string}}} arg
 */
export async function applySignatureEvent({ change } = {}) {
  const payload = change?.payload ?? {};
  const {
    event, contractRef, signatureRequestId, signerId, providerEvent,
  } = payload;

  if (!Object.values(EVENTS).includes(event)) {
    // Fait hors vocabulaire : on l'ACQUITTE sans rien faire. Le refuser ferait
    // rejouer le pont en boucle pour un événement qu'on ne veut pas.
    return { applied: false, reason: 'EVENT_NOT_HANDLED' };
  }
  if (!contractRef) return { applied: false, reason: 'NO_CONTRACT_REF' };

  const contract = await Contract.findById(contractRef);
  if (!contract) {
    /**
     * Contrat inconnu : on acquitte sans erreur. Lever ferait relivrer
     * indéfiniment un fait qui ne trouvera jamais sa cible — un contrat
     * supprimé, par exemple.
     */
    logger.warn(`[signature] fait reçu pour un contrat inconnu (${contractRef}).`);
    return { applied: false, reason: 'CONTRACT_UNKNOWN' };
  }

  /**
   * LA CORRÉLATION EST VÉRIFIÉE, MÊME VENANT DU PANEL.
   *
   * Le Panel a déjà résolu l'appartenance — c'est lui qui tient le lien. Ce
   * contrôle-ci est une défense en profondeur : si le contrat pointait une
   * autre demande, appliquer le fait écraserait un parcours en cours par celui
   * d'un autre.
   */
  if (signatureRequestId && signatureOf(contract).requestId
    && signatureOf(contract).requestId !== signatureRequestId) {
    logger.warn(
      `[signature] fait ignoré : le contrat ${contractRef} ne pointe pas cette demande.`,
    );
    return { applied: false, reason: 'REQUEST_MISMATCH' };
  }

  const courant = signatureOf(contract).status;

  /**
   * UN FAIT NE RESSUSCITE PAS UNE DEMANDE CLOSE.
   *
   * DONE, DECLINED, EXPIRED et CANCELED sont terminaux. Un `signer.done`
   * retardé qui arriverait après eux rouvrirait un parcours déjà tranché : le
   * client verrait son contrat repasser « en cours de signature » après avoir
   * été informé du contraire. On acquitte, on n'applique pas.
   */
  if (rankOf(courant) >= rankOf(SIGNATURE_STATUS.DONE) && event !== EVENTS.COMPLETED) {
    return { applied: false, reason: 'NOT_A_PROGRESSION', status: courant };
  }

  if (event === EVENTS.SIGNER_SIGNED) {
    return appliquerSignataire(contract, { signerId, courant });
  }
  if (event === EVENTS.FAILED) {
    return appliquerEchec(contract, { providerEvent, courant });
  }
  return appliquerAchevement(contract, { courant });
}

/**
 * UN SIGNATAIRE A SIGNÉ — horodaté À SA PLACE, et une seule fois.
 *
 * L'attribution passe par `signerId`, la clé que ce projet a lui-même donnée à
 * Yousign en déclarant les signataires. Sans elle on saurait qu'« une »
 * signature a eu lieu sans savoir laquelle : impossible de libérer le contrat
 * pour la contresignature du client au bon moment, et le parcours resterait
 * bloqué sans qu'aucune erreur n'apparaisse nulle part.
 *
 * L'horodatage est POSÉ UNE FOIS. Un rejeu ne le repousse pas — la date d'une
 * signature est un fait juridique, pas un compteur d'activité.
 */
async function appliquerSignataire(contract, { signerId, courant }) {
  /**
   * ON LIT PAR `signatureOf`, ON ECRIT PAR `setSignatureField`.
   *
   * Un contrat porte sa signature dans `signature` (depuis la bascule) ou dans
   * `yousign` (avant). Ecrire toujours dans le bloc moderne creerait un contrat
   * a deux tetes : deux statuts, et la serialisation montrerait le plus recent
   * -- c'est-a-dire le mauvais, sur un contrat historique dont le fait vient
   * justement de l'ancien fournisseur.
   */
  const y = signatureOf(contract);
  let attribue = null;

  if (signerId && signerId === y.devSignerId && !y.devSignedAt) {
    setSignatureField(contract, 'devSignedAt', new Date());
    attribue = CONTRACT_AUDIT_ACTION.DEV_SIGNED;
    /**
     * La signature du développeur OUVRE le contrat au client. Sans cette
     * transition, le client ne verrait jamais apparaître son exemplaire à
     * contresigner : le parcours resterait sur un état d'attente que plus
     * aucun événement ne viendrait lever.
     */
    if (contract.status === S.PENDING_DEV_SIGNATURE) {
      contract.status = sm.assertTransition(contract.status, S.INACTIVE);
    }
  } else if (signerId && signerId === y.clientSignerId && !y.clientSignedAt) {
    setSignatureField(contract, 'clientSignedAt', new Date());
    attribue = CONTRACT_AUDIT_ACTION.ADMIN_SIGNED;
  } else if (!signerId) {
    /**
     * Fait sans signataire nommé : on avance le statut global, mais on
     * n'ATTRIBUE rien. Deviner « c'est sûrement le développeur » poserait une
     * date de signature sur quelqu'un qui n'a peut-être pas signé.
     */
    logger.warn(
      `[signature] fait de signature sans signataire pour ${contract._id} — `
      + 'statut avancé, aucune attribution.',
    );
  }

  // Le statut global n'avance que s'il était en deçà : un rejeu est neutre.
  const avance = rankOf(SIGNATURE_STATUS.ONGOING) > rankOf(courant);
  if (avance) setSignatureField(contract, 'status', SIGNATURE_STATUS.ONGOING);
  const statut = avance ? SIGNATURE_STATUS.ONGOING : courant;

  if (!attribue && statut === courant) {
    // Ni attribution ni progression : strictement rien à écrire.
    return { applied: false, reason: 'NOT_A_PROGRESSION', status: courant };
  }

  await contract.save();
  if (attribue) {
    await logContractAudit({
      contractId: contract._id,
      action: attribue,
      actorType: AUDIT_ACTOR_TYPE.WEBHOOK,
      provider: 'YOUSIGN',
    }).catch(() => {});
  }

  logger.info(`[signature] signataire appliqué au contrat ${contract._id} → ${statut}.`);
  return { applied: true, status: statut, attributed: attribue };
}

/**
 * REFUS, EXPIRATION, ANNULATION — trois issues, un seul verbe de pont.
 *
 * Le Panel les réduit à `SIGNATURE_FAILED` parce que la CONSÉQUENCE est la
 * même : le contrat devient récupérable par relance. Mais la NUANCE compte pour
 * qui relit le dossier ensuite ; elle voyage dans `providerEvent`, et c'est ici
 * qu'on la retraduit. Un libellé inconnu retombe sur DECLINED plutôt que de
 * laisser la demande « en cours » — état qu'aucun fait ultérieur ne viendrait
 * plus jamais lever, puisque le fournisseur en a fini avec elle.
 */
async function appliquerEchec(contract, { providerEvent, courant }) {
  const issue = String(providerEvent ?? '').split('.')[1] ?? '';
  const traduit = mapRequestStatus(issue);
  const cible = rankOf(traduit) >= rankOf(SIGNATURE_STATUS.DONE)
    ? traduit
    : SIGNATURE_STATUS.DECLINED;

  setSignatureField(contract, 'status', cible);

  /**
   * État métier cohérent : une signature refusée/expirée/annulée place le
   * contrat en FAILED — récupérable, voir `restartSignature`.
   */
  if ([S.PENDING_DEV_SIGNATURE, S.INACTIVE, S.ACTIVATION_IN_PROGRESS].includes(contract.status)) {
    contract.status = sm.assertTransition(contract.status, S.FAILED);
  }

  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.SIGNATURE_FAILED,
    actorType: AUDIT_ACTOR_TYPE.WEBHOOK,
    provider: 'YOUSIGN',
    metadataSafe: { outcome: issue || 'declined' },
  }).catch(() => {});

  logger.info(`[signature] échec appliqué au contrat ${contract._id} → ${cible} (depuis ${courant}).`);
  return { applied: true, status: cible };
}

/**
 * LA DEMANDE EST ACHEVÉE — et le PDF signé rapatrié une fois pour toutes.
 *
 * `signature_request.done` fait autorité même si les faits par signataire se
 * sont perdus en route : on complète les horodatages manquants plutôt que de
 * laisser un contrat entièrement signé afficher une signature à moitié faite.
 */
async function appliquerAchevement(contract, { courant }) {
  const y = signatureOf(contract);
  const deja = courant === SIGNATURE_STATUS.DONE;

  if (deja && contract.document?.signedFilename) {
    // Déjà complet ET document déjà récupéré : rejeu strict, rien à faire.
    return { applied: false, reason: 'ALREADY_COMPLETE', status: courant };
  }

  setSignatureField(contract, 'status', SIGNATURE_STATUS.DONE);
  if (!y.devSignedAt) setSignatureField(contract, 'devSignedAt', new Date());
  if (!y.clientSignedAt) setSignatureField(contract, 'clientSignedAt', new Date());
  if (contract.status === S.PENDING_DEV_SIGNATURE) {
    contract.status = sm.assertTransition(contract.status, S.INACTIVE);
  }

  /**
   * LE DOCUMENT SIGNÉ — récupéré une seule fois, et par la capacité.
   *
   * Le `documentId` n'est PAS transmis : le Panel le connaît par le lien
   * d'appartenance. Le lui envoyer permettrait de nommer un autre document au
   * sein d'une demande possédée.
   *
   * L'échec de récupération ne fait PAS échouer l'application du fait : le
   * contrat EST signé, indépendamment de notre capacité à télécharger le PDF à
   * cet instant. La réconciliation repassera.
   */
  if (!contract.document?.signedFilename) {
    try {
      const buffer = await downloadSignedDocument(y.requestId);
      const meta = await storeSignedPdf(contract._id, buffer, { filename: 'signed.pdf' });
      contract.document.signedFilename = meta.signedFilename;
      contract.document.signedChecksum = meta.signedChecksum;
      contract.document.signedFetchedAt = meta.signedFetchedAt;
      await logContractAudit({
        contractId: contract._id,
        action: CONTRACT_AUDIT_ACTION.SIGNED_PDF_FETCHED,
        actorType: AUDIT_ACTOR_TYPE.WEBHOOK,
        provider: y.provider ?? LEGACY_SIGNATURE_PROVIDER,
      }).catch(() => {});
    } catch (err) {
      logger.warn(
        `[signature] document signé non récupéré pour ${contract._id} `
        + `(${err?.message ?? 'raison inconnue'}) — la réconciliation réessaiera.`,
      );
    }
  }

  /**
   * LA PREUVE D'AUDIT — RÉCUPÉRÉE À PART, ET SANS BLOQUER QUOI QUE CE SOIT.
   *
   * Elle atteste QUI a signé, QUAND et DEPUIS OÙ. C'est une pièce du dossier,
   * pas une condition de l'achèvement : le contrat EST signé indépendamment de
   * notre capacité à télécharger son certificat à cet instant.
   *
   * Elle peut légitimement ne pas exister — le fournisseur historique n'en
   * publiait pas. Dans ce cas la capacité rend `null`, et il n'y a rien à
   * consigner : ce n'est pas un échec, et le journaliser comme tel remplirait
   * les traces d'alertes pour un fait normal.
   */
  if (!contract.document?.certificateFilename) {
    try {
      const certificat = await downloadSignatureCertificate(y.requestId);
      if (certificat) {
        const meta = await storeSignatureCertificate(contract._id, certificat.buffer, {
          contentType: certificat.contentType,
        });
        contract.document.certificateFilename = meta.certificateFilename;
        contract.document.certificateChecksum = meta.certificateChecksum;
        contract.document.certificateContentType = meta.certificateContentType;
        contract.document.certificateFetchedAt = meta.certificateFetchedAt;
        await logContractAudit({
          contractId: contract._id,
          action: CONTRACT_AUDIT_ACTION.SIGNATURE_CERTIFICATE_FETCHED,
          actorType: AUDIT_ACTOR_TYPE.WEBHOOK,
          provider: y.provider ?? LEGACY_SIGNATURE_PROVIDER,
        }).catch(() => {});
      }
    } catch (err) {
      logger.warn(
        `[signature] certificat d’audit non récupéré pour ${contract._id} `
        + `(${err?.message ?? 'raison inconnue'}) — la réconciliation réessaiera.`,
      );
    }
  }

  await contract.save();

  if (!deja) {
    await logContractAudit({
      contractId: contract._id,
      action: CONTRACT_AUDIT_ACTION.FULLY_SIGNED,
      actorType: AUDIT_ACTOR_TYPE.WEBHOOK,
      /** QUI a servi l'acte — lu sur la demande, jamais supposé. */
      provider: y.provider ?? LEGACY_SIGNATURE_PROVIDER,
    }).catch(() => {});
  }

  logger.info(`[signature] achèvement appliqué au contrat ${contract._id}.`);
  return { applied: true, status: SIGNATURE_STATUS.DONE };
}

export default { applySignatureEvent };
