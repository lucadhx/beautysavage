/**
 * DÉCLENCHEURS DE SYNCHRONISATION — un seul abonnement, pas un service touché.
 *
 * ── POURQUOI PAR HOOK DE MODÈLE ─────────────────────────────────────────────
 * Le contrat seul est écrit depuis une dizaine d'endroits (`contract.service`,
 * `payment.service`, `subscription.service`). Instrumenter chaque appel aurait
 * été fragile — un point oublié, et la modification n'arrive jamais au Panel —
 * et dupliqué. Un `post('save')` par modèle couvre TOUS les appelants, présents
 * et futurs, sans qu'aucun service n'ait à connaître le pont.
 *
 * ── CE QUE LES HOOKS NE FONT PAS ────────────────────────────────────────────
 * Ils n'appellent jamais le Panel, ne bloquent jamais la sauvegarde, et ne
 * lèvent jamais. Ils constatent qu'un champ PERTINENT a changé et demandent une
 * projection ; tout le reste — mise en file, envoi, reprise — appartient à
 * l'outbox.
 *
 * ── PROTECTIONS ─────────────────────────────────────────────────────────────
 * · seeds et migrations : le module n'est branché qu'au bootstrap applicatif,
 *   `isSyncWired()` est faux avant ;
 * · réécritures sans changement métier : on inspecte les chemins réellement
 *   modifiés, pas le simple fait qu'un `save()` a eu lieu ;
 * · boucles : le projet n'applique JAMAIS une écriture qu'il a lui-même
 *   émise — ces trois modèles ne sont pas alimentés par le pull du Panel.
 */
import { recordSyncIncident, SYNC_INCIDENT } from '../panelBridge/syncIncidents.js';
import logger from '../../utils/logger.js';
import { onEntitySaved, onFactReported } from '../../utils/syncNotifier.js';
import { isSyncWired, reportPlatformIncident, scheduleProjection } from './projectSync.service.js';
import { projectMember, projectMemberRemoval, reconcileTeam } from './teamSync.service.js';
import { notifyResourceChanged, UI_RESOURCE } from '../uiLive/uiLive.service.js';

/** Champs de `Company` qui changent l'identité PUBLIQUE du projet. */
const COMPANY_PATHS = ['name', 'tagline', 'logos', 'media'];

/** Champs de la Configuration Système qui changent les adresses publiques. */
const NETWORK_PATHS = ['network'];

/**
 * Champs du contrat que le Panel projette réellement.
 *
 * `document`, `signatureConfiguration` et `yousign` en font partie depuis que
 * la projection porte les métadonnées du document. Ils manquaient, et le
 * symptôme était parlant : déposer un PDF dans le Manager n'écrivait QUE
 * `document.originalFilename` — aucun chemin surveillé ne bougeait, donc rien
 * ne partait. Le Panel affichait « non généré » sur un contrat qui avait bel
 * et bien son document, jusqu'au prochain redémarrage du projet.
 *
 * La règle est simple et vaut pour la suite : tout champ LU par une projection
 * doit être SURVEILLÉ par son déclencheur. Un test le vérifie désormais en
 * comparant les deux listes.
 */
const CONTRACT_PATHS = [
  'status', 'reference', 'activation', 'pricing', 'archived',
  /**
   * `signature` A REJOINT LA LISTE, ET `yousign` Y RESTE.
   *
   * Le déclencheur surveillait le bloc `yousign`. Il n'est plus ÉCRIT : une
   * signature qui progressait ne faisait donc plus rien partir, et le Panel
   * gardait l'état d'avant — sans erreur, sans journal, jusqu'au prochain
   * redémarrage du projet. Exactement le symptôme qui avait motivé l'ajout de
   * `document` en son temps.
   *
   * L'ancien nom reste surveillé : une reprise de données qui écrirait encore
   * dedans doit continuer de déclencher. Il partira avec le bloc.
   */
  'document', 'signatureConfiguration', 'signature', 'yousign',
  // La projection publie désormais la DATE DE FIN des contrats passés, et elle
  // vit sous `stripe.subscription` — la projection lisible de l'abonnement.
  // Sans ce chemin, une résiliation enregistrée par le prestataire de paiement
  // n'aurait rien fait partir : l'historique du Panel resterait daté d'avant la
  // fin du contrat.
  'stripe',
  // Le parcours de signature est publié : basculer « signature requise » doit
  // repartir immédiatement, sans quoi le Panel continuerait d'annoncer une
  // signature en attente sur un contrat qui n'en demande plus.
  'signatureRequirement',
  /**
   * ── LES DEUX POLITIQUES DU CONTRAT ────────────────────────────────────────
   *
   * `taxRate` et `paymentGraceDays` sont lus par la projection depuis L10.5 et
   * L10.6B-1. Ils manquaient ici, et le garde-fou de la section 5 le disait
   * déjà : « aucun champ lu par la projection n'échappe à un déclencheur
   * (taxRate) ». Le symptôme était silencieux et durable — changer le taux de
   * TVA dans le Manager n'atteignait le Panel qu'au redémarrage suivant, ou
   * par raccroc quand un AUTRE champ surveillé bougeait.
   *
   * Pour le délai de grâce l'enjeu est plus net encore : la politique doit
   * pouvoir être corrigée PENDANT un impayé, et cette correction n'a de valeur
   * que si elle part tout de suite.
   */
  'taxRate',
  'paymentGraceDays',
];

/**
 * Un des chemins surveillés a-t-il changé ?
 *
 * Les chemins arrivent CAPTURÉS avant la sauvegarde : Mongoose les efface une
 * fois le document écrit, et un hook `post` ne verrait plus rien bouger. Une
 * réécriture technique qui ne touche aucun champ surveillé n'émet donc pas —
 * `'*'` (document neuf ou supprimé) émet toujours.
 */
function touched(changedPaths, watched) {
  if (!Array.isArray(changedPaths)) return false;
  if (changedPaths.includes('*')) return true;
  return changedPaths.some((p) => watched.some((w) => p === w || p.startsWith(`${w}.`)));
}

/**
 * Programme une projection sans jamais laisser une erreur remonter — mais
 * sans jamais l'effacer non plus.
 *
 * Un déclencheur qui échoue est le premier maillon de la chaîne live : rien,
 * ensuite, ne saura qu'il fallait projeter. C'est donc un incident FRANC, pas
 * un avertissement de confort.
 */
function trigger(kind, changedPaths, watched) {
  try {
    if (!isSyncWired()) return;
    if (!touched(changedPaths, watched)) return;
    scheduleProjection(kind);
  } catch (err) {
    recordSyncIncident(
      SYNC_INCIDENT.TRIGGER_FAILED,
      { step: 'trigger', entityType: kind, reason: err.code || err.message },
      'error',
    );
  }
}

/**
 * PRÉVIENT LES ÉCRANS OUVERTS — et c'est une chaîne DIFFÉRENTE de la projection.
 *
 * ══ POURQUOI PAS DANS `trigger()` ═══════════════════════════════════════════
 *
 * `trigger()` sort tout de suite si `isSyncWired()` est faux. C'est correct
 * pour la projection : un projet non appairé n'a aucun Panel à prévenir. Mais
 * son PROPRE Manager, lui, est toujours ouvert devant quelqu'un. Faire dépendre
 * le rafraîchissement d'un écran local de l'existence d'un Panel distant
 * confondrait deux problèmes qui n'ont rien à voir.
 *
 * ══ APRÈS LA PERSISTANCE, JAMAIS AVANT ═════════════════════════════════════
 *
 * Ce chemin part d'un `post('save')` : la donnée est écrite quand on arrive
 * ici. Prévenir plus tôt ferait relire l'ANCIENNE valeur — et l'écran, déjà
 * prévenu, ne redemanderait plus jamais.
 *
 * Le filtre de pertinence est le MÊME que celui de la projection : une
 * réécriture technique qui ne touche aucun champ affiché ne doit pas faire
 * clignoter un écran.
 */
function notifyUi(resource, changedPaths, watched) {
  try {
    if (!touched(changedPaths, watched)) return;
    notifyResourceChanged(resource, { reason: 'LOCAL_SAVE' });
  } catch {
    // Une notification d'interface ne remonte jamais vers l'écriture métier :
    // la donnée est déjà persistée, et un rechargement de page la montrera.
  }
}

/**
 * Branche les déclencheurs. Appelé UNE fois, au bootstrap.
 *
 * Les hooks Mongoose eux-mêmes vivent dans les fichiers de MODÈLE : posés
 * après `mongoose.model()`, ils ne seraient jamais rejoués. Les modèles ne
 * font qu'ANNONCER leur sauvegarde (`notifyEntitySaved`) ; c'est ici qu'on
 * décide si le changement mérite une projection.
 */
export function installSyncTriggers() {
  onEntitySaved((kind, changedPaths, meta = {}) => {
    if (kind === 'COMPANY') trigger('PROJECT_PRESENTATION', changedPaths, COMPANY_PATHS);
    else if (kind === 'NETWORK') trigger('PROJECT_PRESENTATION', changedPaths, NETWORK_PATHS);
    else if (kind === 'CONTRACT') {
      trigger('CONTRACT', changedPaths, CONTRACT_PATHS);
      /**
       * ── LE CONTRAT CHANGE SANS QUE PERSONNE N'AIT CLIQUÉ ────────────────
       *
       * Un paiement confirmé par Stripe, une signature achevée chez Yousign,
       * une échéance atteinte, une correction administrative faite depuis un
       * autre poste : aucun de ces faits ne naît dans l'onglet ouvert. « Mon
       * contrat » charge une fois au montage — il affichait donc ACTIF un
       * contrat terminé, jusqu'au rechargement.
       *
       * C'est exactement le défaut que le canal live a fermé pour la fiche
       * d'entreprise. Le scope existait déjà, déclaré des deux côtés, mais
       * personne ne l'émettait ni ne l'écoutait.
       */
      notifyUi(UI_RESOURCE.CONTRACT, changedPaths, CONTRACT_PATHS);
    }
    /**
     * ÉTAT DU SITE — un agrégat À PART, et surveillé en entier.
     *
     * ══ POURQUOI AUCUNE LISTE DE CHEMINS ═══════════════════════════════════
     *
     * `Company` et `Contract` portent des champs que le Panel n'affiche pas :
     * on filtre donc, pour ne pas projeter à chaque réécriture technique.
     * `SiteStatus` est l'inverse — tout ce qu'il contient décrit
     * l'accessibilité du site, et le Panel affiche tout. Une liste de chemins
     * n'y ferait qu'ajouter un endroit de plus à oublier de mettre à jour, ce
     * qui est exactement le défaut que la règle « tout champ LU doit être
     * SURVEILLÉ » cherche à empêcher.
     *
     * ══ ET POURQUOI PAS SOUS `CONTRACT` ════════════════════════════════════
     *
     * Une suspension TECHNIQUE n'est pas un fait contractuel. Les mêler ferait
     * arriver une maintenance sous l'étiquette « contrat » — et rendrait la
     * fiche du Panel incapable de dire pourquoi un site est coupé.
     */
    else if (kind === 'SITE_STATUS') trigger('SITE_STATUS', changedPaths, ['*']);
    // ÉQUIPE — pas de regroupement : chaque membre est une entité distincte,
    // et deux créations successives ne sont pas deux versions d'un même état.
    else if (kind === 'TEAM_MEMBER') safely(() => projectMember(meta.userId));
    else if (kind === 'TEAM_MEMBER_REMOVED') safely(() => projectMemberRemoval(meta.userId));
    // Suppression en lot : les partants ne sont pas nommables, on reprend la
    // photographie complète — elle produira les tombstones manquants.
    else if (kind === 'TEAM_ROSTER') safely(() => reconcileTeam());
  });
  /**
   * LES FAITS — canal distinct des états (L12.1).
   *
   * Un incident technique ne se « projette » pas : il n'a pas de dernière
   * valeur à réconcilier, et deux incidents ne s'écrasent pas. Il est donc mis
   * en file directement, avec une identité dérivée des faits.
   *
   * C'est ici que le découplage se referme : le handler métier annonce, le pont
   * rapporte. Aucun composant métier ne connaît la file.
   */
  onFactReported((kind, payload) => {
    if (kind !== 'PLATFORM_INCIDENT') return;
    void reportPlatformIncident(payload.incident, { eventId: payload.eventId ?? null });
  });

  logger.info('[sync] déclencheurs branchés (entreprise, réseau, contrat, équipe, incidents).');
}

/**
 * Une projection ratée ne remonte jamais vers l'écriture métier — et laisse
 * toujours une trace exploitable.
 */
function safely(action) {
  const signaler = (err) => recordSyncIncident(
    SYNC_INCIDENT.TRIGGER_FAILED,
    { step: 'trigger', entityType: 'TEAM_MEMBER', reason: err?.code || err?.message },
    'error',
  );
  try {
    void Promise.resolve(action()).catch(signaler);
  } catch (err) {
    signaler(err);
  }
}

export default { installSyncTriggers };
