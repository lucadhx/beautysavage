/**
 * FLUX D'INVALIDATION D'INTERFACE — `GET /api/live/events`.
 *
 * ══ POURQUOI UN FLUX NDJSON, ET PAS `text/event-stream` ═════════════════════
 *
 * Le dépôt possède déjà un transport de flux authentifié : NDJSON lu par
 * `fetch` + reader, utilisé pour la progression des déploiements
 * (`streamNdjson` côté Manager). Il conserve l'en-tête `Authorization`, que
 * `EventSource` ne sait pas porter — et le jeton n'a rien à faire dans une
 * URL : il finirait dans les journaux d'accès, l'historique du navigateur et
 * les référents.
 *
 * Réutiliser cette primitive évite un second style de flux, un second client,
 * et un second endroit où corriger un défaut de reconnexion.
 *
 * ══ CE QUI TRANSITE, ET CE QUI N'Y TRANSITE JAMAIS ══════════════════════════
 *
 * Uniquement le NOM d'une ressource qui vient de changer. Aucun objet métier,
 * aucun identifiant, aucun secret. Le navigateur, prévenu, redemande la donnée
 * à sa propre API — qui reste l'unique source de vérité.
 */
import { subscribe } from '../services/uiLive/uiLive.service.js';

/**
 * Rythme du battement de maintien, en millisecondes.
 *
 * Un flux muet est coupé par les intermédiaires — proxy, Nginx, équilibreur —
 * après une poignée de dizaines de secondes. Le battement le garde ouvert.
 *
 * Il n'est PAS journalisé : une ligne toutes les 25 secondes par onglet
 * ouvert noierait le journal sous du bruit, et masquerait précisément les
 * événements qu'on veut pouvoir y lire.
 */
const KEEPALIVE_MS = 25_000;

export function liveEvents(req, res) {
  /**
   * MÊMES EN-TÊTES QUE LE FLUX DE DÉPLOIEMENT — dont `X-Accel-Buffering: no`.
   *
   * Sans lui, Nginx tamponne la réponse et ne la relâche qu'à la fermeture :
   * le flux fonctionnerait en local et ne livrerait RIEN une fois déployé —
   * exactement le genre d'écart local/production que ce dépôt vient de payer
   * cher sur les limites d'upload.
   */
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let ferme = false;
  const ecrire = (objet) => {
    if (ferme) return;
    try {
      res.write(`${JSON.stringify(objet)}\n`);
      res.flush?.();
    } catch {
      ferme = true;
    }
  };

  // Un premier message immédiat : il confirme au client que le flux est
  // réellement ouvert, sans quoi « connecté » ne serait qu'une supposition.
  ecrire({ type: 'live.ready', at: new Date().toISOString() });

  /**
   * LE SERVICE REÇOIT DE QUOI FERMER, pas seulement de quoi écrire.
   *
   * Sans cela, un arrêt ne pouvait pas mettre fin à ce flux : `server.close()`
   * attendait la dernière connexion, ce battement la maintenait ouverte, et
   * l'arrêt se terminait par une sortie forcée. `terminer` est déclaré
   * ci-dessous et refermé ici — il est idempotent, donc l'appeler depuis le
   * service ou depuis `req.on('close')` revient au même.
   */
  const desabonner = subscribe(ecrire, {
    label: req.user?.email ?? 'manager',
    fermer: () => terminer(),
  });

  const battement = setInterval(() => {
    // Un objet typé plutôt qu'une ligne vide : le client distingue ainsi un
    // maintien de connexion d'une trame qu'il n'aurait pas su lire.
    ecrire({ type: 'live.keepalive' });
  }, KEEPALIVE_MS);
  battement.unref?.();

  const terminer = () => {
    if (ferme) return;
    ferme = true;
    clearInterval(battement);
    desabonner();
    try { res.end(); } catch { /* déjà fermé */ }
  };

  req.on('close', terminer);
  req.on('aborted', terminer);
  res.on('error', terminer);
}

export default { liveEvents };
