import 'dotenv/config';
import mongoose from 'mongoose';

import ServiceBooking from '../models/ServiceBooking.js';
import BookingSlotLock from '../models/BookingSlotLock.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import { resolveInstitutePractitionerProfile, DEFAULT_INSTITUTE_CALENDAR_ID } from '../services/calendar/instituteCalendarContext.js';

// M11B — Cleanup VOLONTAIRE de l'héritage multi-prestataire (practitionerId), entité institut unique.
//
// PRINCIPES (RÈGLES ABSOLUES) :
//  - dry-run PAR DÉFAUT ; `--apply` requis pour écrire ; `--force-prod` requis en production.
//  - NE SUPPRIME JAMAIS de document (consolidation + archivage uniquement).
//  - JAMAIS exécuté au boot (script standalone). Idempotent.
//
// Opérations (toutes opt-in via --apply) :
//  1. Consolidation : re-pointe tout `practitionerId` égaré (ServiceBooking / BookingSlotLock) vers
//     l'UNIQUE entité institut (jamais null — le champ reste `required`).
//  2. Archivage : désactive (isActive=false + archivedAt) les PractitionerProfile NON-institut sans
//     aucune réservation (jamais de delete).
//  3. (--create-global-index) : crée l'index global unique `BookingSlotLock { slotStartAt } unique`
//     APRÈS contrôle d'absence de doublons (sinon abandon). L'ancien index n'est PAS droppé.
//
// Usage CLI : node scripts/cleanupPractitionerLegacy.js [--apply] [--force-prod] [--create-global-index]
// Programmatique (tests) : cleanupPractitionerLegacy({ apply, createGlobalIndex, logger }) sur une
// connexion mongoose déjà ouverte.

const noopLogger = { log: () => {} };
export const GLOBAL_SLOT_INDEX_NAME = 'global_slot_unique';

/**
 * @param {{ apply?: boolean, createGlobalIndex?: boolean, logger?: { log: Function } }} [opts]
 * @returns {Promise<object>} plan + actions appliquées (structuré, safe pour logs/tests)
 */
export async function cleanupPractitionerLegacy({ apply = false, createGlobalIndex = false, logger = noopLogger } = {}) {
  const report = {
    apply,
    instituteId: null,
    counts: {},
    strayBookings: 0,
    strayLocks: 0,
    archivedProfiles: 0,
    globalIndex: { requested: createGlobalIndex, created: false, duplicates: 0, skippedReason: null },
    applied: false
  };

  const institute = await resolveInstitutePractitionerProfile();
  report.instituteId = institute ? String(institute._id) : null;
  report.calendarId = DEFAULT_INSTITUTE_CALENDAR_ID;

  const [bookingCount, lockCount, profileCount] = await Promise.all([
    ServiceBooking.countDocuments({}),
    BookingSlotLock.countDocuments({}),
    PractitionerProfile.countDocuments({})
  ]);
  report.counts = { serviceBookings: bookingCount, bookingSlotLocks: lockCount, practitionerProfiles: profileCount };

  if (!institute) {
    report.skippedReason = 'NO_INSTITUTE_PROFILE';
    logger.log('[cleanupPractitionerLegacy] Aucun PractitionerProfile (institut) — rien à consolider.');
    return report;
  }

  const instituteId = institute._id;

  // 1. Consolidation des réservations / verrous égarés (practitionerId != institut).
  report.strayBookings = await ServiceBooking.countDocuments({ practitionerId: { $ne: instituteId } });
  report.strayLocks = await BookingSlotLock.countDocuments({ practitionerId: { $ne: instituteId } });

  // 2. Profils NON-institut : la consolidation ré-oriente toutes les réservations vers l'institut,
  // ils deviennent donc orphelins → archivables (isActive=false, jamais delete). On exclut ceux déjà
  // archivés (idempotence).
  const otherProfiles = await PractitionerProfile
    .find({ _id: { $ne: instituteId }, isActive: { $ne: false } })
    .select('_id')
    .lean();
  const archivableProfileIds = otherProfiles.map(p => p._id);
  report.archivableProfiles = archivableProfileIds.length;

  // 3. Contrôle des doublons pour l'index global (toujours rapporté, même en dry-run).
  if (createGlobalIndex) {
    const dups = await BookingSlotLock.aggregate([
      { $group: { _id: '$slotStartAt', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: 'duplicates' }
    ]);
    report.globalIndex.duplicates = dups[0]?.duplicates || 0;
  }

  logger.log(`[cleanupPractitionerLegacy] dry-run — institut=${report.instituteId}, ` +
    `bookings égarés=${report.strayBookings}, locks égarés=${report.strayLocks}, ` +
    `profils archivables=${report.archivableProfiles}, doublons slot=${report.globalIndex.duplicates}`);

  if (!apply) {
    logger.log('[cleanupPractitionerLegacy] DRY-RUN (aucune écriture). Relancer avec --apply pour appliquer.');
    return report;
  }

  // ── APPLY (idempotent, non destructif) ────────────────────────────────────
  if (report.strayBookings > 0) {
    await ServiceBooking.updateMany({ practitionerId: { $ne: instituteId } }, { $set: { practitionerId: instituteId } });
  }
  if (report.strayLocks > 0) {
    // Re-pointage best-effort ; en cas de collision d'unicité (improbable, entité unique) on ignore.
    try {
      await BookingSlotLock.updateMany({ practitionerId: { $ne: instituteId } }, { $set: { practitionerId: instituteId } });
    } catch (err) {
      logger.log(`[cleanupPractitionerLegacy] ⚠ collision re-pointage locks (ignorée) : ${err?.message || err}`);
    }
  }
  if (archivableProfileIds.length) {
    await PractitionerProfile.updateMany(
      { _id: { $in: archivableProfileIds } },
      { $set: { isActive: false, archivedAt: new Date(), archivedReason: 'm11b_practitioner_legacy_cleanup' } }
    );
    report.archivedProfiles = archivableProfileIds.length;
  }

  if (createGlobalIndex) {
    if (report.globalIndex.duplicates > 0) {
      report.globalIndex.skippedReason = 'DUPLICATE_SLOTS_PRESENT';
      logger.log('[cleanupPractitionerLegacy] ⚠ Index global NON créé : doublons slotStartAt présents.');
    } else {
      try {
        await BookingSlotLock.collection.createIndex({ slotStartAt: 1 }, { unique: true, name: GLOBAL_SLOT_INDEX_NAME });
        report.globalIndex.created = true;
        logger.log(`[cleanupPractitionerLegacy] Index global ${GLOBAL_SLOT_INDEX_NAME} créé (ancien index conservé).`);
      } catch (err) {
        report.globalIndex.skippedReason = `CREATE_FAILED: ${err?.message || err}`;
        logger.log(`[cleanupPractitionerLegacy] ⚠ Création index global échouée : ${err?.message || err}`);
      }
    }
  }

  report.applied = true;
  logger.log(`[cleanupPractitionerLegacy] APPLY terminé — bookings consolidés=${report.strayBookings}, ` +
    `locks consolidés=${report.strayLocks}, profils archivés=${report.archivedProfiles}.`);
  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function isMainModule() {
  const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
  return invoked.endsWith('cleanupPractitionerLegacy.js');
}

if (isMainModule()) {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const createGlobalIndex = args.has('--create-global-index');
  const forceProd = args.has('--force-prod');
  const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';

  (async () => {
    if (apply && isProd && !forceProd) {
      console.error('[cleanupPractitionerLegacy] REFUS : --apply en production exige --force-prod.');
      process.exit(1);
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('[cleanupPractitionerLegacy] MONGODB_URI manquant.');
      process.exit(1);
    }
    await mongoose.connect(uri);
    try {
      const report = await cleanupPractitionerLegacy({ apply, createGlobalIndex, logger: console });
      console.log('[cleanupPractitionerLegacy] Rapport :', JSON.stringify(report, null, 2));
    } finally {
      await mongoose.disconnect();
    }
  })().catch(err => {
    console.error('[cleanupPractitionerLegacy] Échec :', err);
    process.exit(1);
  });
}

export default cleanupPractitionerLegacy;
