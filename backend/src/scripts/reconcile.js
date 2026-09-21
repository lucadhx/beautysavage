/* Réconciliation des contrats (filet de sécurité webhooks). Usage :
 *   npm run contracts:reconcile
 * Interroge Yousign & Stripe, corrige les états dérivables, réconcilie le site,
 * imprime un rapport. Idempotent. Utilise l'environnement actif (ENV). */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { reconcileAll } from '../services/reconciliation.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const report = await reconcileAll();
  logger.success(
    `Réconciliation : ${report.corrected}/${report.contracts} contrat(s) corrigé(s). ` +
      `Statut site : ${report.siteStatus}.`
  );
  for (const r of report.report) {
    if (r.changes.length) logger.info(`  ${r.reference} : ${r.changes.join(', ')}`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(0);
