/* Synchronisation Yousign des contrats (filet de sécurité webhooks). Usage :
 *   npm run contracts:sync
 * Relit les contrats non terminés ayant une demande de signature, vérifie leur
 * statut Yousign et corrige les états. Idempotent. Utilise le MODE ACTIF Yousign
 * (jamais l'ENV). Ne touche ni Stripe ni le statut du site. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { syncAllContracts } from '../services/reconciliation.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const report = await syncAllContracts();
  logger.success(`Sync signature : ${report.corrected}/${report.contracts} contrat(s) corrigé(s).`);
  for (const r of report.report) {
    if (r.changes.length) logger.info(`  ${r.reference} : ${r.changes.join(', ')}`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(0);
