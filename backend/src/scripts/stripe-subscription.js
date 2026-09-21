/* Test SANDBOX Stripe RÉEL de l'ABONNEMENT (mode TEST actif).
 * Usage : npm run stripe:test:subscription -- <contractId>
 *
 * Crée un vrai Customer + Product + Price + Checkout Session d'abonnement en mode
 * TEST pour un contrat EXPLICITEMENT de test, entièrement signé, frais réglés (ou
 * non requis) et abonnement configuré. Affiche l'URL Checkout (carte de test
 * Stripe). L'abonnement n'est « actif » que confirmé par webhook.
 *
 * GARDE-FOUS : refuse hors mode TEST ; exige un contractId explicite ; contrat
 * environment=TEST ; ne crée aucun paiement réel ; n'affiche aucun secret. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { getActiveMode, getProviderBaseUrl, isProviderConfigured, isProviderVerified } from '../services/integratedApi.service.js';
import { Contract } from '../models/Contract.model.js';
import { createOrReuseSubscriptionCheckout, subscriptionPayableIssues } from '../services/subscription.service.js';
import { formatCents } from '../utils/money.js';
import { logger } from '../utils/logger.js';

const contractId = process.argv[2];

await connectDatabase();
try {
  const mode = await getActiveMode('STRIPE');
  if (mode !== 'TEST') {
    logger.error(`Refus : le mode Stripe actif est ${mode}. Ce test n'opère QU'EN SANDBOX (TEST).`);
    process.exitCode = 2;
  } else if (!(await isProviderConfigured('STRIPE', { mode: 'TEST' })) || !(await isProviderVerified('STRIPE', { mode: 'TEST' }))) {
    logger.error('Stripe TEST non configuré/vérifié. Configurez et testez la connexion TEST dans le Manager.');
    process.exitCode = 2;
  } else if (!contractId) {
    logger.error("Usage : npm run stripe:test:subscription -- <contractId d'un contrat de TEST éligible>.");
    process.exitCode = 2;
  } else {
    const contract = await Contract.findById(contractId);
    if (!contract) {
      logger.error(`Contrat ${contractId} introuvable.`);
      process.exitCode = 2;
    } else if (contract.environment !== 'TEST') {
      logger.error(`Refus : le contrat ${contract.reference} n'est pas un contrat de TEST (environment=${contract.environment}).`);
      process.exitCode = 2;
    } else {
      const issues = subscriptionPayableIssues(contract);
      if (issues.length) {
        logger.error(`Abonnement non souscriptible pour ${contract.reference} : ${issues.join(', ')}.`);
        process.exitCode = 2;
      } else {
        const base = await getProviderBaseUrl('STRIPE', { mode: 'TEST' });
        logger.info(`Sandbox Stripe — mode TEST — base ${base}`);
        logger.info(`Contrat ${contract.reference} — abonnement TTC ${formatCents(contract.pricing.subscription.amountIncludingTax)} / mois`);
        const managerUrl = 'https://manager.example.test';
        const { url, reused } = await createOrReuseSubscriptionCheckout(
          contract,
          {
            successUrl: `${managerUrl}/contrat/retour-abonnement?status=success&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${managerUrl}/contrat/retour-abonnement?status=cancel`,
          },
          { role: 'DEV' }
        );
        logger.success(`Checkout d'abonnement ${reused ? 'réutilisée' : 'créée'} (TEST).`);
        logger.success('Ouvrez cette URL et payez avec une carte de test Stripe :');
        console.log(`\n  ${url}\n`);
        logger.info("L'abonnement ne sera « actif » qu'après le webhook signé (backend exposé via ngrok, webhook TEST auto-synchronisé) ou `npm run subscriptions:sync`.");
        process.exitCode = 0;
      }
    }
  }
} catch (err) {
  logger.error(`Échec sandbox Stripe abonnement : ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
