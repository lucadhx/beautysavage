/**
 * Registre code-first des événements webhook transactionnels Brevo.
 *
 * ═══ DEUX ESPACES DE NOMS, UN SEUL SENS ══════════════════════════════════════
 *
 * Brevo emploie DEUX vocabulaires pour le MÊME événement, et les confondre est la
 * première source de bugs de ce module :
 *
 *  - CONFIG-TIME (camelCase) : ce qu'on ENVOIE à `POST /v3/webhooks` dans `events`.
 *      → `hardBounce`, `softBounce`, `invalid`, `uniqueOpened`, `unsubscribed`…
 *  - PAYLOAD-TIME (snake_case) : ce qu'on REÇOIT dans le champ `event` du corps.
 *      → `hard_bounce`, `soft_bounce`, `invalid_email`, `unique_opened`, `error`…
 *
 * Sources (docs locales, miroir de la doc officielle) :
 *   docs/Brevo/api/webhooks.md, docs/Brevo/guides/05_WEBHOOKS.md,
 *   docs/Brevo/guides/06_EMAIL_EVENTS.md.
 *
 * Ce registre normalise LES DEUX vers un type canonique unique. Toute la logique
 * métier (machine d'état, affichage) ne connaît que le type canonique.
 */

/** Types normalisés — la SEULE forme que le reste du code manipule. */
export const NORMALIZED_EVENT = Object.freeze({
  /** `request` : Brevo a accepté la demande d'envoi (= notre SENT). */
  ACCEPTED: 'ACCEPTED',
  /** `sent` (SMS/config-time) : remis au serveur relais. Traité comme ACCEPTED. */
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  DEFERRED: 'DEFERRED',
  SOFT_BOUNCE: 'SOFT_BOUNCE',
  HARD_BOUNCE: 'HARD_BOUNCE',
  BLOCKED: 'BLOCKED',
  SPAM: 'SPAM',
  INVALID: 'INVALID',
  ERROR: 'ERROR',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
  OPENED: 'OPENED',
  UNIQUE_OPENED: 'UNIQUE_OPENED',
  /** `proxy_open` : ouverture via un proxy de confidentialité (Apple MPP…). */
  PROXY_OPEN: 'PROXY_OPEN',
  UNIQUE_PROXY_OPEN: 'UNIQUE_PROXY_OPEN',
  CLICKED: 'CLICKED',
});
export const NORMALIZED_EVENT_VALUES = Object.values(NORMALIZED_EVENT);

/**
 * Événements d'ENGAGEMENT : ils sont historisés mais ne changent JAMAIS le statut
 * de livraison (§13 du CDC). Une ouverture n'est pas une preuve de lecture, un clic
 * n'est pas une preuve d'intention — cf. la fiabilité limitée du tracking.
 */
export const ENGAGEMENT_EVENTS = Object.freeze([
  NORMALIZED_EVENT.OPENED,
  NORMALIZED_EVENT.UNIQUE_OPENED,
  NORMALIZED_EVENT.PROXY_OPEN,
  NORMALIZED_EVENT.UNIQUE_PROXY_OPEN,
  NORMALIZED_EVENT.CLICKED,
]);

/** Sous-ensemble d'engagement qui compte comme une OUVERTURE (vs un CLIC). */
export const OPEN_EVENTS = Object.freeze([
  NORMALIZED_EVENT.OPENED,
  NORMALIZED_EVENT.UNIQUE_OPENED,
  NORMALIZED_EVENT.PROXY_OPEN,
  NORMALIZED_EVENT.UNIQUE_PROXY_OPEN,
]);

/**
 * Événements config-time à SOUSCRIRE lors de la création du webhook (`events`).
 * camelCase — c'est le vocabulaire que l'API `POST /v3/webhooks` attend.
 * `batched` reste false (hors périmètre) : traitement unitaire = idempotence simple.
 */
/**
 * Événements config-time souscrits à la création du webhook.
 *
 * ─── POURQUOI PAS DE `sent` (preuve forensique, 2026-07-19) ──────────────────
 *
 * Un diagnostic RÉEL contre l'API Brevo a montré que Brevo **ne conserve pas**
 * `sent` : quand on le souscrit, `GET /v3/webhooks` renvoie `request` À SA PLACE
 * (on observe même `["request","request", …]` et **aucun** `sent`). Notre
 * comparaison voyait donc l'événement attendu `SENT` éternellement « manquant »
 * → statut « Désynchronisé » permanent → boucle « Actif → Désynchronisé ».
 *
 * `sent` est de toute façon REDONDANT pour notre suivi : `request` couvre déjà
 * l'état « accepté », et l'acceptation est connue localement dès le 201 de
 * `/smtp/email`. On ne souscrit donc que ce qui round-trip proprement.
 *
 * NB : `error`, absent de la doc config-time, est en revanche **accepté et
 * conservé** par Brevo (constaté dans `GET /v3/webhooks`) — on le garde, il nous
 * livre les événements d'erreur asynchrones.
 */
export const SUBSCRIBED_CONFIG_EVENTS = Object.freeze([
  'request',
  'delivered',
  'deferred',
  'softBounce',
  'hardBounce',
  'blocked',
  'spam',
  'invalid',
  'error',
  'unsubscribed',
  'opened',
  'uniqueOpened',
  'click',
]);

/**
 * Événements config-time qui ROUND-TRIP proprement chez Brevo (constaté
 * empiriquement, pas seulement en doc). Référence en lecture seule pour le
 * diagnostic : un événement souscrit absent d'ici sera renvoyé sous une autre
 * forme (ou pas du tout) et provoquera une divergence permanente.
 *
 * Écarts avec la doc, confirmés par un appel réel :
 *  - `sent` EXCLU : Brevo le renvoie en `request` (collapse) → jamais tel quel ;
 *  - `error` INCLUS : accepté et conservé, bien qu'absent de la liste documentée.
 */
export const BREVO_VALID_CONFIG_EVENTS = Object.freeze([
  'request',
  'delivered',
  'hardBounce',
  'softBounce',
  'blocked',
  'spam',
  'invalid',
  'deferred',
  'click',
  'opened',
  'uniqueOpened',
  'unsubscribed',
  'error',
]);

/**
 * Table de correspondance brut → canonique. La CLÉ est normalisée (minuscule, sans
 * séparateur `-`/`_`) pour absorber d'un coup les deux espaces de noms ET les
 * variations de casse observées, sans accepter n'importe quoi : seule une clé
 * explicitement listée est reconnue.
 */
const RAW_TO_NORMALIZED = Object.freeze({
  request: NORMALIZED_EVENT.ACCEPTED,
  sent: NORMALIZED_EVENT.SENT,
  delivered: NORMALIZED_EVENT.DELIVERED,
  deferred: NORMALIZED_EVENT.DEFERRED,
  softbounce: NORMALIZED_EVENT.SOFT_BOUNCE, // soft_bounce | softBounce
  hardbounce: NORMALIZED_EVENT.HARD_BOUNCE, // hard_bounce | hardBounce
  blocked: NORMALIZED_EVENT.BLOCKED,
  spam: NORMALIZED_EVENT.SPAM,
  invalid: NORMALIZED_EVENT.INVALID, // config-time
  invalidemail: NORMALIZED_EVENT.INVALID, // payload-time (invalid_email)
  error: NORMALIZED_EVENT.ERROR,
  unsubscribed: NORMALIZED_EVENT.UNSUBSCRIBED,
  opened: NORMALIZED_EVENT.OPENED,
  uniqueopened: NORMALIZED_EVENT.UNIQUE_OPENED, // unique_opened | uniqueOpened
  proxyopen: NORMALIZED_EVENT.PROXY_OPEN, // proxy_open
  uniqueproxyopen: NORMALIZED_EVENT.UNIQUE_PROXY_OPEN,
  click: NORMALIZED_EVENT.CLICKED,
  clicks: NORMALIZED_EVENT.CLICKED, // stats/pull vocabulary
});

/** Réduit une valeur brute à sa clé de comparaison : minuscule, sans `-`/`_`/espaces. */
function comparisonKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

/**
 * Normalise une valeur d'événement Brevo (config-time OU payload-time).
 * @returns {{ known: boolean, normalized: string|null, raw: string }}
 */
export function normalizeBrevoEvent(raw) {
  const rawStr = String(raw ?? '');
  const normalized = RAW_TO_NORMALIZED[comparisonKey(rawStr)] ?? null;
  return { known: normalized !== null, normalized, raw: rawStr };
}

/** Un événement d'engagement ne touche jamais le statut de livraison. */
export function isEngagementEvent(normalized) {
  return ENGAGEMENT_EVENTS.includes(normalized);
}

export function isOpenEvent(normalized) {
  return OPEN_EVENTS.includes(normalized);
}

export function isClickEvent(normalized) {
  return normalized === NORMALIZED_EVENT.CLICKED;
}
