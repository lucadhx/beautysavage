/* Synchronisation Stripe des ABONNEMENTS — filet de sécurité webhooks. Usage :
 *   npm run subscriptions:sync
 * Relit Stripe pour chaque contrat ayant un abonnement non terminal et corrige
 * statut / période / résiliation / fin, puis réconcilie le site. Idempotent.
 * Utilise le MODE ACTIF Stripe (jamais l'ENV). Rapport sans secret. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { syncAllSubscriptions } from '../services/reconciliation.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const report = await syncAllSubscriptions();
  logger.success(`Sync abonnements Stripe : ${report.corrected}/${report.contracts} contrat(s) corrigé(s).`);
  for (const r of report.report) {
    if (r.changes.length) logger.info(`  ${r.reference} : ${r.changes.join(', ')}`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(0);
