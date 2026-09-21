/**
 * Nettoyage des fichiers upload orphelins : `npm run uploads:cleanup`.
 *
 *   --dry-run   (défaut) : liste les orphelins sans rien supprimer.
 *   --apply              : supprime réellement les fichiers orphelins.
 *   --grace=<minutes>    : période de grâce (défaut 0 en manuel — on veut un
 *                          nettoyage complet immédiat des fichiers accumulés).
 *
 * Un fichier est orphelin s'il n'est référencé par AUCUN document de
 * DB_TEST ∪ DB_PROD (voir storage.service.js). Le balayage est donc sûr même si
 * le dossier /uploads est partagé entre les deux bases.
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { sweepOrphans } from '../services/storage.service.js';
import { logger } from '../utils/logger.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const graceArg = args.find((a) => a.startsWith('--grace='));
const graceMinutes = graceArg ? Number(graceArg.split('=')[1]) : 0;
const minAgeMs = Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes * 60_000 : 0;

(async () => {
  try {
    await connectDatabase();
    const report = await sweepOrphans({ dryRun: !apply, minAgeMs });

    logger.info(`Fichiers référencés (TEST ∪ PROD) : ${report.referencedCount}`);
    logger.info(`Fichiers physiques dans /uploads : ${report.physicalCount}`);
    if (report.keptRecent.length > 0) {
      logger.info(`Conservés (période de grâce) : ${report.keptRecent.length}`);
    }

    const label = apply ? 'supprimé(s)' : 'orphelin(s) détecté(s) [dry-run]';
    logger.info(
      `${report.deleted.length} ${label} — ${(report.reclaimedBytes / 1024).toFixed(0)} Ko`
    );
    for (const f of report.deleted) logger.info(`  · ${f}`);

    if (!apply && report.deleted.length > 0) {
      logger.warn('Relancez avec --apply pour supprimer réellement.');
    }
    logger.success('Nettoyage terminé');
  } catch (err) {
    logger.error('Nettoyage échoué', err);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
