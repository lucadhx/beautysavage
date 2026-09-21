/* Backfill/synchronisation des FACTURES Stripe (miroir interne). Usage :
 *   npm run invoices:sync
 * Pour chaque contrat ayant un Customer Stripe, liste ses factures Stripe et met à
 * jour le miroir interne (numéro, statut, liens hosted + PDF). Idempotent ; ne crée
 * aucune facture côté Stripe. Utilise le MODE ACTIF Stripe. Rapport sans secret. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { syncAllInvoices } from '../services/billing.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const report = await syncAllInvoices();
  const total = report.report.reduce((n, r) => n + r.upserted, 0);
  logger.success(`Sync factures Stripe : ${total} nouvelle(s) sur ${report.contracts} contrat(s).`);
  for (const r of report.report) {
    if (r.upserted) logger.info(`  ${r.reference} : +${r.upserted} (sur ${r.count})`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(0);
