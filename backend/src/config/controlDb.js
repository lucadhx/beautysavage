/**
 * Connexion au PLAN DE CONTRÔLE (P2).
 *
 * Une connexion Mongoose DÉDIÉE (createConnection), séparée de la connexion
 * métier globale (`config/db.js`). Elle vise `config.controlDbName` sur le même
 * `MONGODB_URI`, mais une base DISTINCTE : les destinations de déploiement et
 * leurs releases ne dépendent donc JAMAIS de l'ENV local du moteur (DB_TEST/
 * DB_PROD). Connexion unique mise en cache, fermeture propre.
 *
 * Les modèles du plan de contrôle sont enregistrés SUR cette connexion (voir
 * models/controlPlane/*), jamais sur la connexion globale.
 */
import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let connPromise = null;
let conn = null;

/**
 * Retourne (en la créant à la demande) la connexion au plan de contrôle.
 * @param {object} [opts]
 * @param {string} [opts.mongoUri]
 * @param {string} [opts.dbName]
 * @returns {Promise<import('mongoose').Connection>}
 */
export async function getControlConnection({ mongoUri = config.mongoUri, dbName = config.controlDbName } = {}) {
  if (conn && conn.readyState === 1) return conn;
  if (connPromise) return connPromise;
  connPromise = (async () => {
    const c = mongoose.createConnection(mongoUri, { dbName, serverSelectionTimeoutMS: 10_000 });
    c.on('connected', () => logger.success?.(`Plan de contrôle connecté (base=${dbName})`));
    c.on('error', (err) => logger.error?.('Plan de contrôle — erreur de connexion', err.message));
    await c.asPromise();
    conn = c;
    return c;
  })();
  try {
    return await connPromise;
  } catch (err) {
    connPromise = null;
    const { ApiError } = await import('../utils/ApiError.js');
    throw new ApiError(503, `CONTROL_DB_UNAVAILABLE: plan de contrôle injoignable (${err.message}).`, 'CONTROL_DB_UNAVAILABLE');
  }
}

/** Ferme proprement la connexion du plan de contrôle (arrêt / tests). */
export async function closeControlConnection() {
  if (conn) { await conn.close().catch(() => {}); conn = null; }
  connPromise = null;
}

export default { getControlConnection, closeControlConnection };
