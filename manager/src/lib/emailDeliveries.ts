import type {
  EmailDeliveryStatus,
  EmailDeliveryEngagement,
  EmailDeliveryTimelineEvent,
  NormalizedEventType,
  WebhookProcessingStatus,
} from '@/types';
import { EMAIL_STATE, TONE_BADGE, deliveryState, type EmailState } from '@/lib/emailStates';

/**
 * Logique de l'écran « Livraisons e-mail » (module PUR, sans React).
 *
 * Comme les autres modules de `lib/` : tout ce qui décide vit ici, le composant
 * affiche. Ce module ne DÉDUIT aucun statut — il projette ce que le backend a
 * calculé — et n'emploie JAMAIS de formulation qui prétendrait qu'un humain a lu.
 *
 * ⚠️ Règle de langage : les libellés d'ÉTAT viennent tous de `emailStates`, pour
 * qu'un envoi n'ait pas un nom ici et un autre sur la carte de configuration.
 * « En attente de confirmation » (SENT) n'est pas « Livré » (DELIVERED). Une
 * ouverture/un clic sont « détectés », jamais « lus » ni « volontaires ». Aucun
 * repli n'affiche la constante backend : un code brut n'informe personne, il
 * avoue seulement que le produit n'a pas su traduire ce qu'il a compris.
 */

/* --- Statuts de livraison --------------------------------------------------- */

/**
 * Nuance TECHNIQUE d'un statut, réservée au DEV.
 *
 * Huit statuts fournisseur se rangent dans « Échec de livraison » : le badge ne
 * doit pas les distinguer (le geste est le même), mais le FILTRE, lui, doit
 * rester utilisable — un menu de huit « Échec de livraison » identiques ne
 * permettrait plus de choisir. Ces précisions n'apparaissent QUE là, et restent
 * en français métier : pas de « rebond », pas de « proxy », pas de nom de
 * fournisseur.
 */
const STATUS_PRECISION: Partial<Record<EmailDeliveryStatus, string>> = {
  PENDING: "en attente d'envoi",
  SENDING: 'envoi en cours',
  BLOCKED: 'destinataire bloqué',
  BOUNCED: 'message renvoyé par la messagerie',
  SOFT_BOUNCED: 'refus temporaire de la messagerie',
  HARD_BOUNCED: 'adresse durablement injoignable',
  INVALID: 'adresse invalide',
  SPAM: 'signalé comme indésirable',
  ERROR: "erreur du service d'envoi",
  UNSUBSCRIBED: 'destinataire désinscrit',
};

export interface DeliveryStatusMeta {
  /** Libellé du badge — celui du vocabulaire commun, jamais un mot local. */
  label: string;
  cls: string;
  /** Libellé du filtre DEV : le même, désambiguïsé quand plusieurs statuts le partagent. */
  filterLabel: string;
  /** L'état métier complet, pour qui a besoin de l'aide ou de la tonalité. */
  state: EmailState;
}

const ALL_DELIVERY_STATUSES: EmailDeliveryStatus[] = [
  'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'DEFERRED', 'PRECONDITION_FAILED',
  'FAILED', 'BLOCKED', 'BOUNCED', 'SOFT_BOUNCED', 'HARD_BOUNCED', 'INVALID',
  'SPAM', 'ERROR', 'UNSUBSCRIBED',
];

function buildStatusMeta(status: EmailDeliveryStatus): DeliveryStatusMeta {
  const state = deliveryState(status);
  const precision = STATUS_PRECISION[status];
  return {
    label: state.label,
    cls: TONE_BADGE[state.tone],
    filterLabel: precision ? `${state.label} — ${precision}` : state.label,
    state,
  };
}

/**
 * Table dérivée, jamais saisie à la main : ajouter un statut backend le range
 * automatiquement dans un état existant. Sans cette dérivation, chaque nouveau
 * statut rouvrait la porte à un libellé inventé sur place.
 */
export const DELIVERY_STATUS_META = Object.fromEntries(
  ALL_DELIVERY_STATUSES.map((s) => [s, buildStatusMeta(s)])
) as Record<EmailDeliveryStatus, DeliveryStatusMeta>;

/** Repli d'un statut inconnu (backend plus récent que ce Manager). */
const UNKNOWN_DELIVERY_STATUS: DeliveryStatusMeta = {
  label: EMAIL_STATE.UNKNOWN.label,
  cls: TONE_BADGE[EMAIL_STATE.UNKNOWN.tone],
  filterLabel: EMAIL_STATE.UNKNOWN.label,
  state: EMAIL_STATE.UNKNOWN,
};

export function deliveryStatusMeta(status: EmailDeliveryStatus): DeliveryStatusMeta {
  return DELIVERY_STATUS_META[status] ?? UNKNOWN_DELIVERY_STATUS;
}

/** Le statut prouve-t-il une RÉCEPTION ? `SENT` ne le prouve pas. */
export function isDelivered(status: EmailDeliveryStatus): boolean {
  return status === 'DELIVERED';
}

/* --- Statuts de traitement d'un événement webhook -------------------------- */

/**
 * Ces statuts décrivent le TRAITEMENT d'un accusé de réception, pas l'envoi
 * lui-même : ils gardent donc leurs propres mots. Les couleurs, elles, viennent
 * de l'échelle commune — deux écrans du module doivent rester comparables d'un
 * coup d'œil.
 */
export const PROCESSING_STATUS_META: Record<WebhookProcessingStatus, { label: string; cls: string }> = {
  RECEIVED: { label: 'Reçu', cls: TONE_BADGE.pending },
  PROCESSED: { label: 'Associé à une livraison', cls: TONE_BADGE.ok },
  UNMATCHED: { label: 'Aucune livraison correspondante', cls: TONE_BADGE.warn },
  IGNORED: { label: 'Ignoré', cls: TONE_BADGE.neutral },
  FAILED: { label: 'Échec du traitement', cls: TONE_BADGE.error },
};

/** Repli neutre : mieux vaut « État inconnu » qu'une constante interne affichée. */
const UNKNOWN_PROCESSING_STATUS = {
  label: EMAIL_STATE.UNKNOWN.label,
  cls: TONE_BADGE[EMAIL_STATE.UNKNOWN.tone],
};

export function processingStatusMeta(status: WebhookProcessingStatus) {
  return PROCESSING_STATUS_META[status] ?? UNKNOWN_PROCESSING_STATUS;
}

/* --- Types d'événement normalisés ------------------------------------------ */

/**
 * Un événement raconte une ÉTAPE, là où le statut résume la situation : ces
 * libellés sont donc plus fins que les états, sans pour autant emprunter le
 * vocabulaire du fournisseur. « Rebond », « relais » et « proxy » nomment la
 * plomberie ; on nomme ce qui est arrivé au message.
 */
export const EVENT_TYPE_LABEL: Record<NormalizedEventType, string> = {
  ACCEPTED: 'Envoi accepté',
  SENT: 'Message transmis pour acheminement',
  DELIVERED: 'Livré au destinataire',
  DEFERRED: 'Livraison différée',
  SOFT_BOUNCE: 'Refus temporaire de la messagerie',
  HARD_BOUNCE: 'Adresse durablement injoignable',
  BLOCKED: 'Destinataire bloqué',
  SPAM: 'Signalé comme indésirable',
  INVALID: 'Adresse invalide',
  ERROR: "Erreur du service d'envoi",
  UNSUBSCRIBED: 'Destinataire désinscrit',
  OPENED: 'Ouverture détectée',
  UNIQUE_OPENED: 'Ouverture unique détectée',
  PROXY_OPEN: 'Ouverture détectée via un service intermédiaire',
  UNIQUE_PROXY_OPEN: 'Ouverture unique détectée via un service intermédiaire',
  CLICKED: 'Clic détecté',
};

/** Repli d'un type inconnu — neutre, jamais la constante backend. */
const UNKNOWN_EVENT_LABEL = 'Événement non reconnu';

export function eventTypeLabel(type: NormalizedEventType | null): string {
  if (!type) return '—';
  return EVENT_TYPE_LABEL[type] ?? UNKNOWN_EVENT_LABEL;
}

/**
 * Repli d'un diagnostic vide. Le backend rédige déjà des messages sûrs ; quand
 * il n'en fournit pas, on le dit plutôt que d'exposer le code qui l'accompagne.
 */
export const UNKNOWN_DIAGNOSTIC_MESSAGE =
  "Aucune précision n'a été fournie pour cet événement.";

/** Repli de l'erreur d'une livraison, même principe. */
export const UNKNOWN_DELIVERY_ERROR_MESSAGE =
  "L'envoi n'a pas abouti, sans précision disponible.";

/* --- Engagement (formulations NEUTRES) ------------------------------------- */

/**
 * Résumé d'engagement. Volontairement prudent : « détectée », jamais « lu » — le
 * blocage d'images, le préchargement et les proxys de confidentialité rendent
 * l'ouverture non fiable comme preuve de lecture humaine.
 */
export function engagementSummary(e: EmailDeliveryEngagement | undefined): {
  opens: string | null;
  clicks: string | null;
  hasAny: boolean;
} {
  const openCount = e?.openCount ?? 0;
  const clickCount = e?.clickCount ?? 0;
  const opens = openCount > 0 ? `${openCount} ouverture${openCount > 1 ? 's' : ''} détectée${openCount > 1 ? 's' : ''}` : null;
  const clicks = clickCount > 0 ? `${clickCount} clic${clickCount > 1 ? 's' : ''} détecté${clickCount > 1 ? 's' : ''}` : null;
  return { opens, clicks, hasAny: openCount > 0 || clickCount > 0 };
}

/** Avertissement affiché près de l'engagement — la fiabilité est limitée. */
export const ENGAGEMENT_DISCLAIMER =
  "Ouvertures et clics sont des signaux techniques, pas une preuve de lecture : blocage d'images, préchargement, proxys de confidentialité et inspections de sécurité les faussent.";

/* --- Filtres & requête ----------------------------------------------------- */

export interface DeliveryFilters {
  providerMode?: 'TEST' | 'PROD';
  status?: EmailDeliveryStatus;
  templateId?: string;
  search?: string;
}

export const EMPTY_DELIVERY_FILTERS: DeliveryFilters = {};

export function hasActiveDeliveryFilters(f: DeliveryFilters): boolean {
  return Boolean(f.providerMode || f.status || f.templateId || (f.search && f.search.trim()));
}

/** Construit la query — OMET les valeurs vides (le backend est `.strict()`). */
export function buildDeliveryQuery(f: DeliveryFilters, cursor: string | null, limit: number): string {
  const p = new URLSearchParams();
  if (f.providerMode) p.set('providerMode', f.providerMode);
  if (f.status) p.set('status', f.status);
  if (f.templateId) p.set('templateId', f.templateId.trim());
  if (f.search && f.search.trim()) p.set('search', f.search.trim());
  if (cursor) p.set('cursor', cursor);
  p.set('limit', String(limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/* --- Timeline -------------------------------------------------------------- */

/** Ordonne la timeline du plus ANCIEN au plus récent (occurredAt, sinon receivedAt). */
export function orderTimeline(events: EmailDeliveryTimelineEvent[]): EmailDeliveryTimelineEvent[] {
  const t = (e: EmailDeliveryTimelineEvent) => new Date(e.occurredAt || e.receivedAt || 0).getTime();
  return [...events].sort((a, b) => t(a) - t(b));
}

/** Un événement de timeline est-il de l'engagement (vs une transition de statut) ? */
export function isEngagementEventType(type: NormalizedEventType): boolean {
  return (
    type === 'OPENED' || type === 'UNIQUE_OPENED' || type === 'PROXY_OPEN' ||
    type === 'UNIQUE_PROXY_OPEN' || type === 'CLICKED'
  );
}

/** Identifiant de message raccourci — jamais affiché en entier. */
export function shortMessageId(messageId: string | null): string {
  if (!messageId) return '—';
  const clean = messageId.replace(/^<|>$/g, '');
  return clean.length <= 20 ? clean : `${clean.slice(0, 12)}…${clean.slice(-6)}`;
}

/** Le mode se lit, il ne se déchiffre pas : « Production », pas « PROD ». */
export function modeLabel(mode: 'TEST' | 'PROD'): string {
  return mode === 'PROD' ? 'Production' : 'Test';
}
