/**
 * « LE SERVICE EST PRÊT » — dit par une suite qui a fini de se préparer.
 *
 * ══ POURQUOI CE HELPER EXISTE ═══════════════════════════════════════════════
 *
 * Le backend distingue désormais VIVANT et PRÊT : il ouvre son port
 * immédiatement et refuse les routes métier en `503 SERVICE_STARTING` tant que
 * l'amorçage n'est pas terminé. C'est la bonne conception — un frontend doit
 * pouvoir distinguer « ça démarre » de « c'est cassé », et une socket fermée ne
 * le permet pas.
 *
 * L'état READY est posé par `server.js`, APRÈS la base, l'amorçage, les
 * migrations et la reprise des runs orphelins. Son commentaire prévient, à
 * juste titre, qu'avancer cet appel remettrait en service un backend qui ne
 * tient pas encore ses garanties.
 *
 * Or une suite de test ne passe jamais par `server.js` : elle monte sa base,
 * appelle `bootstrap()` elle-même, puis `createApp().listen()`. Elle a donc
 * fait, à la main et dans l'ordre, tout ce que le démarrage fait — et son
 * serveur reste pourtant STARTING pour toujours. Chaque appel HTTP reçoit un
 * 503, et l'on croit lire un défaut d'autorisation là où il n'y a qu'un service
 * qui s'estime encore en train de naître.
 *
 * Ce helper est la déclaration explicite qui manquait, à appeler quand la
 * préparation de la suite est finie — jamais avant.
 *
 * ══ POURQUOI L'IMPORT EST PARESSEUX ET L'ÉCHEC TOLÉRÉ ═══════════════════════
 *
 * Un harnais de test ne doit pas exiger l'existence d'un module de
 * disponibilité pour démarrer un serveur. Sur une version du dépôt qui n'a pas
 * cette garde, l'appel ne fait simplement rien.
 */
export async function markTestServiceReady() {
  try {
    const readiness = await import('../../services/lifecycle/readiness.service.js');
    readiness.markReady();
    return true;
  } catch {
    return false;
  }
}

export default markTestServiceReady;
