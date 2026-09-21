// SIGNER UN CONTRAT DANS UN TEST — après le cutover Yousign (R10.5C).
//
// ══ POURQUOI CE FICHIER EXISTE ══════════════════════════════════════════════
//
// Beaucoup de suites ont besoin d'un contrat SIGNÉ comme simple décor : les
// paiements, l'abonnement, la facturation, le cycle de vie. Aucune d'elles ne
// cherche à éprouver la signature — elles ont juste besoin d'un contrat qui a
// franchi cette étape.
//
// Avant R10.5C, elles y arrivaient en postant elles-mêmes trois webhooks signés
// sur une route locale. Cette route n'existe plus, et la clé qui servait à les
// signer non plus.
//
// ══ POURQUOI UN HELPER PLUTÔT QUE SIX COPIES ════════════════════════════════
//
// Le chemin de signature comporte maintenant deux préalables non évidents : un
// Panel appairé (sans lui, l'ouverture échoue en `CAPABILITY_MISSING`) et
// l'enveloppe `({ change })` attendue par les applicateurs. Recopier cela six
// fois garantissait six variantes légèrement différentes, dont certaines
// auraient « marché » pour de mauvaises raisons.
//
// ══ CE QUE CE HELPER N'EST PAS ══════════════════════════════════════════════
//
// Ce n'est pas un raccourci qui écrirait `status: 'DONE'` en base. Il fait
// PASSER le contrat par le vrai chemin — capacité d'ouverture, puis application
// des faits projetés — parce qu'un décor posé à la main masquerait le jour où
// ce chemin cesse de fonctionner.
//
// L'épreuve DÉTAILLÉE de la signature, elle, vit dans `signature-flow.test.js`.

/**
 * Appaire un Panel stub sur le runtime réel du pont.
 *
 * À appeler APRÈS `bootstrap()` : `configureBridgeRuntime` complète la
 * configuration en place — les applicateurs branchés par le bootstrap restent
 * actifs, seul le client distant est doublé.
 *
 * @returns {Promise<object>} le stub, pour inspection éventuelle
 */
export async function pairSignatureStub() {
  const { createPanelStub } = await import('../../services/panelBridge/panelStub.js');
  const bridgeRuntime = await import('../../services/panelBridge/bridgeRuntime.js');
  const panelStub = createPanelStub();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => panelStub });
  try {
    await bridgeRuntime.pairWithPanel({
      panelUrl: 'https://panel-stub.test',
      pairingCode: 'PAIR-OK',
      publicBackendUrl: 'https://projet-stub.test',
    });
  } catch (err) {
    /**
     * DÉJÀ APPAIRÉ : ce n'est pas un échec.
     *
     * Certaines suites appairent elles-mêmes, pour éprouver le pont. Lever ici
     * les obligerait à savoir si ce helper a été appelé avant ou après — un
     * couplage inutile, et une source d'échecs qui ne parlent pas du sujet
     * testé. Toute AUTRE erreur remonte : elle, on veut la voir.
     */
    if (err?.code !== 'BRIDGE_ALREADY_PAIRED') throw err;
  }
  return panelStub;
}

/**
 * Applique un fait de signature comme le pont le livre.
 *
 * L'enveloppe `({ change })` n'est pas un détail de style : un applicateur qui
 * lit une charge utile absente ne LÈVE PAS — il répond « verbe inconnu » et
 * acquitte. Le test serait vert, le contrat non signé.
 */
async function projeter(event, { contractRef, signatureRequestId, signerId = null, providerEvent = null }) {
  const { applySignatureEvent } = await import('../../services/signature/signatureEvent.applier.js');
  return applySignatureEvent({
    change: {
      payload: {
        event,
        contractRef: String(contractRef),
        signatureRequestId,
        signerId,
        providerEvent: providerEvent ?? event,
        occurredAt: new Date().toISOString(),
      },
    },
  });
}

/**
 * Mène un contrat déjà lancé jusqu'à la signature complète.
 *
 * Les trois faits sont projetés dans l'ordre réel — développeur, client, puis
 * achèvement. On ne saute pas directement à l'achèvement : c'est la signature
 * du DÉVELOPPEUR qui fait passer le contrat en INACTIVE, et plusieurs suites
 * dépendent de cet état intermédiaire sans le dire.
 *
 * @param {string} contractId
 */
export async function signContractFully(contractId) {
  const { Contract } = await import('../../models/Contract.model.js');
  const { signatureOf } = await import('../../services/signature/signatureRecord.js');
  const c = await Contract.findById(contractId);
  /**
   * ON LIT PAR LE LECTEUR NEUTRE, PAS PAR `contract.yousign`.
   *
   * Une demande ouverte aujourd'hui n'écrit plus dans le bloc historique. Lire
   * `c.yousign` rendait donc `undefined` pour chaque identifiant de signataire
   * — et l'applicateur, fidèle à sa règle, refusait d'attribuer une signature
   * à personne. Les suites qui ne demandent qu'un contrat SIGNÉ comme décor
   * échouaient alors sur un chemin qu'elles n'éprouvent pas.
   */
  const sig = signatureOf(c);

  await projeter('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId,
    signatureRequestId: sig.requestId,
    signerId: sig.devSignerId,
    providerEvent: 'signer.done',
  });
  await projeter('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId,
    signatureRequestId: sig.requestId,
    signerId: sig.clientSignerId,
    providerEvent: 'signer.done',
  });
  await projeter('SIGNATURE_COMPLETED', {
    contractRef: contractId,
    signatureRequestId: sig.requestId,
    providerEvent: 'signature_request.done',
  });

  return Contract.findById(contractId);
}

/** Le refus d'un contrat — pour les suites qui éprouvent la reprise. */
export async function declineContract(contractId) {
  const { Contract } = await import('../../models/Contract.model.js');
  const { signatureOf } = await import('../../services/signature/signatureRecord.js');
  const c = await Contract.findById(contractId);
  await projeter('SIGNATURE_FAILED', {
    contractRef: contractId,
    signatureRequestId: signatureOf(c).requestId,
    providerEvent: 'signature_request.declined',
  });
  return Contract.findById(contractId);
}

export default { pairSignatureStub, signContractFully, declineContract };
