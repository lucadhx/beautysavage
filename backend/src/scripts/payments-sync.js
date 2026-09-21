/* Synchronisation Stripe des PAIEMENTS (frais de lancement) — filet de sécurité
 * webhooks. Usage :
 *   npm run payments:sync
 * Relit Stripe (Checkout Session + PaymentIntent) pour chaque contrat ayant une
 * tentative de paiement ouverte (PENDING/PROCESSING) et corrige l'état. Idempotent.
 * Utilise le MODE ACTIF Stripe (jamais l'ENV). Ne crée jamais de paiement, ne
 * touche ni le site ni l'abonnement. Rapport sans secret. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { syncAllPayments } from '../services/reconciliation.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const report = await syncAllPayments();
  logger.success(`Sync paiements Stripe : ${report.corrected}/${report.contracts} contrat(s) corrigé(s).`);
  for (const r of report.report) {
    if (r.changes.length) logger.info(`  ${r.reference} : ${r.changes.join(', ')}`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(0);
