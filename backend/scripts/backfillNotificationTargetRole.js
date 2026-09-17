import 'dotenv/config';
import mongoose from 'mongoose';
import { resolveNotificationTargetRole } from '../services/notificationTargetService.js';

// M3A — Backfill idempotent du champ `targetRole` (audience admin|dev) des notifications.
// - dry-run par défaut ; `--apply` obligatoire pour écrire.
// - cible les notifications dont targetRole ∉ {'admin','dev'} (null + valeurs legacy).
// - mapping par type via resolveNotificationTargetRole(eventType, variables).
// - JAMAIS de suppression ni de modification du contenu/historique.
// - logs : compteurs admin / dev / skipped (déjà ok).
//
// Usage CLI : node scripts/backfillNotificationTargetRole.js [--apply]
// Programmatique (tests) : backfillNotificationTargetRole({ apply, logger }) sur une
// connexion mongoose ouverte.

const VALID = new Set(['admin', 'dev']);
const noopLogger = { log: () => {} };

/** Exécute le backfill sur la connexion mongoose courante. Renvoie les compteurs. */
export async function backfillNotificationTargetRole({ apply = false, logger = noopLogger } = {}) {
  const col = mongoose.connection.collection('notifications');

  // À backfiller : targetRole absent/null OU valeur hors {'admin','dev'}.
  const needsBackfill = {
    $or: [
      { targetRole: { $exists: false } },
      { targetRole: null },
      { targetRole: { $nin: ['admin', 'dev'] } }
    ]
  };

  const docs = await col.find(needsBackfill).toArray();
  const total = await col.countDocuments({});
  logger.log(
    `[backfillNotificationTargetRole] ${docs.length}/${total} notification(s) à traiter. mode=${apply ? 'APPLY' : 'DRY-RUN'}`
  );

  const counts = { admin: 0, dev: 0, unknownToAdmin: 0, skipped: total - docs.length, updated: 0 };
  const plan = []; // { _id, eventType, from, to }

  for (const doc of docs) {
    const resolved = resolveNotificationTargetRole(doc.eventType, doc.variables || {});
    const audience = VALID.has(resolved) ? resolved : 'admin';
    if (audience === 'dev') counts.dev += 1;
    else counts.admin += 1;
    // "unknown" = type non mappé qui retombe sur admin par défaut.
    const t = String(doc.eventType || '').trim();
    if (audience === 'admin' && !t) counts.unknownToAdmin += 1;
    plan.push({ _id: doc._id, eventType: doc.eventType || null, from: doc.targetRole ?? null, to: audience });
  }

  logger.log('[backfillNotificationTargetRole] plan :', {
    admin: counts.admin,
    dev: counts.dev,
    unknownToAdmin: counts.unknownToAdmin,
    skipped: counts.skipped
  });

  if (!apply) return { applied: false, counts, plan };

  for (const p of plan) {
    await col.updateOne({ _id: p._id }, { $set: { targetRole: p.to } });
    counts.updated += 1;
  }

  logger.log(`[backfillNotificationTargetRole] APPLY terminé : ${counts.updated} mise(s) à jour.`);
  return { applied: true, counts, plan };
}

async function runCli() {
  const apply = process.argv.includes('--apply');
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  try {
    await backfillNotificationTargetRole({ apply, logger: console });
    if (!apply) {
      console.log('[backfillNotificationTargetRole] DRY-RUN : aucune écriture. Relancer avec --apply.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

// Exécution CLI uniquement quand le script est lancé directement.
if (process.argv[1] && process.argv[1].includes('backfillNotificationTargetRole')) {
  runCli().catch((error) => {
    console.error('[backfillNotificationTargetRole] échec :', error);
    process.exit(1);
  });
}
