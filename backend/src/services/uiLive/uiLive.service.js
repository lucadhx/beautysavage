/**
 * NOTIFICATION D'INTERFACE LOCALE — invalider une vue, jamais transporter un état.
 *
 * ══ LE MANQUE QUE CE MODULE COMBLE ══════════════════════════════════════════
 *
 * Le protocole métier fonctionne : le Panel enregistre, livre, et ce backend
 * persiste en quelques dizaines de millisecondes. Mais un Manager DÉJÀ OUVERT
 * n'apprenait jamais qu'une donnée était arrivée — `useResource` charge une
 * fois, au montage, et ne revalide pas. L'utilisateur voyait l'ancienne valeur
 * jusqu'à ce qu'il recharge la page.
 *
 * Le dernier maillon manquait, et c'est le seul que ce module ajoute.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Ce n'est PAS un second bus de synchronisation, et il ne faut jamais le
 * traiter comme tel. Il ne transporte AUCUN objet métier : seulement le NOM
 * d'une ressource qui vient de changer. Le navigateur, prévenu, redemande la
 * donnée à sa propre API — qui reste l'unique source de vérité.
 *
 * La règle tient en une phrase :
 *
 *     FLUX PERDU ≠ DONNÉE PERDUE.
 *
 * Si personne n'écoute, si le flux tombe, si le backend redémarre : la donnée
 * est déjà persistée. Un rechargement de page la montre. Ce module ne fait
 * qu'éviter d'avoir à recharger.
 *
 * ══ POURQUOI PAS `EventSource` ══════════════════════════════════════════════
 *
 * `EventSource` ne permet pas d'en-tête `Authorization`, et le jeton n'a rien
 * à faire dans une URL — il finirait dans les journaux d'accès, l'historique du
 * navigateur et les référents. Le dépôt possède déjà la bonne primitive :
 * un flux NDJSON lu par `fetch` + reader, authentifié normalement, utilisé pour
 * la progression des déploiements. On la réutilise plutôt que d'en inventer une.
 */
import { logger } from '../../utils/logger.js';
import { onDrain } from '../lifecycle/runtimeLifecycle.js';

/**
 * LES RESSOURCES INVALIDABLES — table FERMÉE.
 *
 * Une ressource par vue réellement servie, jamais un type par champ. Ajouter
 * une entrée doit rester un geste délibéré : un scope inventé au fil de l'eau
 * produirait des rechargements que personne ne sait expliquer.
 */
export const UI_RESOURCE = Object.freeze({
  /** La copie d'entreprise du Panel — ce que la page « Aide » affiche. */
  PANEL_COMPANY: 'panel-company',
  /** L'état d'accessibilité du site, et la protection contractuelle. */
  SITE_STATUS: 'site-status',
  /** Le contrat courant du projet. */
  CONTRACT: 'contract',
  /**
   * L'ENTREPRISE CLIENTE publiée par le Panel — ce que « Mon entreprise »
   * affiche, et ce dont dépendent les boutons de paiement et de signature.
   *
   * ══ POURQUOI ELLE MÉRITE SA PROPRE RESSOURCE ═══════════════════════════
   *
   * Elle change à un moment très particulier : quand L.Y Solution RATTACHE un
   * projet à son client, ou complète sa fiche. À cet instant, le Manager du
   * client passe de « paiement indisponible » à « paiement possible » — et
   * sans ce canal, il ne l'apprendrait qu'au rechargement suivant.
   *
   * La réutiliser sous `PANEL_COMPANY` aurait fait revalider la page « Aide »
   * à chaque correction de fiche client, et inversement : deux écrans qui se
   * rafraîchissent l'un pour l'autre finissent par ne plus rien signaler.
   */
  CLIENT_COMPANY: 'client-company',
  /**
   * LES DOCUMENTS LÉGAUX publiés par le Panel.
   *
   * Ils changent quand L.Y Solution publie un template ou change
   * l'affectation du projet. C'est ce canal qui rend le changement visible
   * sur un onglet déjà ouvert, sans rechargement et sans redéploiement.
   */
  LEGAL_DOCUMENT: 'legal-document',
});

const RESSOURCES_CONNUES = new Set(Object.values(UI_RESOURCE));

/** Abonnés vivants. Un par onglet — un navigateur en ouvre autant qu'il veut. */
const abonnes = new Set();

let sequence = 0;

/**
 * COMPTEURS CUMULÉS — la seule façon de PROUVER qu'une connexion disparaît.
 *
 * `abonnes.size` seul ne distingue pas « aucun onglet ouvert » de « les
 * fermetures ne sont jamais traitées et le compteur a été remis à zéro par un
 * redémarrage ». Deux cumuls le disent : si `ouvertes - fermees` s'éloigne
 * durablement de `abonnes.size`, une fermeture n'est pas traitée.
 *
 * Ce sont des NOMBRES. Aucune identité, aucune adresse, aucun horodatage
 * conservé après la déconnexion : rien qui grandisse sans borne.
 */
let ouvertes = 0;
let fermees = 0;

/**
 * S'ABONNE. Rend la fonction de désabonnement.
 *
 * L'appelant fournit `envoyer(evenement)` — le contrôleur sait écrire sur SON
 * flux, ce service n'a pas à connaître HTTP.
 */
export function subscribe(envoyer, { label = 'manager', fermer = null } = {}) {
  const abonne = { envoyer, fermer, label, depuis: Date.now() };
  abonnes.add(abonne);
  ouvertes += 1;
  logger.info(`[ui-live] abonné connecté (${label}) — ${abonnes.size} au total.`);
  return () => {
    if (abonnes.delete(abonne)) {
      fermees += 1;
      logger.info(`[ui-live] abonné déconnecté (${label}) — ${abonnes.size} restant(s).`);
    }
  };
}

/**
 * FERME TOUS LES FLUX — appelé à l'entrée en drainage.
 *
 * ══ CE N'EST PAS UNE PRÉCAUTION, C'EST UNE CONDITION D'ARRÊT ════════════════
 *
 * `server.close()` n'appelle son rappel que lorsque la DERNIÈRE connexion est
 * fermée. Un flux NDJSON ne se ferme jamais de lui-même — son battement de
 * maintien le garde ouvert indéfiniment, c'est son travail. Un seul Manager
 * ouvert suffisait donc à faire expirer le délai de grâce de 10 secondes :
 * l'arrêt se terminait par `process.exit(1)`, base jamais refermée proprement,
 * et un `reload` PM2 se soldait par un code d'erreur sur un arrêt normal.
 *
 * On prévient d'abord (`live.closing`) : le client sait alors que la coupure
 * est VOULUE, et sa reconnexion normale le rebranchera sur le process suivant.
 *
 * FLUX FERMÉ ≠ DONNÉE PERDUE : rien de métier ne transite ici.
 */
export function closeAllSubscribers({ reason = 'shutdown' } = {}) {
  const total = abonnes.size;
  if (total === 0) return { closed: 0 };
  for (const abonne of [...abonnes]) {
    try {
      abonne.envoyer({ type: 'live.closing', reason });
    } catch { /* déjà mort : la fermeture ci-dessous s'en charge */ }
    try {
      abonne.fermer?.();
    } catch { /* le retrait reste garanti par la ligne suivante */ }
    if (abonnes.delete(abonne)) fermees += 1;
  }
  logger.info(`[ui-live] ${total} flux fermé(s) — ${reason}.`);
  return { closed: total };
}

/**
 * ANNONCE QU'UNE RESSOURCE A CHANGÉ — APRÈS sa persistance, jamais avant.
 *
 * ══ L'ORDRE EST LA SEULE CHOSE QUI COMPTE ICI ═══════════════════════════════
 *
 * Émettre avant l'écriture ouvrirait une fenêtre où le navigateur redemande la
 * donnée et reçoit l'ANCIENNE — puis ne redemande plus jamais, puisqu'il a
 * déjà été prévenu. Un écran resterait alors périmé, et rien ne le signalerait.
 *
 * Ne lève JAMAIS : une notification d'interface qui échoue ne doit pas faire
 * échouer l'écriture métier qui vient de réussir.
 */
export function notifyResourceChanged(resource, meta = {}) {
  try {
    if (!RESSOURCES_CONNUES.has(resource)) {
      logger.warn(`[ui-live] ressource inconnue ignorée : ${resource}`);
      return { notified: 0 };
    }
    if (abonnes.size === 0) return { notified: 0 };

    /**
     * AUCUNE DONNÉE MÉTIER DANS L'ÉVÉNEMENT.
     *
     * Ni nom d'entreprise, ni statut, ni identifiant de contrat. Le seul fait
     * transporté est « cette ressource a changé ». Deux raisons, et elles
     * suffisent : le flux ne doit pas devenir une seconde vérité que le
     * navigateur pourrait afficher sans l'avoir demandée, et il ne doit pas
     * répandre de contenu que l'API n'aurait pas autorisé à ce lecteur.
     *
     * `reason` est un mot-clé technique (`PANEL_PUSH`, `PANEL_PULL`) — utile
     * au diagnostic, sans valeur métier.
     */
    const evenement = {
      type: 'resource.changed',
      resource,
      sequence: (sequence += 1),
      at: new Date().toISOString(),
      ...(meta.reason ? { reason: String(meta.reason).slice(0, 40) } : {}),
    };

    let livres = 0;
    for (const abonne of [...abonnes]) {
      try {
        abonne.envoyer(evenement);
        livres += 1;
      } catch {
        // Un abonné mort ne bloque pas les autres : il sera retiré par la
        // fermeture de sa propre connexion.
        abonnes.delete(abonne);
      }
    }
    logger.info(`[ui-live] ${resource} → ${livres} abonné(s).`);
    return { notified: livres };
  } catch (err) {
    logger.warn(`[ui-live] notification impossible : ${err?.message ?? err}`);
    return { notified: 0 };
  }
}

/**
 * Observabilité — jamais le contenu, seulement les comptes.
 *
 * `opened - closed` doit rester égal à `subscribers`. L'écart est la mesure
 * exacte d'une fuite d'abonnés, et il ne demande aucun outillage pour être lu.
 */
export function describeUiLive() {
  return {
    subscribers: abonnes.size,
    opened: ouvertes,
    closed: fermees,
    leaked: ouvertes - fermees - abonnes.size,
    eventsEmitted: sequence,
    resources: [...RESSOURCES_CONNUES],
  };
}

/** Réinitialisation — tests uniquement. */
export function resetUiLiveForTests() {
  abonnes.clear();
  sequence = 0;
  ouvertes = 0;
  fermees = 0;
}

/**
 * L'INSCRIPTION VIT ICI — voir `runtimeLifecycle`. Le point d'entrée n'a pas à
 * savoir qu'il existe des flux ouverts ; ce module, si.
 */
onDrain(() => closeAllSubscribers({ reason: 'shutdown' }), { label: 'flux live' });

export default {
  UI_RESOURCE,
  subscribe,
  notifyResourceChanged,
  closeAllSubscribers,
  describeUiLive,
  resetUiLiveForTests,
};
