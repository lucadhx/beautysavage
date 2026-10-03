import { onDrain } from './lifecycle/runtimeLifecycle.js';
import { logger } from '../utils/logger.js';

/**
 * LA VITRINE EN TEMPS RÉEL — `GET /api/public/live`.
 *
 * Quand l'institut enregistre la page « Informations » (nom, slogan,
 * accroche, texte d'accueil), le contenu d'accueil ou le thème, les vitrines
 * ouvertes le savent aussitôt et relisent leur amorçage : la bannière change
 * sous les yeux du visiteur, sans rechargement.
 *
 * Flux PUBLIC, donc minimal :
 *   - il ne transporte que le NOM de ce qui a changé (« site »), jamais une
 *     donnée — la vitrine redemande à l'API publique, qui reste la source ;
 *   - le nombre de connexions est PLAFONNÉ : un anonyme ne peut pas en
 *     accumuler sans limite ;
 *   - `text/event-stream` (EventSource, reconnexion native) : aucun jeton à
 *     porter, puisqu'il n'y a rien de privé.
 */

const MAX_SUBSCRIBERS = 1000;
const KEEPALIVE_MS = 25_000;
const subscribers = new Set();

export function publicLiveStream(req, res) {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    res.status(503).set('Retry-After', '60').end();
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  // La vitrine reprend seule après une coupure : délai de reconnexion suggéré.
  res.write('retry: 5000\n\n');

  const subscriber = {
    write(chunk) {
      try { res.write(chunk); res.flush?.(); } catch { /* flux fermé */ }
    },
    end() { try { res.end(); } catch { /* déjà fermé */ } },
  };
  subscribers.add(subscriber);
  const keepalive = setInterval(() => subscriber.write(': ok\n\n'), KEEPALIVE_MS);
  keepalive.unref?.();
  req.on('close', () => {
    clearInterval(keepalive);
    subscribers.delete(subscriber);
  });
}

/** Prévient les vitrines ouvertes qu'une ressource publique a changé. */
export function notifyPublicChange(resource = 'site') {
  if (!subscribers.size) return;
  const payload = `event: change\ndata: ${JSON.stringify({ resource, at: Date.now() })}\n\n`;
  for (const subscriber of subscribers) subscriber.write(payload);
  logger.info(`[public-live] « ${resource} » diffusé à ${subscribers.size} vitrine(s).`);
}

/** À l'arrêt : un flux ouvert empêcherait `server.close()` d'aboutir. */
export function closePublicSubscribers() {
  for (const subscriber of [...subscribers]) subscriber.end();
  subscribers.clear();
}

onDrain(() => closePublicSubscribers(), { label: 'flux public vitrine' });
