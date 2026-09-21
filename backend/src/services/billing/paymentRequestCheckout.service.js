import { PaymentRequest } from '../../models/PaymentRequest.model.js';
import { invokeCapability } from '../panelBridge/capabilityClient.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * PAYER UNE PRESTATION — en demandant un VERBE, jamais en tenant une clé (L10.5).
 *
 * ══ CE QUE CE MODULE N'ENVOIE PAS, ET C'EST TOUT LE POINT ═══════════════════
 *
 * AUCUN MONTANT. Ni HT, ni TVA, ni TTC. Il transmet l'identité de la prestation
 * et rien d'autre ; le Panel relit la sienne et décide seul de ce que Stripe
 * débitera.
 *
 * C'est la seule construction qui rende l'attaque impossible plutôt
 * qu'improbable : un client qui remplacerait 600 par 6 dans la requête ne
 * modifierait rien, parce qu'il n'y a aucun montant dans la requête. On ne
 * VALIDE pas un montant reçu — on n'en reçoit pas.
 *
 * La projection locale sert à AFFICHER et à refuser tôt ; elle ne fait jamais
 * autorité sur ce qui sera débité. Si elle divergeait du Panel — livraison en
 * retard, écriture manquée — c'est le Panel qui aurait raison, et c'est lui qui
 * tranche à l'ouverture de la session.
 *
 * ══ AUCUN REPLI LOCAL ═══════════════════════════════════════════════════════
 *
 * Pas de `try capability / catch stripe`. Panel injoignable ⇒ échec explicite.
 * Un repli sur une clé locale ferait repasser l'argent par le chemin qu'on
 * croyait fermé, le jour précis où personne ne regarde.
 */

export const SERVICE_CHECKOUT_CAPABILITY = 'billing.checkout.create';

/**
 * OUVRE — ou RETROUVE — la session de paiement d'une prestation.
 *
 * ══ L'IDENTITÉ DE L'ACTE, ET POURQUOI ELLE EST STABLE ═══════════════════════
 *
 * Elle dérive de la prestation, et d'elle seule. Huit clics sur « Payer »
 * portent donc la MÊME identité : le Panel retrouve la session déjà ouverte et
 * la rend, au lieu d'en créer huit. Ce n'est pas une protection ajoutée à
 * l'appel, c'est la façon dont l'appel est nommé.
 *
 * `creation: 'REUSED'` n'est PAS un échec : c'est la preuve que l'acte avait
 * déjà eu lieu. L'appelant le traite comme un succès.
 */
export async function openServiceCheckout({ paymentRequestId, origin }) {
  const prestation = await PaymentRequest.findOne({ paymentRequestId }).lean();

  /**
   * REFUS TÔT — mais jamais comme une AUTORISATION.
   *
   * Ce contrôle épargne un aller-retour au Panel et rend un message lisible au
   * client. Il ne remplace rien : le Panel revérifie l'état, l'appartenance et
   * le monde avant d'ouvrir quoi que ce soit. Une projection en retard ferait
   * au pire perdre un appel, jamais gagner un paiement.
   */
  if (!prestation) {
    const err = new Error('Prestation introuvable.');
    err.code = 'PAYMENT_REQUEST_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }
  if (!prestation.payable) {
    const err = new Error(
      prestation.status === 'PAID'
        ? 'Cette prestation est déjà réglée.'
        : 'Cette prestation n’est plus à régler.',
    );
    err.code = 'PAYMENT_REQUEST_NOT_PAYABLE';
    err.statusCode = 409;
    throw err;
  }

  /**
   * OÙ RENVOYER LE CLIENT APRÈS STRIPE.
   *
   * L'origine de SA requête d'abord : c'est l'adresse depuis laquelle il
   * navigue, donc celle où il doit revenir — un client sur le domaine
   * personnalisé du garage ne doit pas atterrir sur une URL interne.
   *
   * Elle est CONFRONTÉE aux origines autorisées, jamais reprise telle quelle :
   * un en-tête `Origin` se falsifie, et le recopier ferait de cette route un
   * relais de redirection vers n'importe quel site.
   */
  const autorisees = Array.isArray(config.corsOrigins) ? config.corsOrigins : [];
  const propose = String(origin ?? '').replace(/\/+$/, '');
  const base = autorisees.includes(propose)
    ? propose
    : String(autorisees[0] ?? config.publicUrl ?? '').replace(/\/+$/, '');

  const envelope = await invokeCapability(SERVICE_CHECKOUT_CAPABILITY, {
    paymentType: 'SERVICE',
    /** L'IDENTITÉ, et rien d'autre. Aucun montant ne franchit ce pont. */
    paymentRequestId: prestation.paymentRequestId,
    successUrl: `${base}/factures?paiement=confirme`,
    cancelUrl: `${base}/factures?paiement=annule`,
    /**
     * DÉRIVÉE DE LA PRESTATION — stable par construction, donc idempotente
     * sans que personne n'ait à y penser. Le préfixe évite qu'elle collisionne
     * avec l'identité d'un acte d'un autre verbe portant le même suffixe.
     */
    operationId: `service-checkout-${prestation.paymentRequestId}`,
  });

  const result = envelope?.result ?? null;
  if (!result?.url) {
    /**
     * Une session sans URL n'est pas payable. Le dire franchement vaut mieux
     * que de rendre une page blanche au client : le Panel a peut-être ouvert
     * la session, et un rejeu de la même identité la retrouvera.
     */
    const err = new Error('Le Panel n’a pas rendu de page de paiement exploitable.');
    err.code = 'CHECKOUT_RESULT_INVALID';
    err.statusCode = 502;
    throw err;
  }

  logger.info(
    `[billing] paiement de prestation ${prestation.paymentRequestId} — `
    + `session ${result.creation === 'REUSED' ? 'retrouvée' : 'ouverte'}.`,
  );

  return { url: result.url, creation: result.creation ?? 'CREATED' };
}

/**
 * LES PRESTATIONS DU CLIENT — lecture de la projection locale.
 *
 * Aucun appel au Panel : la page de facturation doit s'afficher même quand le
 * Panel est indisponible. Ce que le client voit peut être en retard de quelques
 * secondes ; il ne doit jamais être ABSENT.
 */
export async function listPaymentRequests() {
  const items = await PaymentRequest.find({}).sort({ issuedAt: -1, createdAt: -1 }).limit(200).lean();
  return items.map((p) => ({
    paymentRequestId: p.paymentRequestId,
    label: p.label,
    description: p.description ?? '',
    netAmountCents: p.netAmountCents,
    taxRate: p.taxRate,
    taxAmountCents: p.taxAmountCents,
    grossAmountCents: p.grossAmountCents,
    currency: p.currency ?? 'EUR',
    status: p.status,
    payable: Boolean(p.payable),
    /**
     * LES LIENS NE SONT RENDUS QUE S'ILS EXISTENT — un bouton « Voir la
     * facture » qui ne mène nulle part est pire que pas de bouton du tout.
     */
    invoiceUrl: p.invoiceUrl || null,
    invoicePdfUrl: p.invoicePdfUrl || null,
    issuedAt: p.issuedAt,
    paidAt: p.paidAt,
  }));
}

export default { openServiceCheckout, listPaymentRequests, SERVICE_CHECKOUT_CAPABILITY };
