/**
 * Gardes HTTP du ProjectBridge — spec docs/panelXvitrine/spec/ProjectBridge.openapi.yaml.
 *
 * Trois middlewares, composés dans routes/projectBridge.routes.js :
 *
 *   bridgeContractVersionGuard  — l'en-tête X-Bridge-Contract-Version est
 *       OBLIGATOIRE sur toutes les routes du pont ; majeure incompatible ->
 *       409 BRIDGE_CONTRACT_VERSION_UNSUPPORTED. Pose aussi l'en-tête de
 *       réponse (les deux côtés annoncent toujours leur version).
 *
 *   requireBridgePairing        — projet non appairé -> 503 BRIDGE_NOT_PAIRED
 *       (état NORMAL de première classe : Standalone, pas une panne).
 *
 *   requireBridgeAuth           — Bearer vérifié en temps constant contre le
 *       secret d'appairage partagé. Absent/invalide (ou pas d'appairage du
 *       tout, pour les routes qui ne passent pas par requireBridgePairing,
 *       comme /unpair) -> 401 BRIDGE_UNAUTHORIZED.
 *
 * L'authentification du pont est TOTALEMENT disjointe de l'auth utilisateur
 * du Manager (JWT DEV/ADMIN) : un Panel n'est pas un utilisateur.
 */
import {
  CONTRACT_VERSION,
  CONTRACT_VERSION_HEADER,
  isContractCompatible,
} from '../services/panelBridge/bridgeContract.js';
import { bridgeError, BRIDGE_ERROR_CODES } from '../services/panelBridge/bridgeErrors.js';
import { isPaired, verifyIncomingBridgeToken } from '../services/panelBridge/pairingStore.js';

export function bridgeContractVersionGuard(req, res, next) {
  res.setHeader(CONTRACT_VERSION_HEADER, CONTRACT_VERSION);
  const requested = req.get(CONTRACT_VERSION_HEADER);
  if (!isContractCompatible(requested)) {
    return next(
      bridgeError(
        BRIDGE_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
        `Version majeure du contrat non supportée (reçu : ${requested ?? 'aucune'}, attendu : ${CONTRACT_VERSION}).`
      )
    );
  }
  return next();
}

export function requireBridgePairing(req, res, next) {
  if (!isPaired()) return next(bridgeError(BRIDGE_ERROR_CODES.NOT_PAIRED));
  return next();
}

export function requireBridgeAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!verifyIncomingBridgeToken(token)) {
    return next(bridgeError(BRIDGE_ERROR_CODES.UNAUTHORIZED));
  }
  return next();
}
