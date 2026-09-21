// RALENTIR LE FORÇAGE, SANS BLOQUER QUI SE TROMPE DE MOT DE PASSE.
//
// ══ CE QUI EXISTAIT, ET POURQUOI CE N'ÉTAIT PAS SUFFISANT ═══════════════════
//
// `rateLimit()` — un compteur en mémoire, par IP seule, et désactivé dès que
// `config.isTest` est vrai. Or `isTest` vaut `!isProd` : sur l'environnement
// TEST DÉPLOYÉ, la protection était donc **entièrement inactive**. Elle
// existait dans le code et nulle part ailleurs.
//
// Trois défauts s'ajoutaient :
//
//   · par IP seule       — une attaque distribuée passe sous le radar, et un
//                          bureau derrière un NAT se bloque tout seul ;
//   · en mémoire         — le compteur meurt à chaque déploiement ;
//   · local au processus — la limite double dès la seconde instance.
//
// ══ DEUX SEAUX, ET C'EST LE POINT ═══════════════════════════════════════════
//
//     par IP        20 tentatives / 15 min
//     par IDENTITÉ   8 tentatives / 15 min
//
// Chacun seul est contournable, et de façon symétrique — l'un laisse passer le
// balayage de comptes, l'autre laisse passer le balayage d'adresses. Les deux
// doivent passer ; le plus contraignant décide.
//
// ══ AUCUN VERROUILLAGE DE COMPTE ════════════════════════════════════════════
//
// Une fenêtre glissante qui expire d'elle-même. Un verrou permanent
// transformerait une nuisance en déni de service : il suffirait de connaître
// l'adresse d'un administrateur pour lui fermer la porte.
//
// ══ AUCUNE ÉNUMÉRATION INTRODUITE ═══════════════════════════════════════════
//
// Le seau est nourri par l'identité SOUMISE, existante ou non. La réponse est
// identique dans les deux cas.
import { createHash } from 'node:crypto';

import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import AuthAttempt from '../models/AuthAttempt.model.js';

export const AUTH_RATE_LIMITS = Object.freeze({
  windowMs: 15 * 60 * 1000,
  perIp: 20,
  perIdentity: 8,
});

export const AUTH_RATE_LIMITED = 'AUTH_RATE_LIMITED';

function empreinte(valeur) {
  return createHash('sha256').update(String(valeur ?? '').trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * L'ADRESSE DU CLIENT — celle qu'Express a résolue, jamais un en-tête brut.
 *
 * `app.set('trust proxy', 1)` fait qu'Express lit le DERNIER maillon de
 * `X-Forwarded-For`, c'est-à-dire celui que notre nginx a écrit. Lire l'en-tête
 * nous-mêmes reviendrait à croire le premier maillon — fourni par le client —
 * et n'importe qui obtiendrait une adresse neuve à chaque requête.
 */
function adresse(req) {
  return req.ip || req.socket?.remoteAddress || 'inconnue';
}

/** Incrément ATOMIQUE : une lecture-puis-écriture laisserait passer les rafales. */
async function consommer(key, plafond, maintenant) {
  const finFenetre = new Date(maintenant.getTime() + AUTH_RATE_LIMITS.windowMs);

  const vivant = await AuthAttempt.findOneAndUpdate(
    { key, expiresAt: { $gt: maintenant } },
    { $inc: { count: 1 }, $set: { lastAttemptAt: maintenant } },
    { new: true },
  ).lean();

  if (vivant) {
    return {
      depasse: vivant.count > plafond,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(vivant.expiresAt) - maintenant) / 1000)),
    };
  }

  await AuthAttempt.findOneAndUpdate(
    { key },
    { $set: { count: 1, expiresAt: finFenetre, lastAttemptAt: maintenant } },
    { upsert: true },
  );
  return { depasse: false, retryAfterSeconds: Math.ceil(AUTH_RATE_LIMITS.windowMs / 1000) };
}

/** Efface un seau d'identité — appelé sur une connexion réussie. */
export async function oublierTentatives(scope, identite) {
  if (!identite) return;
  await AuthAttempt.deleteOne({ key: `${scope}:id:${empreinte(identite)}` }).catch(() => null);
}

/**
 * @param {{scope: string, identityFrom?: (req: object) => string|null,
 *   identityOnly?: boolean}} options
 *   `identityOnly: false` + `identityFrom` absent ⇒ seau d'IP seul. Utile là où
 *   aucune identité n'est soumise — un échange de jeton, par exemple.
 */
export function authRateLimit({ scope, identityFrom = (req) => req.body?.email ?? null }) {
  return async function limiteur(req, res, next) {
    const maintenant = new Date();
    const identite = identityFrom(req);

    let verdicts;
    try {
      verdicts = await Promise.all([
        consommer(`${scope}:ip:${empreinte(adresse(req))}`, AUTH_RATE_LIMITS.perIp, maintenant),
        identite
          ? consommer(`${scope}:id:${empreinte(identite)}`, AUTH_RATE_LIMITS.perIdentity, maintenant)
          : Promise.resolve({ depasse: false, retryAfterSeconds: 0 }),
      ]);
    } catch (err) {
      /**
       * Base muette : on laisse passer, et on le dit. Refuser toutes les
       * connexions parce que le compteur est illisible transformerait une gêne
       * en panne totale d'authentification — et la base est de toute façon
       * nécessaire pour vérifier un mot de passe.
       */
      logger.warn(`[auth] compteur de tentatives illisible (${scope}) : ${err?.message ?? 'erreur inconnue'}.`);
      return next();
    }

    if (!verdicts.some((v) => v.depasse)) return next();

    const retryAfterSeconds = Math.max(...verdicts.filter((v) => v.depasse).map((v) => v.retryAfterSeconds));
    res.set('Retry-After', String(retryAfterSeconds));

    /**
     * 429, ET SURTOUT PAS 401. Un 401 dirait « identifiants invalides » à
     * quelqu'un qui a peut-être tapé les bons. Le message ne dit ni combien de
     * tentatives restent, ni si l'adresse existe.
     */
    const erreur = new ApiError(429, 'Trop de tentatives de connexion. Réessayez dans quelques minutes.', {
      code: AUTH_RATE_LIMITED,
      retryAfterSeconds,
    });
    return next(erreur);
  };
}

export default authRateLimit;
