import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import {
  beginDraining, markRunning, markStopped,
} from '../services/lifecycle/runtimeLifecycle.js';
import { installerMessagesDeValidationFrancais } from '../utils/validationFr.js';

/**
 * Connect to MongoDB using the URI resolved from ENV (TEST/PROD).
 */
export async function connectDatabase() {
  /**
   * OUVRIR LA BASE, C'EST REPARTIR. Certaines recettes ferment puis rouvrent
   * dans un même processus ; sans cette remise à zéro, le runtime resterait
   * marqué « arrêté » et cesserait silencieusement de programmer ses
   * projections — un faux négatif bien pire que le bruit qu'on ferme ici.
   */
  markRunning();
  /*
    LES REFUS DE VALIDATION PARLENT FRANÇAIS — y compris hors serveur HTTP.

    Une migration, une graine ou une recette écrit en base sans passer par
    `createApp()`. Sans cet appel, leurs refus mongoose seraient rendus dans la
    langue de la bibliothèque, et une graine invalide se signalerait par une
    phrase anglaise dans un journal francophone. Idempotent.
  */
  installerMessagesDeValidationFrancais();
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    logger.success(`MongoDB connected (ENV=${config.env}, base=${config.dbName})`);
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(config.mongoUri, {
    dbName: config.dbName, // le nom de base est piloté par ENV (TEST/PROD)
    serverSelectionTimeoutMS: 10000,
  });

  return mongoose.connection;
}

/**
 * FERMER LA BASE, C'EST ARRÊTER LE RUNTIME — les deux ne se dissocient pas.
 *
 * ══ POURQUOI LE DRAINAGE EST ICI ════════════════════════════════════════════
 *
 * Tout ce qui travaille en différé (projections regroupées, ordonnanceur du
 * pont) lit la base. Fermer la connexion sous ses pieds ne produit pas une
 * panne : cela produit une FAUSSE panne — un `PROJECTION_BUILD_FAILED` écrit
 * pendant un arrêt parfaitement normal.
 *
 * Poser le drainage ici plutôt que dans `server.js` fait que TOUT appelant en
 * bénéficie, et pas seulement le chemin `SIGTERM` : les suites de recette
 * ferment la base par cette même fonction. Le comportement est donc IDENTIQUE
 * en production et en recette — c'est précisément ce qu'un `if (isTest)`
 * n'aurait pas donné, et ce qui rend le contrôle éprouvable.
 *
 * `beginDraining()` ne lève jamais et s'exécute une seule fois : un second
 * appel (`server.js` puis un test) ne revidange rien.
 */
export async function disconnectDatabase() {
  await beginDraining({ reason: 'disconnect' });
  await mongoose.disconnect();
  markStopped();
}
