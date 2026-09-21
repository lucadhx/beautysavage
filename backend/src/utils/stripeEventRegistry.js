/**
 * Registre code-first des événements webhook STRIPE — source de vérité UNIQUE.
 *
 * Ces valeurs alimentent :
 *  - `enabled_events` de l'endpoint distant (création/synchronisation auto,
 *    TEST comme PROD — plus aucun canal Stripe CLI) ;
 *  - `expectedEvents` du registre des webhooks gérés.
 *
 * La liste reflète les événements RÉELLEMENT traités par
 * `contractWebhook.service.js` — ni plus (bruit), ni moins (événements perdus).
 */
export const STRIPE_HANDLED_EVENTS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/**
 * R10.5C — LES ÉVÉNEMENTS YOUSIGN ONT SUIVI LE WEBHOOK.
 *
 * Ce projet ne souscrit plus rien chez Yousign : c'est le Panel qui reçoit,
 * vérifie et normalise. La liste vivait ici pour être SOUSCRITE à distance ;
 * la garder aurait laissé croire qu'il reste quelque chose à provisionner.
 */
