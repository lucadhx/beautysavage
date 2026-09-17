// services/stripe/dev/stripeDevPaymentService.js
// Sprint F2B — Extraction de la création du PaymentIntent de commission (compte Dev) hors de
// commissionPaymentController. Aucune modification de comportement : mêmes montant, currency,
// automatic_payment_methods, metadata et idempotencyKey. Le client Dev provient du shim
// (mockable). L'orchestration (refresh, verrou anti double-clic, idempotence) reste dans le
// contrôleur ; ce service n'encapsule QUE l'appel Stripe `paymentIntents.create`.

import { getStripeDevClient } from '../../../utils/stripeDevClient.js';

// Noms de mois en français pour le label (identique au contrôleur).
const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

/**
 * Crée le PaymentIntent de commission pour un CommissionPayment donné. Comportement et payload
 * Stripe identiques à l'ancien appel inline (metadata type=commission, idempotencyKey mensuel).
 */
export async function createCommissionPaymentIntent({ payment, amountCents, idempotencyKey }) {
  const stripeDevClient = await getStripeDevClient();
  const monthLabel = `${MONTH_NAMES_FR[payment.month]} ${payment.year}`;
  return stripeDevClient.paymentIntents.create(
    {
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        type: 'commission',
        commissionPaymentId: String(payment._id),
        month: String(payment.month),
        year: String(payment.year),
        label: `Commissions ${monthLabel}`
      }
    },
    { idempotencyKey }
  );
}
