// LE BLOC DE SIGNATURE D'UN CONTRAT — UNE SEULE FAÇON DE LE LIRE.
//
// docs/OPENSIGN_MIGRATION.md.
//
// ══ LE PROBLÈME QUE CE MODULE FERME ═════════════════════════════════════════
//
// Un contrat porte sa signature à DEUX endroits, et c'est temporaire mais long :
//
//   `contract.signature`  écrit depuis la bascule — porte `provider`
//   `contract.yousign`    historique, plus jamais écrit
//
// Sans point de lecture unique, chaque appelant devrait écrire
// `contract.signature.requestId ?? contract.yousign.signatureRequestId`. Il y
// en a une vingtaine. L'un d'eux l'oublierait, et le symptôme serait le pire
// possible : un contrat signé l'an dernier s'afficherait « aucune signature »,
// sans erreur, sans journal, sur un objet juridique.
//
// ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
//
// Ce n'est pas une couche de compatibilité qu'on gardera « au cas où ». Elle
// existe tant qu'il reste des contrats écrits avant la bascule. Le jour où il
// n'y en a plus — ou s'ils sont archivés autrement —, `legacy()` cesse de
// trouver quoi que ce soit, et le module se réduit à sa moitié moderne.
import { SIGNATURE_STATUS } from '../../utils/contractConstants.js';

/**
 * LE FOURNISSEUR DES CONTRATS ANTÉRIEURS.
 *
 * Ce n'est pas une supposition : aucun autre fournisseur de signature n'a
 * jamais écrit dans ce champ. C'est un fait historique, et il est écrit ici
 * plutôt que redeviné à chaque lecture.
 */
export const LEGACY_SIGNATURE_PROVIDER = 'YOUSIGN';

/**
 * La signature d'un contrat, sous une forme unique.
 *
 * @returns {{
 *   provider: string|null, requestId: string|null, documentId: string|null,
 *   devSignerId: string|null, clientSignerId: string|null, status: string,
 *   devSignedAt: Date|null, clientSignedAt: Date|null, autoReturn: boolean,
 *   legacy: boolean
 * }}
 */
export function signatureOf(contract) {
  const moderne = contract?.signature ?? {};
  if (moderne.requestId) {
    return {
      provider: moderne.provider ?? null,
      requestId: moderne.requestId,
      documentId: moderne.documentId ?? null,
      devSignerId: moderne.devSignerId ?? null,
      clientSignerId: moderne.clientSignerId ?? null,
      status: moderne.status ?? SIGNATURE_STATUS.NONE,
      devSignedAt: moderne.devSignedAt ?? null,
      clientSignedAt: moderne.clientSignedAt ?? null,
      autoReturn: Boolean(moderne.autoReturn),
      legacy: false,
    };
  }

  const ancien = contract?.yousign ?? {};
  if (ancien.signatureRequestId) {
    return {
      provider: LEGACY_SIGNATURE_PROVIDER,
      requestId: ancien.signatureRequestId,
      documentId: ancien.documentId ?? null,
      devSignerId: ancien.devSignerId ?? null,
      clientSignerId: ancien.adminSignerId ?? null,
      status: ancien.status ?? SIGNATURE_STATUS.NONE,
      devSignedAt: ancien.devSignedAt ?? null,
      clientSignedAt: ancien.adminSignedAt ?? null,
      autoReturn: Boolean(ancien.autoReturn),
      legacy: true,
    };
  }

  /**
   * AUCUNE DEMANDE — mais un STATUT peut exister quand même.
   *
   * Un contrat validé sans signature requise porte `status: NONE` sans avoir de
   * demande. Prendre le statut moderne d'abord, puis l'ancien, évite d'afficher
   * « aucune signature » là où le contrat dit explicitement qu'il n'en veut pas.
   *
   * ══ POURQUOI `??` NE SUFFIT PAS ICI ════════════════════════════════
   *
   * Les deux blocs portent un DEFAUT de schéma (`NONE`). `moderne.status` n'est
   * donc jamais `undefined` : `??` s'arrête au premier terme, et la valeur
   * héritée ne peut JAMAIS gagner. Le repli existait, et ne répliait rien.
   *
   * Le symptôme : un contrat hérité dont le bloc neuf n'a reçu que ses défauts
   * se lit « aucune signature » — y compris dans la projection envoyée au
   * Panel, qui l'annoncerait au repos.
   *
   * On traite donc `NONE` pour ce qu'il est : « rien de dit », pas une réponse.
   */
  const dit = (valeur) => (valeur && valeur !== SIGNATURE_STATUS.NONE ? valeur : null);
  return {
    provider: null,
    requestId: null,
    documentId: null,
    devSignerId: null,
    clientSignerId: null,
    status: dit(moderne.status) ?? dit(ancien.status) ?? SIGNATURE_STATUS.NONE,
    devSignedAt: moderne.devSignedAt ?? ancien.devSignedAt ?? null,
    clientSignedAt: moderne.clientSignedAt ?? ancien.adminSignedAt ?? null,
    autoReturn: Boolean(moderne.autoReturn ?? ancien.autoReturn),
    legacy: false,
  };
}

/**
 * LE BLOC OÙ IL FAUT ÉCRIRE, pour un contrat donné.
 *
 * ══ POURQUOI ON N'ÉCRIT PAS TOUJOURS DANS LE MODERNE ═══════════════════════
 *
 * Un contrat historique a sa demande chez l'ancien fournisseur. Quand un
 * webhook de CE fournisseur arrive — un signataire retardataire, une
 * révocation —, le fait doit être appliqué là où le contrat le porte.
 *
 * Écrire dans `signature` un fait qui concerne la demande de `yousign`
 * créerait un contrat à deux têtes : deux blocs, deux statuts, et une
 * sérialisation qui montrerait le plus récent — c'est-à-dire le mauvais.
 *
 * @returns {{cible: 'signature'|'yousign', champs: object}} les noms de champs
 *   à employer, qui diffèrent d'un bloc à l'autre.
 */
export function signatureTarget(contract) {
  const legacy = signatureOf(contract).legacy;
  return legacy
    ? {
      cible: 'yousign',
      champs: {
        requestId: 'signatureRequestId',
        documentId: 'documentId',
        devSignerId: 'devSignerId',
        clientSignerId: 'adminSignerId',
        status: 'status',
        devSignedAt: 'devSignedAt',
        clientSignedAt: 'adminSignedAt',
      },
    }
    : {
      cible: 'signature',
      champs: {
        requestId: 'requestId',
        documentId: 'documentId',
        devSignerId: 'devSignerId',
        clientSignerId: 'clientSignerId',
        status: 'status',
        devSignedAt: 'devSignedAt',
        clientSignedAt: 'clientSignedAt',
      },
    };
}

/** Écrit une valeur dans le bon bloc, sous le bon nom. */
export function setSignatureField(contract, cle, valeur) {
  const { cible, champs } = signatureTarget(contract);
  const nom = champs[cle];
  if (!nom) throw new Error(`Champ de signature inconnu : ${cle}`);
  if (!contract[cible]) contract[cible] = {};
  contract[cible][nom] = valeur;
  return contract;
}

export default {
  LEGACY_SIGNATURE_PROVIDER,
  signatureOf,
  signatureTarget,
  setSignatureField,
};
