import { SiteStatus } from '../models/SiteStatus.model.js';
import { Contract } from '../models/Contract.model.js';
import { getSingleton } from '../utils/singleton.js';
import { SITE_STATUS } from '../utils/constants.js';
import { SITE_SERVEABLE_STATUSES } from '../utils/contractConstants.js';
import { logContractAudit } from '../models/ContractAuditLog.model.js';
import { AUDIT_ACTOR_TYPE, CONTRACT_AUDIT_ACTION } from '../utils/contractConstants.js';
import { notifyResourceChanged, UI_RESOURCE } from './uiLive/uiLive.service.js';

/**
 * Enforcement du statut du site. RÈGLE (source de vérité backend) :
 *
 *   accessible = !suspensionTechnique && contratHonoré
 *   contratHonoré = protection désactivée ? true : (contrat ACTIVE / CANCEL_AT_PERIOD_END)
 *
 * Ainsi :
 *  - aucun contrat actif + protection ON   -> suspendu (source CONTRACT) ;
 *  - contrat résilié en fin de période      -> reste actif jusqu'à l'échéance ;
 *  - contrat terminé (ENDED)                -> suspendu ;
 *  - suspension technique                   -> suspendu quel que soit le contrat ;
 *  - lever la suspension technique ne réactive PAS un site sans contrat.
 *
 * ── LA PROTECTION EST UN RÉGLAGE, PLUS UN DRAPEAU D'ENVIRONNEMENT ───────────
 * `contractProtectionEnabled` vit sur la fiche `SiteStatus` : c'est LA source
 * de vérité, et elle est unique. Le Manager l'écrit par son API ; le Panel la
 * demande par une opération du pont. Aucun des deux ne détient sa propre
 * copie — le Panel lit l'état du projet, il ne le déduit pas.
 *
 * Ce module reste le SEUL endroit où se décide « ce site doit être suspendu ».
 * Aucun contrôleur, aucun écran ne refait ce calcul : un `if (!contract)`
 * ailleurs ferait diverger l'affichage de la réalité servie.
 */

/** Existe-t-il un contrat « honoré » (servable) dans l'environnement courant ? */
export async function findServeableContract() {
  return Contract.findOne({
    status: { $in: SITE_SERVEABLE_STATUSES },
    archived: false,
  });
}

/**
 * Recalcule et persiste le statut du site. Idempotent. Renvoie le document.
 * @param {{actor?:object}} [opts]
 */
export async function reconcileSiteStatus({ actor } = {}) {
  const site = await getSingleton(SiteStatus);
  const technicalActive = Boolean(site.technicalSuspension?.active);

  const serveable = await findServeableContract();
  // La protection se lit sur la fiche, jamais sur l'environnement : c'est ce
  // qui permet de l'activer sans redémarrer, et d'en avoir UNE seule valeur.
  const protectionEnabled = Boolean(site.contractProtectionEnabled);
  const contractHonoured = protectionEnabled ? Boolean(serveable) : true;

  /**
   * LE DÉFAUT DE PAIEMENT — TROISIÈME CONDITION, INDÉPENDANTE (L10.6).
   *
   * Elle vient du PANEL, qui est l'autorité de la politique de grâce. Ce
   * service reste l'autorité de l'accessibilité : il ne décide pas qu'un
   * paiement manque, il en tient compte.
   */
  const paymentDefaultActive = Boolean(site.paymentDefault?.active);

  /**
   * ══ L'ACCESSIBILITÉ EST UNE CONJONCTION, ET C'EST TOUT LE POINT ══════════
   *
   * Trois conditions indépendantes, toutes nécessaires. Aucune ne peut lever
   * les autres : régulariser un impayé retire UNE cause, il ne rouvre pas un
   * site en maintenance. C'est la raison pour laquelle la résolution d'un
   * paiement n'écrit jamais `status = ACTIVE` nulle part — elle retire une
   * cause, et cette ligne-ci recalcule.
   */
  const accessible = !technicalActive && contractHonoured && !paymentDefaultActive;

  /**
   * LA SOURCE DOMINANTE — une ÉTIQUETTE d'affichage, jamais un stockage.
   *
   * L'ordre de priorité place le défaut de paiement APRÈS les deux causes
   * historiques : une maintenance technique explique mieux une fermeture qu'un
   * impayé, et un contrat éteint la rend définitive là où un impayé se règle.
   * Le client doit lire la cause sur laquelle il peut agir en dernier.
   */
  let source = 'NONE';
  let reason = '';
  let relatedContractId = null;
  if (technicalActive) {
    source = 'TECHNICAL';
    reason = site.technicalSuspension.reason || 'Maintenance technique';
  } else if (!contractHonoured) {
    source = 'CONTRACT';
    reason = 'Aucun contrat actif';
  } else if (paymentDefaultActive) {
    source = 'PAYMENT_DEFAULT';
    /** Le motif EXACT du contrat de service. Jamais reformulé. */
    reason = site.paymentDefault.reason || 'Défaut de paiement';
    if (serveable) relatedContractId = serveable._id;
  } else if (serveable) {
    relatedContractId = serveable._id;
  }

  const nextStatus = accessible ? SITE_STATUS.ACTIVE : SITE_STATUS.SUSPENDED;
  const wasStatus = site.status;

  site.status = nextStatus;
  site.suspensionSource = source;
  /**
   * L'INSTANTANÉ DES CAUSES — écrit par le SEUL endroit qui les calcule (L10.6A).
   *
   * `suspensionSource` ne nomme que la cause dominante : suffisant pour un
   * écran, faux pour une preuve. Une maintenance ET un impayé coexistent
   * parfaitement, et c'est la maintenance qui s'affiche — un lecteur distant en
   * conclurait à tort que l'impayé n'a pas été pris en compte.
   *
   * Les trois conditions sont donc persistées telles qu'elles viennent d'être
   * évaluées, à l'endroit même où elles le sont. Les recalculer ailleurs — dans
   * la projection, dans le Panel — créerait une seconde formule d'accessibilité,
   * et deux formules finissent par diverger.
   */
  site.causes = {
    technical: technicalActive,
    /** VRAI quand l'absence de contrat honoré suspend RÉELLEMENT. */
    contract: !contractHonoured,
    paymentDefault: paymentDefaultActive,
  };
  site.reason = accessible ? '' : reason;
  site.suspendedAt = accessible ? null : site.suspendedAt || new Date();
  site.suspendedBy = source === 'TECHNICAL' ? site.technicalSuspension.suspendedBy || '' : '';
  site.relatedContractId = relatedContractId;
  await site.save();

  /**
   * PRÉVENIR LES ÉCRANS OUVERTS — après l'écriture, jamais avant.
   *
   * C'est ici, et nulle part ailleurs, que l'état du site devient persistant :
   * les trois `site.save()` du dépôt vivent dans ce service, et les neuf
   * chemins de mutation y convergent. Un écran du Manager qui affiche
   * l'accessibilité du site n'a donc qu'un seul endroit à écouter.
   *
   * L'événement ne transporte rien : le navigateur redemande l'état à l'API.
   */
  notifyResourceChanged(UI_RESOURCE.SITE_STATUS, { reason: 'RECONCILE' });

  if (wasStatus !== nextStatus) {
    await logContractAudit({
      contractId: relatedContractId || serveable?._id || null,
      action: accessible ? CONTRACT_AUDIT_ACTION.SITE_ACTIVATED : CONTRACT_AUDIT_ACTION.SITE_SUSPENDED,
      actorType: actor ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.SYSTEM,
      actorId: actor?._id || null,
      metadataSafe: { source, contractProtectionEnabled: protectionEnabled },
    });
  }
  return site;
}

/**
 * Active ou désactive la PROTECTION CONTRACTUELLE, puis réconcilie.
 *
 * Le seul point d'écriture du réglage — Manager et Panel passent tous deux
 * par ici. La réconciliation est faite dans la foulée : sans elle, activer la
 * protection sur un site sans contrat laisserait l'écran annoncer une
 * protection active pendant que le site continue d'être servi.
 *
 * Idempotent : reposer la même valeur ne journalise rien et ne change rien.
 *
 * @param {{enabled: boolean, actor?: object}} params
 */
export async function setContractProtection({ enabled, actor } = {}) {
  const site = await getSingleton(SiteStatus);
  const next = Boolean(enabled);
  const previous = Boolean(site.contractProtectionEnabled);

  if (next !== previous) {
    site.contractProtectionEnabled = next;
    await site.save();
    await logContractAudit({
      contractId: site.relatedContractId ?? null,
      action: CONTRACT_AUDIT_ACTION.CONTRACT_PROTECTION_CHANGED,
      actorType: actor ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.SYSTEM,
      actorId: actor?._id || null,
      metadataSafe: { from: previous, to: next, origin: actor?.origin || 'MANAGER' },
    });
  }

  // Réconcilier même sans changement : c'est ce qui rend l'opération sûre à
  // rejouer, et ce qui rattrape un statut resté en retard sur son réglage.
  return reconcileSiteStatus({ actor });
}

/**
 * APPLIQUE OU RETIRE LA SUSPENSION MANUELLE, puis réconcilie (L10.6 FINAL).
 *
 * ══ CE N'EST PAS UNE AUTORITÉ SUR LE RÉSULTAT ══════════════════════════════
 *
 * Cette fonction pose une CAUSE. Elle n'écrit jamais `status`, ni ici ni
 * ailleurs : c'est `reconcileSiteStatus` qui tranche, et lui seul. La nuance
 * porte tout le lot —
 *
 *   suspendre un site DÉJÀ fermé pour impayé   ne change aucun statut
 *   lever la cause manuelle d'un site en impayé  ne rouvre RIEN
 *
 * Un `site.status = 'ACTIVE'` dans le chemin de reprise aurait rouvert un site
 * dont l'abonnement n'est pas payé, ou dont le contrat est éteint. Un garde-fou
 * statique interdit cette écriture dans ce fichier.
 *
 * ══ IDEMPOTENTE PAR CONSTRUCTION ═══════════════════════════════════════════
 *
 * L'écriture est un REMPLACEMENT d'état, pas une bascule. Huit clics
 * simultanés sur « Suspendre » posent huit fois la même cause et produisent
 * UNE transition — `wasActive !== next` ne devient vrai que pour le premier, et
 * c'est lui seul qui journalise et notifie.
 *
 * ══ LA NOTIFICATION N'EST PAS DANS CE CHEMIN ═══════════════════════════════
 *
 * Elle est RENDUE à l'appelant, jamais attendue ici. La suspension est un fait
 * métier acquis dès `save()` + réconciliation ; un e-mail est une conséquence.
 * Les enchaîner ferait dépendre la fermeture d'un site de la disponibilité de
 * Brevo — et un `await` malheureux annulerait une suspension parce qu'un
 * fournisseur d'e-mail est en panne.
 *
 * @returns {Promise<{site: object, transitioned: boolean, notice: object|null}>}
 */
export async function setTechnicalSuspension({
  active, reason, actorEmail, actor, notifyAdmins = false,
}) {
  const site = await getSingleton(SiteStatus);
  const next = Boolean(active);
  const wasActive = Boolean(site.technicalSuspension?.active);

  /** Le motif TEL QU'IL A ÉTÉ SAISI. Vide reste vide — voir plus bas. */
  const motif = next ? String(reason ?? '').trim() : '';
  const veutPrevenir = next ? notifyAdmins === true : false;
  const maintenant = new Date();

  site.technicalSuspension = {
    active: next,
    /**
     * ══ LE MOTIF ABSENT RESTE ABSENT ═════════════════════════════════════
     *
     * On ne persiste PAS la chaîne « Aucun ». Ce serait inscrire une phrase
     * d'affichage dans une donnée métier : le jour où l'écran se traduit, ou
     * bien la base ment, ou bien il faut la migrer. Le rendu dira « Aucun » ;
     * la vérité, ici, est la chaîne vide.
     */
    reason: motif,
    suspendedAt: next ? maintenant : null,
    suspendedBy: next ? actorEmail || '' : '',
    notifyAdminsRequested: veutPrevenir,
    /** La dernière levée SURVIT à l'état courant — voir le modèle. */
    liftedAt: !next && wasActive ? maintenant : (site.technicalSuspension?.liftedAt ?? null),
    liftedBy: !next && wasActive
      ? (actorEmail || '')
      : (site.technicalSuspension?.liftedBy ?? ''),
  };
  await site.save();

  const apres = await reconcileSiteStatus({ actor });

  /**
   * ══ LA PREUVE DURABLE — écrite pour l'ACTE, pas pour son résultat ═══════
   *
   * `reconcileSiteStatus` journalise déjà `SITE_SUSPENDED`/`SITE_ACTIVATED`
   * quand l'accessibilité BASCULE. Cela ne suffit pas : poser une suspension
   * manuelle sur un site déjà fermé pour impayé ne fait basculer aucun statut,
   * et l'acte n'aurait laissé aucune trace.
   *
   * On journalise donc la TRANSITION DE LA CAUSE, avec son motif, son auteur
   * et l'intention de prévenir. `logContractAudit` ne lève jamais : un journal
   * ne défait pas une suspension.
   */
  const transitioned = wasActive !== next;
  if (transitioned) {
    await logContractAudit({
      contractId: apres?.relatedContractId ?? null,
      action: next
        ? CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_APPLIED
        : CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_LIFTED,
      actorType: actor ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.SYSTEM,
      actorId: actor?._id || null,
      metadataSafe: {
        /** Le motif RÉEL. `null` quand il n'y en a pas — jamais « Aucun ». */
        reason: next ? (motif || null) : null,
        actorEmail: actorEmail || null,
        notifyAdminsRequested: veutPrevenir,
        /**
         * L'état du site APRÈS l'acte. C'est ce qui rend le journal lisible :
         * « suspension manuelle posée, site déjà fermé pour impayé » se
         * distingue de « suspension manuelle posée, site fermé de ce fait ».
         */
        siteStatus: apres?.status ?? null,
        otherCauses: {
          contract: Boolean(apres?.causes?.contract),
          paymentDefault: Boolean(apres?.causes?.paymentDefault),
        },
      },
    });
  }

  /**
   * L'APPELANT DÉCIDE QUOI FAIRE DE L'INTENTION. Ce service ne connaît ni
   * Brevo, ni template, ni destinataire — il rend un fait, et le contrôleur
   * déclenche l'annonce sans que le métier en dépende.
   */
  return {
    site: apres,
    transitioned,
    notice: transitioned && next && veutPrevenir
      ? { reason: motif || null, actorEmail: actorEmail || null, at: maintenant }
      : null,
  };
}
