/* Standalone seed runner: `npm run seed`. Idempotent. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { bootstrap } from '../config/bootstrap.js';
import { logger } from '../utils/logger.js';

(async () => {
  try {
    await connectDatabase();
    await bootstrap();
    logger.success('Seed terminé');
  } catch (err) {
    logger.error('Seed échoué', err);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
