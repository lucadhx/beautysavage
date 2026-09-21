import type { Contract } from '@/types';

/**
 * OÙ EN EST CE CONTRAT — une seule réponse, pour le DEV comme pour le client.
 *
 * ── LE DÉFAUT QUI A CRÉÉ CE MODULE ──────────────────────────────────────────
 * La scène du parcours DEV décidait de ce qu'elle affichait par une cascade de
 * ternaires dans le JSX : `ACTIVE ? … : PENDING_DEV_SIGNATURE ? … : devSigned ?
 * … : FAILED ? … : « Contrat en attente / pas encore parti à la signature »`.
 * Ce dernier cas n'était pas un état : c'était le RESTE. Un contrat validé sans
 * signature requise y tombait — il attendait un règlement, l'écran annonçait une
 * signature qui n'aurait jamais lieu.
 *
 * Le calcul métier, lui, existait déjà et était juste : `deriveActivationStep`
 * côté serveur publie `contract.step`, et `signatureSatisfied` y répond vrai
 * quand la signature n'est pas requise — l'étape SIGNATURE n'apparaît donc
 * jamais dans ce cas. Ce module ne recalcule rien : il traduit l'état réel en
 * écran. Le seul jugement qu'il porte est un ORDRE DE PRIORITÉ, celui qui
 * empêche une étape de configuration d'écraser une étape financière plus
 * actuelle.
 *
 * Module PUR (aucun React, aucun import runtime) : testable sous Node.
 */

export type ContractPhase =
  | 'DRAFT'
  | 'DEV_SIGNATURE'
  | 'CLIENT_SIGNATURE'
  | 'LAUNCH_FEE'
  | 'SUBSCRIPTION'
  | 'READY_TO_ACTIVATE'
  | 'ACTIVATING'
  | 'LIVE'
  | 'ENDING'
  | 'ENDED'
  | 'CANCELLED'
  | 'FAILED';

export type PresentationTone = 'neutral' | 'info' | 'action' | 'success' | 'warning' | 'danger';

/** Qui doit agir. `NOBODY` : le contrat avance seul (webhook) ou est clos. */
export type ContractActor = 'DEV' | 'CLIENT' | 'NOBODY';

export type PresentationAudience = 'DEV' | 'ADMIN';

export interface ContractPresentation {
  phase: ContractPhase;
  tone: PresentationTone;
  /** État principal, court — celui du badge. */
  badge: string;
  title: string;
  description: string;
  /** Prochaine étape métier, ou `null` s'il n'y a plus rien à attendre. */
  next: string | null;
  /**
   * Sous-état affiché À CÔTÉ de l'état principal, jamais à sa place : une
   * signature non requise ne remplace pas « frais à régler ».
   */
  signatureNote: string | null;
  signatureRequired: boolean;
  actor: ContractActor;
}

/**
 * PRIORITÉ DES ÉTATS — du plus définitif au plus provisoire.
 *
 * Un contrat clos n'est pas « en préparation », et une étape financière en
 * cours prime sur tout ce qui relève de la configuration. L'ordre est donc :
 *
 *   1. clos (terminé, annulé, en échec) ;
 *   2. en vie (actif, résilié à l'échéance) ;
 *   3. activation déjà lancée ;
 *   4. brouillon — le contrat n'existe pas encore officiellement ;
 *   5. l'étape du parcours, telle que le serveur la dérive : signature (si
 *      requise), frais, abonnement, activation.
 *
 * Les étapes 1 à 4 se lisent sur `status`. La 5 se lit sur `step`, et sur rien
 * d'autre : c'est la machine métier, elle a déjà tranché.
 */
export function getContractPresentationState(
  contract: Contract,
  audience: PresentationAudience = 'DEV',
): ContractPresentation {
  const signatureRequired = contract.signatureApplicable !== false;
  const phase = derivePhase(contract, signatureRequired);
  const copy = COPY[audience][phase](contract);

  return {
    phase,
    tone: TONE[phase],
    badge: BADGE[phase],
    title: copy.title,
    description: copy.description,
    next: NEXT[audience][phase],
    // Le sous-état ne s'affiche que là où il éclaire quelque chose : sur un
    // contrat clos, la question ne se pose plus.
    signatureNote: !signatureRequired && !CLOSED.includes(phase) ? 'Signature non requise' : null,
    signatureRequired,
    actor: ACTOR[phase],
  };
}

const CLOSED: ContractPhase[] = ['ENDED', 'CANCELLED', 'FAILED'];

function derivePhase(contract: Contract, signatureRequired: boolean): ContractPhase {
  switch (contract.status) {
    case 'ENDED': return 'ENDED';
    case 'CANCELLED': return 'CANCELLED';
    case 'FAILED': return 'FAILED';
    case 'ACTIVE': return 'LIVE';
    case 'CANCEL_AT_PERIOD_END': return 'ENDING';
    case 'ACTIVATION_IN_PROGRESS': return 'ACTIVATING';
    case 'DRAFT': return 'DRAFT';
    default: break;
  }

  switch (contract.step) {
    case 'SIGNATURE':
      /**
       * Filet, pas règle. Le serveur ne rend jamais SIGNATURE quand la
       * signature n'est pas requise (`signatureSatisfied` vaut alors vrai).
       * Si une charge utile ancienne le faisait quand même, on n'annonce pas
       * une signature qui n'aura pas lieu : on lit l'étape financière réelle.
       */
      if (!signatureRequired) return financialPhase(contract);
      return contract.devSigned ? 'CLIENT_SIGNATURE' : 'DEV_SIGNATURE';
    case 'LAUNCH_FEE': return 'LAUNCH_FEE';
    case 'SUBSCRIPTION': return 'SUBSCRIPTION';
    case 'ACTIVATION': return 'READY_TO_ACTIVATE';
    case 'DONE': return 'LIVE';
    default: return 'READY_TO_ACTIVATE';
  }
}

/** Prochaine étape financière réellement due, sinon l'activation. */
function financialPhase(contract: Contract): ContractPhase {
  if (contract.launchFeeRequired && !contract.launchFeeSatisfied) return 'LAUNCH_FEE';
  if (contract.subscriptionRequired && !contract.subscriptionSatisfied) return 'SUBSCRIPTION';
  return 'READY_TO_ACTIVATE';
}

const BADGE: Record<ContractPhase, string> = {
  DRAFT: 'Brouillon',
  DEV_SIGNATURE: 'En attente de signature',
  CLIENT_SIGNATURE: 'En attente de signature',
  LAUNCH_FEE: 'En attente du règlement des frais de mise en service',
  SUBSCRIPTION: "En attente du règlement de l'abonnement",
  READY_TO_ACTIVATE: 'Prêt à activer',
  ACTIVATING: 'Activation en cours',
  LIVE: 'Contrat actif',
  ENDING: "Résilié — actif jusqu'à l'échéance",
  ENDED: 'Contrat terminé',
  CANCELLED: 'Contrat annulé',
  FAILED: 'Parcours interrompu',
};

const TONE: Record<ContractPhase, PresentationTone> = {
  DRAFT: 'neutral',
  DEV_SIGNATURE: 'action',
  CLIENT_SIGNATURE: 'info',
  LAUNCH_FEE: 'action',
  SUBSCRIPTION: 'action',
  READY_TO_ACTIVATE: 'action',
  ACTIVATING: 'info',
  LIVE: 'success',
  ENDING: 'warning',
  ENDED: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

const ACTOR: Record<ContractPhase, ContractActor> = {
  DRAFT: 'DEV',
  DEV_SIGNATURE: 'DEV',
  CLIENT_SIGNATURE: 'CLIENT',
  LAUNCH_FEE: 'CLIENT',
  SUBSCRIPTION: 'CLIENT',
  READY_TO_ACTIVATE: 'CLIENT',
  ACTIVATING: 'NOBODY',
  LIVE: 'NOBODY',
  ENDING: 'NOBODY',
  ENDED: 'NOBODY',
  CANCELLED: 'NOBODY',
  FAILED: 'DEV',
};

/** La prochaine action, dite du point de vue de qui lit. */
const NEXT: Record<PresentationAudience, Record<ContractPhase, string | null>> = {
  DEV: {
    DRAFT: 'Terminer la préparation, puis valider le contrat',
    DEV_SIGNATURE: 'Signer le contrat',
    CLIENT_SIGNATURE: 'Signature du client',
    LAUNCH_FEE: 'Règlement des frais de mise en service par le client',
    SUBSCRIPTION: "Souscription de l'abonnement par le client",
    READY_TO_ACTIVATE: 'Mise en ligne du site par le client',
    ACTIVATING: 'Mise en ligne en cours',
    LIVE: null,
    ENDING: null,
    ENDED: null,
    CANCELLED: null,
    FAILED: 'Relancer le parcours depuis les détails du contrat',
  },
  ADMIN: {
    DRAFT: null,
    DEV_SIGNATURE: null,
    CLIENT_SIGNATURE: 'Signer votre contrat',
    LAUNCH_FEE: 'Régler les frais de mise en service',
    SUBSCRIPTION: "Activer l'abonnement",
    READY_TO_ACTIVATE: 'Mettre votre site en ligne',
    ACTIVATING: null,
    LIVE: null,
    ENDING: null,
    ENDED: null,
    CANCELLED: null,
    FAILED: null,
  },
};

type Copy = { title: string; description: string };
type CopyFor = (contract: Contract) => Copy;

/**
 * Le TEXTE diffère selon qui lit — l'ÉTAT, jamais.
 *
 * Le DEV voit le contrat qu'il pilote et peut lire un vocabulaire d'atelier ;
 * le client voit le sien et n'a pas à connaître le prestataire de signature ni
 * les statuts internes.
 * Deux tables de phrases, un seul calcul : c'est la seule duplication acceptable
 * ici, et elle ne peut pas produire deux états contradictoires.
 */
const COPY: Record<PresentationAudience, Record<ContractPhase, CopyFor>> = {
  DEV: {
    DRAFT: (c) => ({
      title: 'Contrat en préparation',
      description: c.signatureApplicable === false
        ? "Ce contrat n'est pas encore validé. Aucune signature ne sera demandée : une fois validé, il passera directement aux règlements."
        : "Ce contrat n'est pas encore validé. Terminez sa préparation : il partira ensuite à la signature.",
    }),
    DEV_SIGNATURE: () => ({
      title: 'Signez le contrat',
      description: 'Vous signez en premier ; le client reçoit la main juste après.',
    }),
    CLIENT_SIGNATURE: () => ({
      title: 'En attente de la signature du client',
      description: "Vous avez signé. Le client doit signer à son tour — vous n'avez plus rien à faire.",
    }),
    LAUNCH_FEE: () => ({
      title: 'En attente du règlement des frais de mise en service',
      description: "Le contrat est en place. Le client doit régler les frais de mise en service avant la suite.",
    }),
    SUBSCRIPTION: () => ({
      title: "En attente du règlement de l'abonnement",
      description: "Le client doit souscrire l'abonnement qui maintiendra son site en ligne.",
    }),
    READY_TO_ACTIVATE: () => ({
      title: 'Prêt à activer',
      description: "Tout est réuni. Il ne reste au client qu'à mettre son site en ligne.",
    }),
    ACTIVATING: () => ({
      title: 'Activation en cours',
      description: 'La mise en ligne est lancée. Cette page se met à jour toute seule.',
    }),
    LIVE: () => ({
      title: 'Le site du client est en ligne',
      description: "Le contrat est actif et le site est accessible au public. Il n'y a plus rien à faire.",
    }),
    ENDING: () => ({
      title: 'Résiliation programmée',
      description: "Le site reste actif jusqu'à l'échéance de la période en cours.",
    }),
    ENDED: () => ({
      title: 'Contrat terminé',
      description: "La période est arrivée à son terme et le site n'est plus accessible.",
    }),
    CANCELLED: () => ({
      title: 'Contrat annulé',
      description: "Ce contrat n'est plus actif.",
    }),
    FAILED: (c) => ({
      title: c.signatureApplicable === false ? 'Le parcours a échoué' : 'La signature a échoué',
      description: 'Une étape a échoué et bloque la suite. Relancez-la depuis « Voir les détails » ci-dessous.',
    }),
  },
  ADMIN: {
    DRAFT: () => ({
      title: 'Votre contrat est en préparation',
      description: "L'équipe technique finalise votre contrat — vous n'avez rien à faire pour le moment.",
    }),
    DEV_SIGNATURE: () => ({
      title: 'Votre contrat est presque prêt',
      description: "Le contrat est prêt. L'équipe technique signe en premier, puis ce sera à votre tour.",
    }),
    CLIENT_SIGNATURE: () => ({
      title: 'Signez votre contrat',
      description: "Le contrat est prêt et déjà signé par l'équipe technique.",
    }),
    LAUNCH_FEE: () => ({
      title: 'Réglez les frais de mise en service',
      description: 'Paiement unique et sécurisé. Votre site sera mis en ligne juste après les étapes restantes.',
    }),
    SUBSCRIPTION: () => ({
      title: 'Activez votre abonnement',
      description: "C'est lui qui maintient votre site en ligne.",
    }),
    READY_TO_ACTIVATE: () => ({
      title: 'Tout est prêt — mettez votre site en ligne',
      description: 'Dernière étape. Un clic, et votre site devient accessible au public.',
    }),
    ACTIVATING: () => ({
      title: 'Mise en ligne en cours',
      description: 'Votre site est en cours de publication. Cette page se met à jour toute seule.',
    }),
    LIVE: () => ({
      title: 'Votre site est en ligne',
      description: 'Tout est en place. Votre site est accessible au public.',
    }),
    ENDING: () => ({
      title: 'Résiliation enregistrée',
      description: "Votre site reste actif jusqu'à la fin de la période en cours.",
    }),
    ENDED: () => ({
      title: 'Votre contrat est terminé',
      description: "La période est arrivée à son terme et votre site n'est plus accessible au public.",
    }),
    CANCELLED: () => ({
      title: 'Votre contrat a été annulé',
      description: "Ce contrat n'est plus actif. Contactez l'équipe technique pour en établir un nouveau.",
    }),
    FAILED: () => ({
      title: 'Le parcours est interrompu',
      description: "Une étape a échoué et bloque la suite. L'équipe technique a été informée — vous n'avez rien à faire.",
    }),
  },
};
