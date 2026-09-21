/**
 * ProjectBridge — la surface HTTP exposée AU Panel, montée sous
 * /api/project-bridge/v1 (routes/index.js).
 *
 * C'est le SEUL contrat que le Panel connaît de ce projet
 * (docs/panelXvitrine/02_PROJECT_CONNECTOR.md ; spec :
 * docs/panelXvitrine/spec/ProjectBridge.openapi.yaml).
 *
 * Chaîne de gardes (l'ordre est contractuel) :
 *   1. bridgeContractVersionGuard — sur TOUT le routeur (ping compris) ;
 *   2. /ping                      — public (vivacité) ;
 *   3. /unpair                    — auth SEULE (spec : 200/401, jamais 503 —
 *      un projet non appairé répond 401, la révocation reste idempotente) ;
 *   4. tout le reste              — appairage requis (503 BRIDGE_NOT_PAIRED)
 *      PUIS auth Bearer (401 BRIDGE_UNAUTHORIZED).
 *
 * Auth totalement disjointe des comptes DEV/ADMIN du Manager.
 */
import { Router } from 'express';
import {
  bridgeContractVersionGuard,
  requireBridgePairing,
  requireBridgeAuth,
} from '../middlewares/projectBridgeAuth.middleware.js';
import {
  ping,
  identity,
  health,
  manifest,
  syncPush,
  listDeadLetters,
  syncPull,
  contractDocument,
  operations,
  invoke,
  unpair,
  accounts,
} from '../controllers/projectBridge.controller.js';

const router = Router();

router.use(bridgeContractVersionGuard);

router.get('/ping', ping);

router.post('/unpair', requireBridgeAuth, unpair);

router.use(requireBridgePairing, requireBridgeAuth);
router.get('/identity', identity);
router.get('/health', health);
router.get('/manifest', manifest);
/**
 * LES COMPTES — lecture seule, portée par le jeton d'appairage.
 *
 * Montée avec les autres lectures du pont, derrière `requireBridgePairing` et
 * `requireBridgeAuth` : un projet non appairé ne divulgue pas qui travaille
 * dessus, et un appelant sans jeton non plus.
 */
router.get('/accounts', accounts);
router.post('/sync/push', syncPush);

/**
 * LES ÉCRITURES GARÉES — lecture seule (contrat 1.13.0).
 *
 * Le Panel voit un COMPTE au battement ; pour rejouer, il lui faut NOMMER
 * l'écriture. Aucune charge utile ne sort d'ici : un type, un identifiant, un
 * motif tronqué, des tentatives, des dates.
 */
router.get('/dead-letters', listDeadLetters);
router.get('/sync/pull', syncPull);
router.get('/operations', operations);
router.post('/operations/:operationId/invoke', invoke);
// Le document contractuel se RÉCUPÈRE ici — il ne voyage jamais dans la file.
router.get('/contracts/:contractId/document', contractDocument);

export default router;
