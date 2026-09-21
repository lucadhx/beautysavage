/**
 * CYCLE DE VIE DU RUNTIME — trois états, et un seul sens de circulation.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * `PROJECTION_BUILD_FAILED / SITE_STATUS` apparaissait à l'arrêt, sans qu'aucune
 * projection n'ait réellement échoué. La chaîne était celle-ci :
 *
 *   1. une écriture métier programme une projection (fenêtre de 500 ms) ;
 *   2. l'arrêt survient dans cette fenêtre ;
 *   3. `mongoose.disconnect()` ferme la connexion ;
 *   4. le minuteur arrive à échéance et construit la projection ;
 *   5. la lecture échoue — la base est fermée ;
 *   6. un INCIDENT DURABLE est écrit, comme si le système était en panne.
 *
 * Le système n'était pas en panne : il s'arrêtait. Confondre les deux est le
 * pire défaut d'observabilité possible, parce qu'il apprend à ignorer une
 * catégorie d'incidents — et le jour où l'un d'eux est vrai, personne ne le
 * lit. C'est le même mécanisme qui avait masqué le refus permanent de
 * `PROJECT_PRESENTATION`.
 *
 * ══ POURQUOI PAS `if (NODE_ENV === 'test')` ═════════════════════════════════
 *
 * Parce que le défaut N'EST PAS un artefact de test. Un `SIGTERM` de PM2, un
 * `reload`, une mise en ligne du projet par lui-même : tous passent par la même
 * fenêtre, en production, et y écrivent le même faux incident. Masquer la trace
 * en recette laisserait le bruit exactement là où il est nuisible.
 *
 * La distinction n'est donc pas « test / production » mais « en marche /
 * en cours d'arrêt » — une propriété du RUNTIME, vraie partout.
 *
 * ══ CE QUE `DRAINING` GARANTIT ══════════════════════════════════════════════
 *
 *   · plus AUCUN travail périodique n'est programmé ;
 *   · le travail DÉJÀ accepté est vidangé tout de suite, tant que la base est
 *     encore ouverte — c'est ce que fait `beginDraining()`, et il l'ATTEND ;
 *   · ce qui n'a pas pu être vidangé reste durablement rejouable : l'écriture
 *     métier est persistée, et `reconcileAll()` reconstruit la projection au
 *     prochain démarrage. Un arrêt ne perd donc rien — il diffère ;
 *   · une erreur survenue AVANT l'entrée en drainage reste un incident franc.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Ni une file, ni un bus, ni un ordonnanceur. Il ne fait que porter un ÉTAT et
 * la liste de ce qu'il faut fermer — pour que l'ordre d'extinction soit écrit
 * à UN endroit plutôt que déduit de l'ordre des lignes de `server.js`.
 */
import { logger } from '../../utils/logger.js';

export const LIFECYCLE = Object.freeze({
  RUNNING: 'RUNNING',
  DRAINING: 'DRAINING',
  STOPPED: 'STOPPED',
});

let etat = LIFECYCLE.RUNNING;

/**
 * Les vidangeurs, dans leur ORDRE D'INSCRIPTION.
 *
 * L'ordre n'est pas cosmétique : les projections se vidangent avant que les
 * flux ne se ferment, et les flux avant que la base ne se déconnecte. Un
 * `Set` conserve l'ordre d'insertion — c'est exactement la garantie voulue.
 */
const vidangeurs = new Set();

/**
 * Inscrit un travail à vidanger à l'arrêt. Rend la fonction de retrait.
 *
 * L'inscription se fait au CHARGEMENT du module concerné : un composant sait
 * ce qu'il doit fermer, `server.js` n'a pas à le savoir pour lui.
 */
export function onDrain(vidangeur, { label = 'anonyme' } = {}) {
  const entree = { vidangeur, label };
  vidangeurs.add(entree);
  return () => vidangeurs.delete(entree);
}

/**
 * LES LIBELLÉS DES VIDANGEURS INSCRITS — pour PROUVER la symétrie du cycle.
 *
 * ── POURQUOI CETTE LECTURE EXISTE ───────────────────────────────────────────
 *
 * « Tout ce qui démarre s'arrête » n'était vérifiable qu'en relisant le code.
 * Un `startX()` qui rend sans lever ne prouve pas qu'un `stopX()` lui répond :
 * la seule preuve est qu'une fermeture soit RÉELLEMENT inscrite, et c'est ce
 * que cette lecture rend constatable — par la recette, et par le contrôle
 * d'invariants de services au démarrage.
 *
 * Elle ne rend que des libellés : personne ne peut déclencher une vidange par
 * ce chemin, ni la retirer.
 */
export function drainHookLabels() {
  return [...vidangeurs].map(({ label }) => label);
}

/** Le runtime accepte-t-il encore de programmer du travail ? */
export function isAcceptingWork() {
  return etat === LIFECYCLE.RUNNING;
}

/** L'arrêt a-t-il commencé ? Sert à ne PAS transformer une fermeture en panne. */
export function isShuttingDown() {
  return etat !== LIFECYCLE.RUNNING;
}

export function lifecycleState() {
  return etat;
}

/**
 * RUNNING → DRAINING, puis vidange, et on ATTEND.
 *
 * Idempotent : deux signaux rapprochés ne déclenchent qu'une vidange.
 *
 * L'ordre compte, et il est le seul point délicat : on bascule l'état AVANT de
 * vidanger. Sans cela, un vidangeur qui déclenche une écriture reprogrammerait
 * du travail derrière lui, et la vidange ne terminerait jamais.
 *
 * Ne lève JAMAIS. Un arrêt qui échoue parce qu'un vidangeur a hoqueté serait un
 * arrêt forcé — c'est-à-dire précisément ce qu'on cherche à éviter.
 */
export async function beginDraining({ reason = 'shutdown' } = {}) {
  if (etat !== LIFECYCLE.RUNNING) return { drained: false, already: true };
  etat = LIFECYCLE.DRAINING;
  logger.info(`[lifecycle] RUNNING → DRAINING (${reason}) — ${vidangeurs.size} vidangeur(s).`);

  for (const { vidangeur, label } of [...vidangeurs]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await vidangeur();
    } catch (err) {
      // Un vidangeur en échec est une information, jamais un blocage : le
      // travail qu'il n'a pas fini reste rejouable au prochain démarrage.
      logger.warn(`[lifecycle] vidange « ${label} » incomplète : ${err?.message ?? err}`);
    }
  }
  return { drained: true, already: false };
}

/** DRAINING → STOPPED. Appelé quand plus rien ne doit tourner. */
export function markStopped() {
  etat = LIFECYCLE.STOPPED;
}

/**
 * L'ARRÊT COMPLET D'UN SERVEUR HTTP — la séquence, écrite UNE fois.
 *
 * ══ POURQUOI `server.close()` NE SUFFIT PAS ═════════════════════════════════
 *
 * Il cesse d'ACCEPTER, puis attend la fermeture de la dernière connexion. Deux
 * catégories ne se ferment jamais d'elles-mêmes :
 *
 *   · les FLUX longs — un NDJSON d'invalidation reste ouvert par construction,
 *     son battement de maintien est exactement là pour ça ;
 *   · les connexions KEEP-ALIVE AU REPOS — un navigateur en garde plusieurs
 *     ouvertes après sa dernière requête, prêtes à resservir. Elles ne
 *     transportent rien, mais `close()` les attend quand même.
 *
 * Un seul onglet ouvert suffisait donc à épuiser le délai de grâce : l'arrêt se
 * terminait par une sortie forcée, base jamais refermée proprement, et un
 * `reload` PM2 se soldait par un code d'erreur sur un arrêt normal.
 *
 * Le drainage règle la première catégorie, `closeIdleConnections()` la seconde.
 * Ce qui reste est une requête RÉELLEMENT en cours : on lui laisse le délai de
 * grâce, et c'est le seul cas où la coupure est justifiée.
 *
 * ══ POURQUOI CETTE SÉQUENCE VIT ICI ET PAS DANS `server.js` ═════════════════
 *
 * Pour que la recette éprouve la VRAIE séquence. Un test qui recopierait
 * l'ordre des appels prouverait sa propre copie — et resterait vert le jour où
 * le point d'entrée changerait d'ordre.
 */
export async function gracefulShutdown({ server, reason = 'shutdown', graceMs = 10_000 }) {
  await beginDraining({ reason });

  const ferme = new Promise((resoudre) => {
    server.close(() => resoudre('closed'));
    // APRÈS `close()` : les sockets au repos n'ont plus de raison d'attendre.
    server.closeIdleConnections?.();
  });

  const delai = new Promise((resoudre) => {
    const t = setTimeout(() => resoudre('forced'), graceMs);
    t.unref?.();
  });

  const issue = await Promise.race([ferme, delai]);
  if (issue === 'forced') {
    // Une requête tenait encore la ligne au-delà du délai. On la coupe, mais on
    // le DIT : un arrêt forcé n'est pas un arrêt propre, et le taire ferait
    // disparaître le seul signal qu'une requête ne se termine jamais.
    logger.warn(`[lifecycle] délai de grâce dépassé (${graceMs} ms) — connexions restantes coupées.`);
    server.closeAllConnections?.();
  }
  markStopped();
  return issue;
}

/**
 * → RUNNING. Appelé à l'ouverture de la base, en production comme en recette.
 *
 * Ce n'est PAS un utilitaire de test : certaines recettes ferment puis rouvrent
 * la base dans un même processus, et un runtime resté « arrêté » cesserait
 * silencieusement de programmer ses projections. Un composant qui ne travaille
 * plus sans le dire est plus dangereux qu'un composant en panne.
 *
 * Les vidangeurs ne sont PAS effacés : ils sont inscrits au chargement des
 * modules, et les perdre éprouverait un runtime qui n'existe pas.
 */
export function markRunning() {
  etat = LIFECYCLE.RUNNING;
}

export default {
  LIFECYCLE,
  onDrain,
  drainHookLabels,
  beginDraining,
  gracefulShutdown,
  markRunning,
  markStopped,
  isAcceptingWork,
  isShuttingDown,
  lifecycleState,
};
