/**
 * LE PONT, DEPUIS UN OUTIL EN LIGNE DE COMMANDE.
 *
 * ── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Les capacités du Panel (`dns.*`, e-mail, signature…) passent par le pont, et
 * le pont est configuré au démarrage du SERVEUR. Un script CLI n'a pas ce
 * démarrage : il ouvre une connexion à la base et travaille. Il n'avait donc
 * aucune capacité — silencieusement.
 *
 * Conséquence observée à la certification factory : chaque déploiement lancé en
 * ligne de commande partait sans DNS automatique et réclamait une vérification
 * manuelle. L'avertissement se lisait comme une propriété de l'environnement,
 * alors qu'il décrivait un manque de l'outil. C'est la forme exacte que prend
 * un geste manuel qui s'installe : personne ne le décide, tout le monde s'y
 * habitue.
 *
 * ── CE QUE CE MODULE N'EST PAS ──────────────────────────────────────────────
 *
 * Ce n'est pas un second amorçage. Il ne démarre ni ordonnanceur, ni tirage, ni
 * outbox : un script n'est pas un runtime, et deux runtimes pour un projet est
 * précisément le défaut que le Panel signale désormais. Il restaure le STRICT
 * nécessaire pour POSER UNE QUESTION au Panel : l'identité et le jeton
 * persistés lors de l'appairage.
 *
 * ── ET SI LE PROJET N'EST PAS APPAIRÉ ───────────────────────────────────────
 *
 * On rend `null`, et l'appelant se comporte exactement comme avant : un motif
 * nommé, jamais un contournement.
 */
import { config } from '../../config/env.js';

/**
 * Rend un invocateur de capacités, ou `null`.
 *
 * NE LÈVE JAMAIS : un outil de déploiement ne doit pas tomber parce que le
 * Panel est injoignable — il doit le DIRE, et poursuivre sans automatisme.
 *
 * @returns {Promise<((code: string, input: object) => Promise<object>)|null>}
 */
export async function cliCapabilityInvoker() {
  try {
    const [
      { configureBridgeRuntime, getPanelBridge },
      { configurePairingPersistence, hydratePairing },
      { createMongoPairingAdapter },
      capabilities,
    ] = await Promise.all([
      import('../../services/panelBridge/bridgeRuntime.js'),
      import('../../services/panelBridge/pairingStore.js'),
      import('../../services/panelBridge/persistence/mongoPairingAdapter.js'),
      import('../../services/panelBridge/capabilityClient.js'),
    ]);

    /**
     * L'appairage vit en base, chiffré. Sans l'adaptateur, le magasin répond
     * « aucun appairage » alors qu'il y en a un — et l'outil conclurait à tort
     * que le projet n'est pas relié.
     */
    configurePairingPersistence(createMongoPairingAdapter());
    const restaure = await hydratePairing();
    if (!restaure) return null;

    configureBridgeRuntime({
      identityProvider: () => ({
        projectKey: config.projectKey ?? 'projet',
        projectName: config.projectName ?? 'Projet',
        environment: config.env,
        softwareVersion: 'cli',
      }),
    });
    /** Une instance suffit à porter le jeton ; on ne démarre rien d'autre. */
    getPanelBridge();
    return capabilities.capabilitiesAvailable() ? capabilities.invokeCapability : null;
  } catch {
    return null;
  }
}

export default { cliCapabilityInvoker };
