// scripts/cleanupBusinessHistory.js
// Pré-React D4 — Nettoyage VOLONTAIRE des données transactionnelles de test/historique.
//
// USAGE :
//   node scripts/cleanupBusinessHistory.js                         # DRY-RUN (ne supprime RIEN)
//   node scripts/cleanupBusinessHistory.js --apply                 # supprime les collections transactionnelles
//   node scripts/cleanupBusinessHistory.js --apply --include-bookings --include-event-logs --include-send-logs
//
// SÉCURITÉ :
//   - Dry-run par défaut : aucune suppression sans `--apply`.
//   - Whitelist STRICTE : seules les collections transactionnelles sont supprimables.
//   - NE TOUCHE JAMAIS la configuration : User/Admin, Service, Formation, Product, GiftCard,
//     EmailTemplate, IntegratedApi, Contract, CommissionConfig, CommissionSettings,
//     PractitionerProfile, PractitionerSchedule, ScheduleException, SiteIdentity.
//   - Refus en production sans `--force-prod` (garde-fou supplémentaire).
//   - Jamais exécuté au boot. Ne logge jamais de secret.

import mongoose from 'mongoose';

import Sale from '../models/Sale.js';
import RefundRequest from '../models/RefundRequest.js';
import CommissionPayment from '../models/CommissionPayment.js';
import CommissionTransaction from '../models/CommissionTransaction.js';
import Invoice from '../models/Invoice.js';
import Purchase from '../models/Purchase.js';
import StripeCheckoutIntent from '../models/StripeCheckoutIntent.js';
import GiftCardTransaction from '../models/GiftCardTransaction.js';
import BookingSlotLock from '../models/BookingSlotLock.js';
import ServiceBooking from '../models/ServiceBooking.js';
import EventLog from '../models/EventLog.js';
import SendLog from '../models/SendLog.js';

// Contextes transactionnels (pour filtrer EventLog/SendLog liés ventes/remboursements/commissions).
const TRANSACTIONAL_CONTEXTS = ['sale', 'service_booking', 'refund_request', 'commission_payment', 'gift_card', 'formation_session'];

/**
 * Nettoie les collections transactionnelles. Lecture seule sauf si apply=true.
 * @param {object} opts
 * @param {boolean} [opts.apply=false] supprime réellement (sinon dry-run)
 * @param {boolean} [opts.includeBookings=false] inclut ServiceBooking
 * @param {boolean} [opts.includeEventLogs=false] inclut EventLog transactionnels
 * @param {boolean} [opts.includeSendLogs=false] inclut SendLog transactionnels
 * @param {Console} [opts.logger=console]
 * @returns {Promise<{apply:boolean, collections:object}>}
 */
export async function cleanupBusinessHistory({
  apply = false,
  includeBookings = false,
  includeEventLogs = false,
  includeSendLogs = false,
  logger = console
} = {}) {
  // Whitelist : { label, model, filter }
  const targets = [
    { label: 'Sale', model: Sale, filter: {} },
    { label: 'RefundRequest', model: RefundRequest, filter: {} },
    { label: 'CommissionPayment', model: CommissionPayment, filter: {} },
    { label: 'CommissionTransaction', model: CommissionTransaction, filter: {} },
    { label: 'Invoice', model: Invoice, filter: {} },
    { label: 'Purchase', model: Purchase, filter: {} },
    { label: 'StripeCheckoutIntent', model: StripeCheckoutIntent, filter: {} },
    { label: 'GiftCardTransaction', model: GiftCardTransaction, filter: {} },
    { label: 'BookingSlotLock', model: BookingSlotLock, filter: {} }
  ];
  if (includeBookings) targets.push({ label: 'ServiceBooking', model: ServiceBooking, filter: {} });
  if (includeEventLogs) targets.push({ label: 'EventLog', model: EventLog, filter: { contextType: { $in: TRANSACTIONAL_CONTEXTS } } });
  if (includeSendLogs) targets.push({ label: 'SendLog', model: SendLog, filter: { contextType: { $in: TRANSACTIONAL_CONTEXTS } } });

  const collections = {};
  for (const { label, model, filter } of targets) {
    // eslint-disable-next-line no-await-in-loop
    const count = await model.countDocuments(filter);
    let deleted = 0;
    if (apply && count > 0) {
      // eslint-disable-next-line no-await-in-loop
      const res = await model.deleteMany(filter);
      deleted = res?.deletedCount || 0;
    }
    collections[label] = { matched: count, deleted: apply ? deleted : 0, wouldDelete: apply ? 0 : count };
  }

  const totalMatched = Object.values(collections).reduce((s, c) => s + c.matched, 0);
  logger.log(
    `[cleanupBusinessHistory] mode=${apply ? 'APPLY' : 'DRY-RUN'} ` +
      `collections=${Object.keys(collections).length} totalMatched=${totalMatched} ` +
      `(bookings=${includeBookings} eventLogs=${includeEventLogs} sendLogs=${includeSendLogs})`
  );
  return { apply, collections };
}

// CLI
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const opts = {
    apply,
    includeBookings: args.includes('--include-bookings'),
    includeEventLogs: args.includes('--include-event-logs'),
    includeSendLogs: args.includes('--include-send-logs')
  };
  const run = async () => {
    if (apply && process.env.NODE_ENV === 'production' && !args.includes('--force-prod')) {
      console.error('[cleanupBusinessHistory] Refus en production sans --force-prod.');
      process.exit(1);
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI manquant.'); process.exit(1); }
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    try {
      const result = await cleanupBusinessHistory(opts);
      console.log(JSON.stringify(result.collections, null, 2));
      if (!apply) console.log('DRY-RUN — aucune suppression. Relancer avec --apply pour supprimer.');
    } finally {
      await mongoose.disconnect();
    }
  };
  run().catch(err => { console.error('[cleanupBusinessHistory] erreur:', err?.message || err); process.exit(1); });
}

export default cleanupBusinessHistory;
