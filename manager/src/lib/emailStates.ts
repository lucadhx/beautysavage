import type { EmailDeliveryStatus, EmailStatus, EmailTestStatus } from '@/types';

/**
 * VOCABULAIRE MÉTIER UNIQUE des états e-mail.
 *
 * ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 *
 * Le backend manipule trois familles de statuts techniques — configuration
 * (`EmailStatus`), test (`EmailTestStatus`), livraison (`EmailDeliveryStatus`) —
 * qui se recoupent sans se confondre. Chacune était traduite dans son coin, si
 * bien qu'un même fait pouvait s'appeler « Accepté » ici, « Accepté par Brevo »
 * là, et « SENT » ailleurs. Un utilisateur qui voit trois mots pour une seule
 * réalité conclut qu'il y a trois réalités.
 *
 * Ce fichier définit donc UN vocabulaire, et trois traductions vers lui. Ajouter
 * un statut technique n'ajoute pas un mot au produit : il se range dans un état
 * existant, ou l'on décide explicitement d'en ouvrir un nouveau.
 *
 * ─── CE QUI NE DOIT JAMAIS SORTIR D'ICI ──────────────────────────────────────
 *
 * Aucun libellé ne contient de terme fournisseur (« Brevo », « webhook »), de
 * jargon de messagerie (« bounce », « SMTP », « relais »), ni de code technique.
 * Les replis ne montrent jamais la valeur brute : un état inconnu vaut mieux
 * qu'un `HARD_BOUNCED` affiché tel quel — le second n'informe pas, il avoue que
 * le produit n'a pas su traduire ce qu'il a compris.
 */

/** Tonalité d'un état. Détermine couleur ET icône, jamais l'une sans l'autre. */
export type EmailTone = 'ok' | 'pending' | 'warn' | 'error' | 'neutral';

/** Icône métier, résolue par le composant (ce module reste sans dépendance React). */
export type EmailIcon = 'success' | 'error' | 'waiting' | 'warning' | 'settings' | 'neutral';

export interface EmailState {
  /** Libellé court — celui du badge. */
  label: string;
  /** Une phrase qui explique l'état sans le paraphraser. */
  help: string;
  tone: EmailTone;
  icon: EmailIcon;
}

/**
 * Les états du produit. C'est la liste COMPLÈTE de ce qu'un utilisateur peut
 * lire — sept mots, pas quinze.
 */
export const EMAIL_STATE = {
  NOT_CONFIGURED: {
    label: 'Configuration requise',
    help: "Renseignez le nom d'expéditeur et l'adresse email, puis enregistrez.",
    tone: 'neutral',
    icon: 'settings',
  },
  UNTESTED: {
    label: 'À tester',
    help: "La configuration est enregistrée. Envoyez un email de test pour la vérifier.",
    tone: 'pending',
    icon: 'waiting',
  },
  PREPARING: {
    label: 'Préparation…',
    help: "L'email est en cours de préparation.",
    tone: 'pending',
    icon: 'waiting',
  },
  // « Accepté » disait ce que le FOURNISSEUR avait fait ; ceci dit où en est
  // l'utilisateur. C'est la même réalité, énoncée du bon côté.
  AWAITING_CONFIRMATION: {
    label: 'En attente de confirmation',
    help: "L'email est parti. La confirmation de réception n'est pas encore arrivée.",
    tone: 'pending',
    icon: 'waiting',
  },
  DELIVERED: {
    label: 'Livré',
    help: "L'email a bien été remis à son destinataire.",
    tone: 'ok',
    icon: 'success',
  },
  /**
   * Remis, PUIS signalé par le destinataire (désinscription, marquage
   * indésirable). L'email est bien arrivé — le classer « Échec de livraison »
   * était faux, et masquait un signal qui appelle une action toute différente.
   */
  DELIVERED_FLAGGED: {
    label: 'Livré, puis signalé',
    help: "L'email a été remis, mais le destinataire l'a signalé ou s'est désinscrit.",
    tone: 'warn',
    icon: 'warning',
  },
  DEFERRED: {
    label: 'Livraison différée',
    help:
      'Le serveur du destinataire a temporairement retardé la réception. ' +
      'Une nouvelle tentative peut être effectuée automatiquement.',
    tone: 'warn',
    icon: 'warning',
  },
  FAILED: {
    label: 'Échec de livraison',
    help: "L'email n'a pas pu être remis.",
    tone: 'error',
    icon: 'error',
  },
  /** Refus interne AVANT tout envoi : rien n'est perdu, la reprise est automatique. */
  SUSPENDED: {
    label: 'Envoi suspendu',
    help: "L'envoi reprendra automatiquement une fois le suivi rétabli.",
    tone: 'warn',
    icon: 'warning',
  },
  TRACKING_UNAVAILABLE: {
    label: 'Suivi indisponible',
    help: "Impossible de confirmer si les emails arrivent à destination.",
    tone: 'warn',
    icon: 'warning',
  },
  UNKNOWN: {
    label: 'État inconnu',
    help: "Cet état n'a pas pu être déterminé.",
    tone: 'neutral',
    icon: 'neutral',
  },
} as const satisfies Record<string, EmailState>;

export type EmailStateKey = keyof typeof EMAIL_STATE;

/**
 * Classes du BADGE par tonalité.
 *
 * Une seule échelle pour tout le module — c'est ce qui rend deux écrans
 * comparables d'un coup d'œil. Le vert est réservé à un fait CONSTATÉ (livré) ;
 * un envoi accepté mais non confirmé reste bleu, jamais vert : la couleur ne
 * doit pas promettre ce que le produit ne sait pas encore.
 */
export const TONE_BADGE: Record<EmailTone, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-sky-100 text-sky-800',
  warn: 'bg-amber-100 text-amber-900',
  error: 'bg-red-100 text-red-800',
  neutral: 'bg-slate-100 text-slate-700',
};

/** Classes du BANDEAU (fond clair + texte foncé), même échelle que les badges. */
export const TONE_BANNER: Record<EmailTone, string> = {
  ok: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  pending: 'bg-sky-50 text-sky-900 border-sky-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-red-50 text-red-900 border-red-200',
  neutral: 'bg-slate-50 text-slate-800 border-slate-200',
};

/* --- Traductions depuis les statuts techniques ----------------------------- */

/** Statut de CONFIGURATION (carte « Configuration des emails »). */
const FROM_CONFIG: Record<EmailStatus, EmailStateKey> = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NOT_TESTED: 'UNTESTED',
  ACCEPTED: 'AWAITING_CONFIRMATION',
  FUNCTIONAL: 'DELIVERED',
  ERROR: 'FAILED',
};

/** Issue du dernier TEST. */
const FROM_TEST: Record<EmailTestStatus, EmailStateKey> = {
  NOT_TESTED: 'UNTESTED',
  ACCEPTED: 'AWAITING_CONFIRMATION',
  DEFERRED: 'DEFERRED',
  DELIVERED: 'DELIVERED',
  REJECTED: 'FAILED',
  FAILED: 'FAILED',
};

/**
 * Statut d'une LIVRAISON.
 *
 * Les cinq façons d'échouer du fournisseur (rebond dur, rebond souple, adresse
 * invalide, blocage, spam) se rangent toutes dans « Échec de livraison ». La
 * nuance entre elles est un fait d'exploitation, pas une information produit :
 * dans les cinq cas l'email n'est pas arrivé et le geste est le même. Un
 * développeur qui a besoin du détail le lit dans le diagnostic.
 */
const FROM_DELIVERY: Record<EmailDeliveryStatus, EmailStateKey> = {
  PENDING: 'PREPARING',
  SENDING: 'PREPARING',
  SENT: 'AWAITING_CONFIRMATION',
  DELIVERED: 'DELIVERED',
  DEFERRED: 'DEFERRED',
  PRECONDITION_FAILED: 'SUSPENDED',
  FAILED: 'FAILED',
  BLOCKED: 'FAILED',
  BOUNCED: 'FAILED',
  SOFT_BOUNCED: 'FAILED',
  HARD_BOUNCED: 'FAILED',
  INVALID: 'FAILED',
  ERROR: 'FAILED',
  // ⚠️ Ces deux-là sont des signaux POST-livraison : l'email EST arrivé, puis le
  // destinataire l'a signalé. Leur précédence backend le dit (6 et 7, au-dessus
  // de DELIVERED). Les afficher « Échec de livraison » affirmait le contraire du
  // fait constaté — et envoyait chercher un problème d'acheminement là où il n'y
  // en a pas.
  SPAM: 'DELIVERED_FLAGGED',
  UNSUBSCRIBED: 'DELIVERED_FLAGGED',
};

function resolve(key: EmailStateKey | undefined): EmailState {
  return EMAIL_STATE[key ?? 'UNKNOWN'];
}

export function configState(status: EmailStatus | undefined): EmailState {
  return resolve(status ? FROM_CONFIG[status] : undefined);
}

export function testState(status: EmailTestStatus | undefined): EmailState {
  return resolve(status ? FROM_TEST[status] : undefined);
}

export function deliveryState(status: EmailDeliveryStatus | undefined): EmailState {
  return resolve(status ? FROM_DELIVERY[status] : undefined);
}
