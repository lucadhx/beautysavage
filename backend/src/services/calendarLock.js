import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/**
 * UN SEUL ÉCRIVAIN À LA FOIS DANS LE PLANNING.
 *
 * Réserver, c'est « vérifier que l'heure est libre » PUIS « écrire le
 * rendez-vous ». Entre les deux, une autre cliente qui paie au même instant
 * faisait la même vérification, la trouvait libre elle aussi, et les deux
 * rendez-vous s'écrivaient l'un sur l'autre.
 *
 * Le verrou est un document au `_id` fixe : l'insérer réussit pour une seule
 * requête (clé unique). Les autres attendent quelques centaines de
 * millisecondes. Un verrou abandonné (processus tué en pleine écriture) expire
 * de lui-même au bout de LOCK_TTL_MS. Un institut ne reçoit pas assez de
 * réservations simultanées pour qu'un verrou unique, plutôt qu'un par jour,
 * coûte quoi que ce soit.
 */
const LOCK_ID = 'calendar-write';
const LOCK_TTL_MS = 15_000;
const WAIT_MS = 8_000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const locks = () => mongoose.connection.collection('calendarlocks');

export async function withCalendarLock(work) {
  const owner = crypto.randomUUID();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await locks().insertOne({ _id: LOCK_ID, owner, at: new Date() });
      break;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Verrou périmé : son détenteur est mort sans le rendre.
      await locks().deleteOne({ _id: LOCK_ID, at: { $lt: new Date(Date.now() - LOCK_TTL_MS) } });
      if (Date.now() > deadline) {
        throw ApiError.conflict('Le planning est très sollicité en ce moment. Réessayez dans quelques secondes.', { code: 'CALENDAR_BUSY' });
      }
      await sleep(120 + Math.floor(Math.random() * 120));
    }
  }
  try {
    return await work();
  } finally {
    await locks().deleteOne({ _id: LOCK_ID, owner }).catch(() => null);
  }
}
