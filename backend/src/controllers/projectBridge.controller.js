/**
 * ProjectBridge — contrôleurs HTTP (couche fine : validation DTO + enveloppe).
 * Toute la logique vit dans services/projectBridge/projectBridge.service.js ;
 * les DTO et erreurs viennent du contrat exécutable
 * (services/panelBridge/bridgeContract.js). Spec :
 * docs/panelXvitrine/spec/ProjectBridge.openapi.yaml.
 */
import { bridgeError, BRIDGE_ERROR_CODES } from '../services/panelBridge/bridgeErrors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import {
  syncPushRequestSchema,
  operationInvocationSchema,
  parseOrThrow,
  nowIso,
} from '../services/panelBridge/bridgeContract.js';
import { isPaired } from '../services/panelBridge/pairingStore.js';
import { listProjectAccounts, summarizeAccounts } from '../services/accounts/projectAccounts.service.js';
import {
  getBridgeIdentity,
  getBridgeHealth,
  buildProjectManifest,
  acknowledgePanelChanges,
  readLocalChanges,
  getOperationCatalog,
  invokeOperation,
  notifyUnpair,
} from '../services/projectBridge/projectBridge.service.js';

/**
 * GET /ping — vivacité, sans auth.
 *
 * Contrat >= 1.4.0 : le ping annonce aussi l'IDENTITÉ NOMINALE du projet
 * (`projectKey`, `projectName`). Sans elle, un Panel qui découvre une adresse
 * ne peut pas savoir à quel projet il parle avant d'être appairé — `/identity`
 * exige un bridgeToken qui n'existe qu'APRÈS l'appairage — et il faudrait
 * ressaisir à la main une clé que le projet connaît déjà. Le projet reste donc
 * la source de vérité de sa propre identité.
 *
 * PÉRIMÈTRE ASSUMÉ : seuls la clé et le nom sortent ici. La composition du
 * projet (Manifest, santé, opérations) reste derrière l'appairage.
 */
export const ping = asyncHandler(async (req, res) => {
  const identity = await getBridgeIdentity({ withAppliedConfiguration: false });
  return ok(res, {
    status: 'ok',
    service: 'project-bridge',
    paired: isPaired(),
    projectKey: identity.projectKey,
    projectName: identity.projectName,
    time: nowIso(),
  });
});

/** GET /identity */
export const identity = asyncHandler(async (req, res) => ok(res, await getBridgeIdentity()));

/** GET /health */
export const health = asyncHandler(async (req, res) => ok(res, getBridgeHealth()));

/** GET /manifest — carte d'identité complète, jamais déduite (contrat ≥ 1.1.0). */
export const manifest = asyncHandler(async (req, res) => ok(res, await buildProjectManifest()));

/** POST /sync/push — livraison d'écritures faites côté Panel. */
export const syncPush = asyncHandler(async (req, res) => {
  const { changes } = parseOrThrow(syncPushRequestSchema, req.body, 'SyncPushRequest');
  return ok(res, await acknowledgePanelChanges(changes));
});

/**
 * GET /dead-letters — CE QUE CE PROJET A RENONCÉ À APPLIQUER (contrat 1.13.0).
 *
 * ── POURQUOI CETTE ROUTE EXISTE ─────────────────────────────────────
 *
 * Le battement déclare un COMPTE d'écritures garées : c'est ce qu'il faut pour
 * ALERTER, jamais pour AGIR. Un opérateur qui veut rejouer doit NOMMER
 * l'écriture, et seul ce projet sait laquelle il n'a pas su appliquer.
 *
 * ── CE QUI N'EN SORT JAMAIS ──────────────────────────────────────
 *
 * La charge utile. La lettre morte n'en conserve aucune — délibérément — et
 * cette route ne pourrait donc pas en rendre même si elle le voulait. Ce qui
 * sort : un type, un identifiant, un motif tronqué, des tentatives, des dates.
 *
 * LECTURE SEULE. La résolution d'une lettre morte n'est pas un geste qu'on
 * demande : elle survient quand l'écriture est enfin APPLIQUÉE.
 */
export const listDeadLetters = asyncHandler(async (req, res) => {
  const { deadLetters } = await import('../services/panelBridge/consumptionStore.js');
  return ok(res, { deadLetters: deadLetters() });
});

/** GET /sync/pull — lecture des écritures locales (rattrapage côté Panel). */
export const syncPull = asyncHandler(async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query.limit ?? '100'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  return ok(res, readLocalChanges({ cursor: req.query.cursor, limit }));
});

/** GET /operations — catalogue FERMÉ des opérations invocables. */
export const operations = asyncHandler(async (req, res) => ok(res, await getOperationCatalog()));

/** POST /operations/:operationId/invoke */
export const invoke = asyncHandler(async (req, res) => {
  const dto = parseOrThrow(operationInvocationSchema, req.body, 'OperationInvocation');
  return ok(res, await invokeOperation(req.params.operationId, dto));
});

/** POST /unpair — notification de révocation par le Panel. Idempotent. */
export const unpair = asyncHandler(async (req, res) => ok(res, await notifyUnpair()));

/**
 * `GET /api/project-bridge/v1/accounts` — LES COMPTES DE CE PROJET, POUR LE PANEL.
 *
 * ══ POURQUOI CETTE ROUTE EXISTE ═══════════════════════════════════════════
 *
 * Le Panel affichait « l'équipe du projet » depuis sa propre collection
 * `PanelProjectMember`, alimentée par le flux de synchronisation. C'était un
 * INSTANTANÉ : il vieillissait, il ne montrait que les comptes locaux, et il
 * décrivait les mêmes personnes avec d'autres champs que le Manager. Trois
 * défauts d'une même cause — une deuxième source de vérité.
 *
 * Cette route rend la lecture VIVANTE : le Panel demande, ce projet répond
 * avec l'état du moment, dans la représentation canonique que son propre
 * Manager utilise. Il n'y a plus de copie à faire vieillir.
 *
 * ══ LA PORTÉE VIENT DU JETON, ET DE RIEN D'AUTRE ══════════════════════════
 *
 * Aucun `projectId` dans le chemin, aucun dans le corps. Le seul projet dont
 * cette instance puisse parler est elle-même, et `requireBridgeAuth` l'a déjà
 * établi. Un paramètre de projet ferait croire qu'on peut en désigner un autre.
 *
 * ══ LECTURE SEULE, DÉFINITIVEMENT ═════════════════════════════════════════
 *
 * Il n'y aura jamais de POST ici. Les comptes locaux se gèrent dans ce
 * Manager, les identités L.Y Solution au Panel. Une écriture à distance
 * créerait exactement la divergence silencieuse que cette route supprime.
 */
export const accounts = asyncHandler(async (_req, res) => {
  const list = await listProjectAccounts();
  return ok(res, {
    accounts: list,
    summary: summarizeAccounts(list),
    /**
     * L'HEURE DE LA LECTURE, POSÉE PAR CELUI QUI FAIT AUTORITÉ.
     *
     * Le Panel l'affiche telle quelle. S'il la calculait lui-même, il daterait
     * sa propre requête — et en cas de réponse servie depuis un cache
     * intermédiaire, il affirmerait une fraîcheur qu'il n'a pas constatée.
     */
    readAt: new Date().toISOString(),
  });
});

/**
 * GET /contracts/:contractId/document — le PDF, pour le Panel.
 *
 * Le fichier ne transite JAMAIS par la synchronisation : la projection ne
 * porte que des métadonnées, et le Panel vient chercher le document ici,
 * authentifié par son jeton de pont, quand un humain le demande. Le stockage
 * reste privé : aucun chemin disque n'est exposé, et le contrat est relu
 * depuis la base plutôt que déduit de l'URL.
 */
export const contractDocument = asyncHandler(async (req, res) => {
  const { default: Contract } = await import('../models/Contract.model.js');
  const { streamDocument } = await import('../services/contractDocument.service.js');

  const contract = await Contract.findById(req.params.contractId);
  if (!contract || contract.archived) {
    throw bridgeError(BRIDGE_ERROR_CODES.OPERATION_FAILED, 'Contrat introuvable.');
  }
  // Le signé prime : c'est lui qui fait foi dès qu'il existe.
  const kind = contract.document?.signedFilename ? 'signed' : 'original';
  return streamDocument(res, contract, kind);
});
