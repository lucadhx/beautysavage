/**
 * LA GARDE DE DISPONIBILITÉ — une route métier ne répond que si elle le peut.
 *
 * ══ 503, ET SURTOUT PAS 401 ═════════════════════════════════════════════════
 *
 * C'est l'invariant central. Un service qui démarre n'a AUCUNE opinion sur la
 * validité d'une session : il n'a pas pu la vérifier. Répondre autre chose
 * qu'« indisponible » — ou laisser une erreur de base remonter en 500 — expose
 * le client à conclure que l'utilisateur n'est plus authentifié, et à détruire
 * une session parfaitement valide.
 *
 * ══ POURQUOI UN REFUS IMMÉDIAT VAUT MIEUX QU'UNE ATTENTE ════════════════════
 *
 * Sans cette garde, une requête arrivée pendant l'amorçage part en tampon chez
 * Mongoose, attend dix secondes, puis échoue sans rien expliquer. Avec elle,
 * l'appelant sait tout de suite qu'il doit réessayer.
 *
 * ══ CE QUI RESTE JOIGNABLE ══════════════════════════════════════════════════
 *
 * Les sondes, et elles seules. Les gater les rendrait indisponibles exactement
 * quand elles servent à diagnostiquer l'indisponibilité.
 */
import { isReady, unavailabilityReason } from '../services/lifecycle/readiness.service.js';

/**
 * `/health` figure ici avec les deux nouvelles sondes, et c'est un choix de
 * COMPATIBILITÉ : il est déjà interrogé par nginx et par l'étape de contrôle du
 * déploiement. Le gater changerait, sans prévenir, le sens d'une réponse dont
 * d'autres systèmes dépendent déjà. Sa sémantique reste donc celle qu'elle a
 * toujours eue — « ce process répond » — et c'est `/readyz` qui porte
 * désormais la question de l'aptitude réelle.
 */
const SONDES = ['/livez', '/readyz', '/health'];

function estUneSonde(url) {
  const chemin = String(url || '').split('?')[0];
  return SONDES.some((s) => chemin === s || chemin.startsWith(`${s}/`));
}

/**
 * Refuse proprement tant que le service n'est pas prêt.
 *
 * `Retry-After` n'est pas décoratif : il dit au client dans combien de temps
 * réessayer. Sans lui, chacun choisit sa cadence, et un backend qui démarre
 * reçoit une rafale au lieu d'un rythme.
 */
export function requireServiceReady(req, res, next) {
  if (isReady() || estUneSonde(req.originalUrl ?? req.url)) return next();

  const raison = unavailabilityReason();
  res.set('Retry-After', '2');
  res.set('Cache-Control', 'no-store');
  return res.status(503).json({
    success: false,
    message: raison.message,
    /**
     * LE CODE EST RENDU AUX DEUX ENDROITS, ET C'EST DÉLIBÉRÉ.
     *
     * `details.code` suit la forme du projet — c'est là que
     * `error.middleware.js` place déjà `DATABASE_UNAVAILABLE`.
     *
     * Le `code` de premier niveau, lui, est celui que le client HTTP du Manager
     * lit pour classer l'échec. Sans lui, sa règle de repli s'applique : tout
     * `503` sans code devient `BACKEND_INJOIGNABLE`, dont le message dit
     * « vérifiez qu'il est démarré ». L'opérateur redémarrerait un backend qui
     * est précisément en train de démarrer — le mauvais geste, suggéré au pire
     * moment.
     */
    code: raison.code,
    details: { code: raison.code, retryable: true, sessionValid: true },
  });
}

export default requireServiceReady;
