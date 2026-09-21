import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';

/**
 * Limiteur de débit en mémoire, sans dépendance.
 *
 * Suffisant pour un déploiement mono-instance (PM2 fork). Pour un cluster
 * multi-process, remplacer le store par Redis. Désactivé en TEST pour ne pas
 * perturber la suite de tests (qui martèle l'API depuis 127.0.0.1).
 *
 * @param {{ windowMs:number, max:number, message?:string }} opts
 */
export function rateLimit({ windowMs, max, message = 'Trop de requêtes, réessayez plus tard' }) {
  /** @type {Map<string, { count:number, reset:number }>} */
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    if (config.isTest) return next(); // pas de limitation pendant les tests/dev

    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = hits.get(key);

    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
      // Purge opportuniste des entrées expirées pour borner la mémoire.
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
      }
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(ApiError.tooMany(message));
    }
    next();
  };
}

export default rateLimit;
