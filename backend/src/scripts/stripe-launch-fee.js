/* Test SANDBOX Stripe RÉEL des FRAIS DE LANCEMENT (mode TEST actif).
 * Usage : npm run stripe:test:launch-fee -- [contractId]
 *
 * Crée une VRAIE Checkout Session Stripe en mode TEST pour un contrat EXPLICITEMENT
 * de test, entièrement signé et avec des frais de lancement configurés. Affiche
 * l'URL Checkout à ouvrir manuellement (carte de test Stripe). Le paiement n'est
 * confirmé que par le webhook (backend exposé via ngrok — endpoint TEST auto-synchronisé).
 *
 * GARDE-FOUS :
 *  - REFUSE si le mode Stripe actif n'est pas TEST (ne touche JAMAIS la production) ;
 *  - EXIGE un contractId explicite (aucune sélection automatique d'un contrat réel) ;
 *  - ne crée aucun paiement réel (juste une session Checkout TEST) ;
 *  - n'affiche AUCUN secret (clé, whsec, token).
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { getActiveMode, getProviderBaseUrl, isProviderConfigured, isProviderVerified } from '../services/integratedApi.service.js';
import { Contract } from '../models/Contract.model.js';
import { createOrReuseLaunchCheckout, launchFeePayableIssues } from '../services/payment.service.js';
import { formatCents } from '../utils/money.js';
import { logger } from '../utils/logger.js';

const contractId = process.argv[2];

await connectDatabase();
try {
  const mode = await getActiveMode('STRIPE');
  if (mode !== 'TEST') {
    logger.error(`Refus : le mode Stripe actif est ${mode}. Ce test n'opère QU'EN SANDBOX (TEST). Basculez Stripe en mode TEST.`);
    process.exitCode = 2;
  } else if (!(await isProviderConfigured('STRIPE', { mode: 'TEST' })) || !(await isProviderVerified('STRIPE', { mode: 'TEST' }))) {
    logger.error('Stripe TEST non configuré/vérifié. Configurez et testez la connexion TEST dans le Manager.');
    process.exitCode = 2;
  } else if (!contractId) {
    logger.error('Usage : npm run stripe:test:launch-fee -- <contractId d\'un contrat de TEST entièrement signé>.');
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
      const issues = launchFeePayableIssues(contract);
      if (issues.length) {
        logger.error(`Frais non payables pour ${contract.reference} : ${issues.join(', ')}.`);
        logger.info('Le contrat doit être entièrement signé, avec des frais de lancement > 0 et non déjà payés.');
        process.exitCode = 2;
      } else {
        const base = await getProviderBaseUrl('STRIPE', { mode: 'TEST' });
        logger.info(`Sandbox Stripe — mode TEST — base ${base}`);
        logger.info(`Contrat ${contract.reference} — frais TTC ${formatCents(contract.pricing.launchFee.amountIncludingTax)}`);

        const managerUrl = 'https://manager.example.test'; // retour non utilisé pour ce test manuel
        const { url, reused } = await createOrReuseLaunchCheckout(
          contract,
          {
            successUrl: `${managerUrl}/contrat/retour-paiement?status=success&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${managerUrl}/contrat/retour-paiement?status=cancel`,
          },
          { role: 'DEV' }
        );

        logger.success(`Checkout Session ${reused ? 'réutilisée' : 'créée'} (TEST).`);
        logger.success('Ouvrez cette URL et payez avec une carte de test Stripe (voir docs.stripe.com/testing) :');
        console.log(`\n  ${url}\n`);
        logger.info('Le paiement ne sera marqué PAYÉ que par le webhook signé (backend exposé via ngrok, webhook TEST auto-synchronisé) ou `npm run payments:sync`.');
        process.exitCode = 0;
      }
    }
  }
} catch (err) {
  logger.error(`Échec sandbox Stripe : ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
