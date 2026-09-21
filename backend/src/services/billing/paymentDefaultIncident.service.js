import { PaymentDefaultIncident } from '../../models/PaymentDefaultIncident.model.js';

/**
 * LES INCIDENTS DE PAIEMENT DU CLIENT — lecture de la projection locale
 * (L10.6B-3).
 *
 * ══ UNE LECTURE, ET RIEN QU'UNE LECTURE ═════════════════════════════════════
 *
 * Aucun appel au Panel, aucun appel à Stripe, aucun e-mail, aucune écriture
 * métier. Ouvrir « Facturation & abonnement » ou l'actualiser ne doit RIEN
 * déclencher.
 *
 * Ce n'est pas une précaution de style. Une lecture qui relancerait un
 * prélèvement ferait dépendre la collecte de qui regarde l'écran et à quelle
 * fréquence — et un client anxieux qui rafraîchit dix fois déclencherait dix
 * tentatives. Stripe est l'unique ordonnanceur ; cette fonction ne fait que
 * raconter ce qu'il a déjà fait.
 *
 * ══ CE QU'ELLE NE CALCULE PAS ═══════════════════════════════════════════════
 *
 * Ni l'échéance de grâce, ni l'accessibilité du site, ni l'état de la cause.
 * Les trois viennent des autorités qui les ont décidées : le Panel pour les
 * deux premières, `SiteStatus` pour la troisième. Reconstruire l'échéance
 * depuis `firstFailedAt + graceDaysSnapshot` marcherait aujourd'hui et
 * mentirait le jour où le Panel bornerait un cycle autrement.
 */

/** Les états où l'argent n'est toujours pas rentré. */
const VIVANTS = ['OPEN', 'GRACE_EXPIRED'];

/**
 * @returns {Promise<{items: object[], active: object|null}>}
 */
export async function listPaymentDefaultIncidents() {
  const documents = await PaymentDefaultIncident.find({})
    .sort({ firstFailedAt: -1, createdAt: -1 })
    .limit(100)
    .lean();

  const items = documents.map(projeter);

  /**
   * L'INCIDENT ACTIF — le plus récent des VIVANTS, désigné par SON identité.
   *
   * Jamais par `contractId` : un même contrat peut porter plusieurs incidents
   * successifs, et les fusionner en effacerait un de l'historique du client.
   */
  const active = items.find((i) => VIVANTS.includes(i.status)) ?? null;

  return { items, active };
}

function projeter(p) {
  return {
    paymentDefaultId: p.paymentDefaultId,
    contractId: p.contractId ?? null,
    /** Référence technique — le volet « Détails », pas la lecture courante. */
    invoiceId: p.invoiceId ?? null,

    status: p.status,

    /**
     * OBSERVATIONS STRIPE. L'écran doit écrire « prévue par Stripe », jamais
     * « nous retenterons » : nous ne retentons rien. Et une date absente ne
     * signifie pas « aucune tentative » — elle signifie que Stripe ne l'a pas
     * communiquée. `nextAttemptKnown` porte cette nuance jusqu'à l'écran, pour
     * qu'il n'ait pas à la redécouvrir avec un `!== null`.
     */
    attemptCount: p.attemptCount ?? 0,
    nextPaymentAttemptAt: p.nextPaymentAttemptAt ?? null,
    nextAttemptKnown: Boolean(p.nextPaymentAttemptAt),
    firstFailedAt: p.firstFailedAt ?? null,
    lastFailedAt: p.lastFailedAt ?? null,

    /**
     * `null` ET `0` SORTENT DIFFÉRENTS D'ICI, et le resteront jusqu'à l'écran.
     *
     *   null → aucune politique de grâce. Le site ne fermera pas tout seul.
     *   0    → aucune clémence. L'échéance tombe dès l'échec.
     *
     * `graceConfigured` existe pour que React n'ait pas à écrire un test de
     * vérité sur un nombre — `if (graceDaysSnapshot)` fusionnerait les deux, et
     * annoncerait « aucun délai de grâce » à un client qui en a zéro, ou
     * l'inverse. Le booléen ferme la porte à ce bogue.
     */
    graceDaysSnapshot: Number.isInteger(p.graceDaysSnapshot) ? p.graceDaysSnapshot : null,
    graceConfigured: Number.isInteger(p.graceDaysSnapshot),
    graceDeadlineAt: p.graceDeadlineAt ?? null,

    amountDueCents: p.amountDueCents ?? 0,
    currency: p.currency ?? 'EUR',
    invoiceNumber: p.invoiceNumber ?? null,
    /** Rendus seulement s'ils existent : un lien mort est pire que rien. */
    hostedInvoiceUrl: p.hostedInvoiceUrl || null,
    invoicePdfUrl: p.invoicePdfUrl || null,

    /**
     * TROIS DATES, TROIS AFFIRMATIONS. L'écran doit pouvoir dire « suspension
     * en cours d'application » tant que la confirmation manque, et ne jamais
     * présenter une demande comme un fait accompli.
     */
    suspensionRequestedAt: p.suspensionRequestedAt ?? null,
    suspensionConfirmedAt: p.suspensionConfirmedAt ?? null,
    causeRemovalConfirmedAt: p.causeRemovalConfirmedAt ?? null,

    resolvedAt: p.resolvedAt ?? null,
    resolution: p.resolution ?? null,

    /**
     * OBSERVATION, JAMAIS PREUVE D'ACCESSIBILITÉ. Le site peut être fermé avec
     * `causeActive: false` — une maintenance technique suffit. C'est
     * `SiteStatus` qui répond à « mon site répond-il ? », et lui seul.
     */
    causeActive: p.causeActive === true,
    reason: p.reason || 'Défaut de paiement',
  };
}

export default { listPaymentDefaultIncidents };
