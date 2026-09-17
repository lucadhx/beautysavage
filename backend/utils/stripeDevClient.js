// utils/stripeDevClient.js
// Sprint F2B — SHIM. L'implémentation du client Stripe Dev a été déplacée vers
// services/stripe/dev/stripeDevConfigService.js (domaine plateforme / platform_billing).
// Ce module reste l'accesseur historique (importé par les contrôleurs/services et mockable
// par les tests) : il re-exporte simplement `getStripeDevClient`. Aucun comportement modifié.

export { getStripeDevClient, default } from '../services/stripe/dev/stripeDevConfigService.js';
