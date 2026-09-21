/**
 * Traite les actions d'événements en attente — filet de sécurité manuel.
 *
 * Le dispatch est normalement immédiat après l'émission. Ce script existe pour :
 *  - reprendre les exécutions orphelines d'un processus tué (verrou expiré) ;
 *  - relancer les échecs retryable dont le backoff est échu ;
 *  - servir de point d'entrée à un cron externe, si le besoin apparaît.
 *
 * Idempotent : l'index unique et le verrou atomique rendent une double exécution
 * sans effet. Lancement : npm run events:process
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { processPendingEventActions } from '../services/events/domainEventDispatcher.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
try {
  const { claimed, processed } = await processPendingEventActions({ batchSize: 100 });
  logger.success(`Actions d'événements : ${processed} traitée(s) sur ${claimed} candidate(s).`);
} finally {
  await disconnectDatabase();
}
