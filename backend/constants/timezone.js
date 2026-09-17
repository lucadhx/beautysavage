// constants/timezone.js
// Sprint pré-React A2 — Timezone métier centralisée (Europe/Paris).
//
// CONTEXTE (rapport 77) : aucune librairie timezone n'est utilisée. Les créneaux
// calendrier sont construits avec `new Date(y, m-1, d, h, min)` qui produit une heure
// MURALE LOCALE au fuseau du serveur. Si l'hébergement bascule en UTC, « 10:00 »
// devient 10:00 UTC = 11:00/12:00 Paris → tous les créneaux décalés.
//
// OBJECTIF : garantir explicitement Europe/Paris pour les calculs calendrier.
//   - `BUSINESS_TIMEZONE` : source de vérité unique du fuseau métier.
//   - garde de démarrage qui logge le fuseau métier + le fuseau serveur détecté,
//     avertit en cas de divergence, et (hors test) force `process.env.TZ`.
//
// Ce module ne contient AUCUN secret et n'effectue aucune I/O réseau.

export const BUSINESS_TIMEZONE = 'Europe/Paris';

// Version de la garde — incrémentée si la sémantique de la garde change (traçabilité logs).
export const BUSINESS_TIMEZONE_GUARD_VERSION = '1.0-a2';

/**
 * Fuseau résolu par le moteur JS pour le process courant.
 * (Reflète process.env.TZ si défini, sinon le fuseau de l'OS.)
 * @returns {string} ex. 'Europe/Paris', 'UTC', 'America/New_York'
 */
export function getServerTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (_err) {
    return '';
  }
}

/**
 * Offset (en minutes, signé) d'un fuseau IANA pour un instant donné.
 * Positif à l'est de l'UTC (Europe/Paris = +60 l'hiver, +120 l'été).
 * Gère automatiquement l'heure d'été/hiver (DST) puisque le calcul dépend de `date`.
 * @param {string} timeZone fuseau IANA
 * @param {Date} [date] instant de référence (défaut: maintenant)
 * @returns {number|null} offset en minutes, ou null si le fuseau est invalide
 */
export function getTimezoneOffsetMinutes(timeZone, date = new Date()) {
  if (!timeZone) return null;
  try {
    // Reconstruit l'heure murale dans le fuseau cible puis compare à l'instant UTC.
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = dtf.formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    const hour = parts.hour === '24' ? '00' : parts.hour;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch (_err) {
    return null;
  }
}

/**
 * Le fuseau effectif du serveur est-il aligné sur le fuseau métier pour `date` ?
 * On compare les OFFSETS (et non les noms) : un serveur configuré sur 'Europe/Paris'
 * ou tout autre fuseau partageant l'offset Paris à cet instant est considéré aligné.
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isServerAlignedWithBusinessTimezone(date = new Date()) {
  const businessOffset = getTimezoneOffsetMinutes(BUSINESS_TIMEZONE, date);
  // Offset local du serveur = -getTimezoneOffset() (Date renvoie l'inverse du signe IANA).
  const serverOffset = -new Date(date.getTime()).getTimezoneOffset();
  if (businessOffset === null) return false;
  return businessOffset === serverOffset;
}

/**
 * Diagnostic complet du contexte fuseau (pour log/observabilité, sans secret).
 * @param {Date} [date]
 */
export function describeTimezoneContext(date = new Date()) {
  const serverTimezone = getServerTimezone();
  const businessOffsetMinutes = getTimezoneOffsetMinutes(BUSINESS_TIMEZONE, date);
  const serverOffsetMinutes = -new Date(date.getTime()).getTimezoneOffset();
  return {
    businessTimezone: BUSINESS_TIMEZONE,
    serverTimezone,
    businessOffsetMinutes,
    serverOffsetMinutes,
    aligned: businessOffsetMinutes !== null && businessOffsetMinutes === serverOffsetMinutes,
    envTz: String(process.env.TZ || '') || null
  };
}

/**
 * Garde de démarrage du fuseau métier.
 * - Logge toujours le fuseau métier + le fuseau serveur détecté + l'alignement.
 * - Avertit (sans bloquer) en cas de divergence d'offset.
 * - Si `force` est vrai ET qu'aucun TZ explicite n'est déjà aligné, pose
 *   `process.env.TZ = BUSINESS_TIMEZONE`. Node ré-applique tzset à la prochaine
 *   construction de Date, donc les calculs de créneaux suivants sont en Europe/Paris.
 *
 * IMPORTANT : à ne PAS forcer pendant les tests (NODE_ENV==='test') — l'app est
 * importée par supertest et changer TZ en cours de process pourrait perturber
 * d'autres suites. Le forçage est donc activé uniquement hors test par l'appelant.
 *
 * @param {{ force?: boolean, logger?: { log: Function, warn: Function } }} [opts]
 * @returns {ReturnType<typeof describeTimezoneContext> & { forced: boolean }}
 */
export function assertBusinessTimezone({ force = false, logger = console } = {}) {
  const ctx = describeTimezoneContext();
  const log = typeof logger?.log === 'function' ? logger.log.bind(logger) : () => {};
  const warn = typeof logger?.warn === 'function' ? logger.warn.bind(logger) : log;

  log(
    `[timezone] business=${ctx.businessTimezone} server=${ctx.serverTimezone || 'unknown'} ` +
      `serverOffset=${ctx.serverOffsetMinutes}min businessOffset=${ctx.businessOffsetMinutes}min ` +
      `aligned=${ctx.aligned} guard=${BUSINESS_TIMEZONE_GUARD_VERSION}`
  );

  let forced = false;
  if (!ctx.aligned) {
    if (force) {
      process.env.TZ = BUSINESS_TIMEZONE;
      forced = true;
      const after = describeTimezoneContext();
      log(
        `[timezone] process.env.TZ forcé à ${BUSINESS_TIMEZONE} ` +
          `(serverTimezone=${after.serverTimezone || 'unknown'} aligned=${after.aligned}).`
      );
    } else {
      warn(
        `[timezone] ⚠ Fuseau serveur NON aligné sur ${ctx.businessTimezone} ` +
          `(serveur=${ctx.serverTimezone || 'unknown'}, offset ${ctx.serverOffsetMinutes}min vs ${ctx.businessOffsetMinutes}min). ` +
          `Les créneaux calendrier risquent d'être décalés. Configurez TZ=${ctx.businessTimezone}.`
      );
    }
  }

  return { ...ctx, forced };
}

export default {
  BUSINESS_TIMEZONE,
  BUSINESS_TIMEZONE_GUARD_VERSION,
  getServerTimezone,
  getTimezoneOffsetMinutes,
  isServerAlignedWithBusinessTimezone,
  describeTimezoneContext,
  assertBusinessTimezone
};
