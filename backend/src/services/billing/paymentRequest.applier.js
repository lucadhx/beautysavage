import { PaymentRequest } from '../../models/PaymentRequest.model.js';
import { logger } from '../../utils/logger.js';

/**
 * APPLICATEUR — le Panel réclame, le projet enregistre (L10.5).
 *
 * ══ REMPLACEMENT COMPLET, JAMAIS UN DELTA ═══════════════════════════════════
 *
 * Chaque livraison porte l'ÉTAT ENTIER de la prestation, et l'écrase ici. Une
 * écriture qui aurait dit « passe à PAID » aurait supposé que la ligne existe
 * déjà et qu'elle est dans le bon état — deux hypothèses que deux livraisons
 * arrivées dans le désordre suffisent à casser, en silence.
 *
 * Le remplacement est IDEMPOTENT par construction : rejouer la même écriture ne
 * change rien, et une livraison manquée est réparée par la suivante. C'est ce
 * qui rend la convergence possible après une absence du projet.
 *
 * ══ LE PROJET N'ÉCRIT JAMAIS DE SON CÔTÉ ════════════════════════════════════
 *
 * Aucune route de ce projet ne modifie une prestation. Le seul geste offert au
 * client est « Payer », et il ne touche pas cette collection : il demande une
 * session au Panel, qui reste seul à décider du montant et de l'état.
 */
export async function applyPaymentRequestChange({ change }) {
  const payload = change?.payload ?? null;
  const entityId = change?.entityId ?? payload?.paymentRequestId ?? null;

  if (!entityId) {
    throw new Error('Écriture PAYMENT_REQUEST sans identité : rien à appliquer.');
  }

  /**
   * UNE SUPPRESSION NE RETIRE RIEN, ELLE MARQUE.
   *
   * Le Panel n'en émet pas aujourd'hui — une prestation s'annule, elle ne
   * s'efface pas. Le cas est traité quand même : effacer physiquement une
   * facture payée du côté client serait la faire disparaître de son historique,
   * et c'est précisément ce qu'un espace de facturation ne doit jamais faire.
   */
  if (change.deleted) {
    await PaymentRequest.updateOne(
      { paymentRequestId: entityId },
      { $set: { status: 'CANCELED', payable: false, receivedAt: new Date().toISOString() } },
    );
    return;
  }

  if (!payload) throw new Error(`Écriture PAYMENT_REQUEST ${entityId} sans charge utile.`);

  /**
   * LES MONTANTS SONT REPRIS TELS QUELS, SANS AUCUN CALCUL.
   *
   * Pas de `net + tax` recalculé « pour vérifier » : si le Panel et le projet
   * arrondissaient différemment, la vérification échouerait sur des factures
   * parfaitement justes. Le Panel a figé la ventilation ; le projet l'affiche.
   */
  await PaymentRequest.updateOne(
    { paymentRequestId: entityId },
    {
      $set: {
        paymentRequestId: entityId,
        label: payload.label,
        description: payload.description ?? '',
        netAmountCents: entier(payload.netAmountCents),
        taxRate: nombre(payload.taxRate),
        taxAmountCents: entier(payload.taxAmountCents),
        grossAmountCents: entier(payload.grossAmountCents),
        currency: payload.currency ?? 'EUR',
        status: payload.status,
        payable: payload.payable === true,
        invoiceUrl: payload.invoiceUrl ?? null,
        invoicePdfUrl: payload.invoicePdfUrl ?? null,
        issuedAt: payload.issuedAt ? new Date(payload.issuedAt) : null,
        paidAt: payload.paidAt ? new Date(payload.paidAt) : null,
        receivedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  logger.info(`[billing] prestation ${entityId} — ${payload.status} (${payload.grossAmountCents} c).`);
}

/** Un montant absent vaut ZÉRO, jamais `NaN` : un écran n'affiche pas `NaN €`. */
const entier = (v) => (Number.isInteger(v) ? v : 0);
const nombre = (v) => (Number.isFinite(v) ? v : 0);

export default { applyPaymentRequestChange };
