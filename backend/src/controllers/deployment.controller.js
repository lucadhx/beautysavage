/**
 * Contrôleur HTTP du moteur de déploiement (DEV uniquement).
 *
 * Rôle STRICT : traduire HTTP <-> moteur. Aucune logique métier ici — tout est
 * délégué à DeploymentEngine + deploymentTarget.service. Les erreurs typées du
 * moteur (DeploymentError) sont converties en ApiError avec un code stable.
 *
 * Le mot de passe VPS n'est jamais persisté : il n'entre que par
 * POST /vps-session (coffre-fort RAM) et ressort sous forme de sessionId opaque.
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { ok, created } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { DeploymentError, PreflightError, ValidationError } from '../deployment-engine/errors.js';
// Le PLAN du retrait — annoncé à l'interface avant la première commande.
import { DEPROVISION_STEPS, DESTINATION_DELETE_STEPS } from '../deployment-engine/deprovision.js';
import * as vault from '../deployment-engine/passwordVault.js';
import { SshTransport } from '../deployment-engine/transport/SshTransport.js';
import { buildRemoteEnv, describeRemoteEnv } from '../deployment-engine/deployEnv.js';
import { syncRuntimeNetworkConfiguration } from '../deployment-engine/runtimeConfig.js';
import { beginControlPlaneDeployment, finalizeControlPlaneDeployment } from '../services/controlPlane/deployHooks.js';
import * as targets from '../services/deploymentTarget.service.js';
import * as ports from '../services/deployment/portRegistry.service.js';
import { pm2AppName } from '../deployment-engine/pm2.js';
import * as lifecycle from '../services/deployment/destinationLifecycle.service.js';
import * as runs from '../services/deploymentRun.service.js';
import * as identity from '../services/projectIdentity.service.js';
import { diagnoseDnsAutomation } from '../integrations/hostinger/dnsControlPlaneDiagnostic.js';
import { resolveDnsProvider } from '../integrations/hostinger/dnsProviderResolution.js';
import { invokeCapability, capabilitiesAvailable } from '../services/panelBridge/capabilityClient.js';
import { nowStamp } from '../scripts/lib/promotion-core.js';
import { createStepJournal, recordStep } from '../services/deployment/forensics/runSteps.service.js';

/**
 * ══ CLORE UN RUN, OU DIRE QU'ON N'A PAS PU ══════════════════════════════════
 *
 * `finalizeRun` est l'écriture qui ferme le run : sans elle, il reste `running`
 * jusqu'à ce qu'un redémarrage le reprenne, et l'écran de l'utilisateur affiche
 * une opération éternelle. Elle était appelée en `.catch(() => null)` dans SIX
 * chemins (retrait, suppression, déploiement) : son échec ne laissait donc
 * aucune trace, nulle part — ni en base, puisqu'elle avait échoué, ni au flux,
 * puisqu'il ne le disait pas.
 *
 * L'échec ne fait toujours RIEN échouer — l'opération distante est terminée et
 * l'annuler pour un défaut d'écriture serait absurde. Il devient simplement
 * visible : rend `false`, et l'appelant l'annonce.
 */
async function cloreRun(runId, patch, write) {
  try {
    return { ok: true, run: await runs.finalizeRun(runId, patch) };
  } catch (err) {
    write?.({
      type: 'run.not_persisted',
      runId,
      code: 'DEPLOYMENT_REPORT_NOT_PERSISTED',
      message: 'L’opération est terminée, mais son rapport n’a pas pu être enregistré : '
        + `${String(err?.message || 'écriture refusée').slice(0, 200)}. Fiez-vous à cet écran.`,
    });
    return { ok: false, run: null };
  }
}
import { verifyFinalization } from '../services/deployment/forensics/finalization.service.js';
import { clearActiveRun, setActiveRun } from '../services/deployment/forensics/processGuard.js';
import { EVENTS, LEVELS, SOURCES, journal } from '../services/deployment/forensics/runJournal.service.js';
import { journalPm2After, journalPm2Before } from '../services/deployment/forensics/pm2Trace.js';
import { ecrireMarqueurReprise, effacerMarqueurReprise } from '../services/deployment/forensics/restartMarker.service.js';
import * as forensics from '../services/deployment/forensics/restartForensics.js';

const engine = new DeploymentEngine();
const TRANSPORT_REEL = engine.transportFactory;

/**
 * REMPLACE LA FABRIQUE DE TRANSPORT DU MOTEUR — même patron que `FakeTransport`.
 *
 * ── POURQUOI CETTE COUTURE EXISTE ───────────────────────────────────────────
 * Le moteur accepte déjà un `transportFactory` injecté ; ce contrôleur, lui,
 * construisait le sien en dur, ce qui rendait ses flux invérifiables sans VPS.
 * L'incident du retrait est passé exactement là : entre le clic et le moteur,
 * dans un chemin qu'aucun test ne traversait.
 *
 * Elle ne change RIEN en production — sans appel, le transport reste SSH.
 * Passer `null` rétablit le transport réel.
 */
export function useDeploymentTransportFactory(factory) {
  engine.transportFactory = factory ?? TRANSPORT_REEL;
}

/** Convertit une erreur du moteur en ApiError HTTP appropriée. */
function toApiError(err) {
  if (err instanceof PreflightError) {
    return ApiError.badRequest('Préflight en échec — déploiement refusé.', {
      code: err.code,
      failedChecks: err.failedChecks,
    });
  }
  if (err instanceof ValidationError) {
    return ApiError.badRequest(err.message, { code: err.code });
  }
  if (err instanceof DeploymentError) {
    return ApiError.badRequest(err.message, { code: err.code, step: err.step, ...(err.details || {}) });
  }
  return err;
}

/**
 * CE QUI A ÉCHOUÉ DANS UNE CONNEXION SSH — nommé, jamais résumé.
 *
 * ══ POURQUOI CETTE FONCTION EXISTE ══════════════════════════════════════════
 *
 * Un opérateur voyait « Connexion au serveur impossible — vérifiez l'adresse,
 * l'utilisateur et le mot de passe » quelle que soit la panne. Il vérifiait
 * donc ses identifiants, qui étaient bons, réessayait, et finissait par
 * réussir. Le message ne décrivait alors ni ce qui s'était passé, ni ce qu'il
 * fallait faire — et rendait la panne « aléatoire » alors qu'elle ne l'était
 * pas : un délai de poignée de main dépassé et un mot de passe faux ne sont
 * pas la même chose, et se réessayer n'a de sens que pour l'un des deux.
 *
 * ══ LES CINQ VERDICTS ═══════════════════════════════════════════════════════
 *
 *   SSH_AUTH_FAILED          identifiants refusés — réessayer ne sert à rien
 *   SSH_TIMEOUT              pas de réponse à temps — réessayer a du sens
 *   SSH_CONNECTION_REFUSED   la machine répond, rien n'écoute sur le port
 *   SSH_HOST_UNREACHABLE     nom introuvable ou route absente
 *   SSH_ERROR                autre chose, et on le dit plutôt que d'inventer
 *
 * Aucun ne parle du BACKEND : celui-ci vient précisément de répondre.
 */
export function classerEchecSsh(err, transportIssue = null) {
  const brut = `${err?.code ?? ''} ${err?.message ?? ''}`;
  const message = String(err?.message ?? '');

  if (/All configured authentication methods failed|Authentication failure|permission denied/i.test(brut)) {
    return {
      code: 'SSH_AUTH_FAILED',
      message: 'Le serveur a refusé ces identifiants. Vérifiez l’utilisateur et le mot de passe : '
        + 'réessayer à l’identique donnera le même refus.',
    };
  }
  if (/ECONNREFUSED|Connection refused/i.test(brut)) {
    return {
      code: 'SSH_CONNECTION_REFUSED',
      message: 'La machine répond, mais rien n’écoute sur le port SSH. '
        + 'Le service SSH est-il démarré, et le port est-il le bon ?',
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|getaddrinfo/i.test(brut)) {
    return {
      code: 'SSH_HOST_UNREACHABLE',
      message: 'Cette adresse ne mène à aucune machine joignable : nom introuvable ou route absente. '
        + 'Vérifiez l’adresse du serveur.',
    };
  }
  if (transportIssue === 'SSH_TIMEOUT'
      || /ETIMEDOUT|Timeout|Délai de connexion SSH dépassé|Timeout de commande distante/i.test(brut)) {
    return {
      code: 'SSH_TIMEOUT',
      message: 'Le serveur n’a pas terminé la négociation SSH dans le délai imparti. '
        + 'Ce n’est pas un refus : la machine est lente, chargée ou filtrée. Réessayer a du sens.',
    };
  }
  if (transportIssue === 'SSH_CLOSED' || transportIssue === 'SSH_ENDED') {
    return {
      code: 'SSH_TIMEOUT',
      message: 'Le serveur a coupé la connexion avant la fin de la négociation SSH. '
        + 'Vos identifiants n’ont pas été mis en cause. Réessayer a du sens.',
    };
  }
  return {
    code: 'SSH_ERROR',
    message: `Connexion SSH impossible : ${message || 'le serveur n’a pas répondu.'}`,
  };
}

/**
 * PRÉREQUIS LOCAUX — évalués sur la machine qui pilote, AVANT tout effet de bord.
 *
 * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
 * `checkLocalPrerequisites` existait dans le moteur mais n'était appelé NULLE
 * PART ici : le contrôle de source Git n'intervenait qu'à `artifact.build`,
 * via `requireCleanSource`. Un dépôt non commité en production laissait donc
 * créer un DeploymentRun, sa checklist, marquer la cible « en cours », ouvrir
 * la session SSH, faire tourner le préflight serveur et les phases DNS — puis
 * échouait sur DEPLOY_SOURCE_DIRTY, en laissant derrière lui un rapport
 * persisté d'un déploiement qui n'aurait jamais dû commencer.
 *
 * Ce contrôle est local et instantané : il n'a aucune raison d'attendre.
 *
 * @returns {ApiError|null} l'erreur à opposer, ou `null` si tout est en ordre.
 */
async function localPrerequisitesFailure(env) {
  const local = await engine.checkLocalPrerequisites({ env });
  if (local.ok) return null;

  /**
   * LE REFUS NOMME LE CONTRÔLE QUI A ÉCHOUÉ — il ne le suppose plus.
   *
   * Le message était figé sur « Source Git non commitée », seul prérequis local
   * existant à l'époque. Depuis que la PRÉSENCE DES SOURCES en est un second,
   * cette phrase pouvait mentir : une machine sans les sources du projet se
   * voyait reprocher un dépôt non commité, et l'opérateur cherchait un `git
   * commit` là où il n'y avait rien à committer.
   */
  const fautif = local.failedChecks[0] ?? null;
  // `summary` nomme le PROBLÈME (« Source Git non commitée ») ; `label` nomme le
  // CONTRÔLE (« Source Git commitée »). Composer le refus à partir du second
  // annoncerait à l'opérateur l'inverse de ce qui s'est produit.
  const motif = fautif?.summary ?? fautif?.label ?? 'Prérequis local non satisfait';

  return ApiError.badRequest(`Impossible de lancer le déploiement : ${motif}.`, {
    code: 'PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED',
    scope: 'local',
    pipelineExecuted: false,
    checks: local.checks,
    failedChecks: local.failedChecks,
    // Le détail du contrôle fautif porte la cause réelle (fichiers non
    // commités, ou fichiers absents et racine inspectée).
    detail: fautif?.detail ?? null,
    projectRoot: local.projectRoot ?? null,
    files: fautif?.files ?? [],
  });
}

/* ------------------------------- Version -------------------------------- */

export const getVersion = asyncHandler(async (req, res) => {
  const version = await engine.getVersion();
  return ok(res, { version });
});

/* --------------------------- Sessions VPS (RAM) -------------------------- */

/** POST /deployment/vps-session — ouvre une session VPS en mémoire. */
export const openVpsSession = asyncHandler(async (req, res) => {
  const { host, username, password } = req.body;

  /**
   * ══ « CONNECTÉ » DOIT ÊTRE UNE PREUVE, PAS UNE ÉCRITURE EN MÉMOIRE ═══════
   *
   * Cette route se contentait de ranger les identifiants dans une Map et de
   * rendre un identifiant. Aucune connexion n'était tentée. L'écran affichait
   * pourtant « Connecté au serveur » — une affirmation qui ne reposait sur
   * rien : elle restait vraie avec un mot de passe faux, un hôte éteint, ou un
   * nom d'utilisateur inexistant.
   *
   * L'erreur n'apparaissait qu'au premier usage réel, plusieurs écrans plus
   * loin, sous une forme qui ne désignait plus la cause. On authentifie donc
   * ICI, et l'on ne rend une session que si le serveur a réellement répondu.
   *
   * La commande est la plus inoffensive qui soit : elle ne lit rien, ne
   * modifie rien, et prouve seulement qu'un canal exécutable est ouvert.
   */
  /**
   * L'ISSUE DE LA SONDE EST NOMMÉE — le transport la distingue déjà.
   *
   * `SshTransport` publie `SSH_TIMEOUT`, `SSH_CLOSED`, `SSH_ENDED`,
   * `SSH_ERROR` : quatre pannes qui demandent quatre enquêtes différentes. Ce
   * contrôleur les écrasait toutes sous un unique `VPS_CONNECTION_FAILED`
   * « vérifiez l'adresse, l'utilisateur et le mot de passe » — un conseil
   * faux dans trois cas sur quatre, et impossible à distinguer d'un backend
   * hors ligne côté écran.
   *
   * On relève donc l'issue réelle, sans jamais laisser fuir le secret.
   */
  /**
   * ══ LA TRACE FORENSIQUE S'ARME ICI, ET TOUTE SEULE ═══════════════════════
   *
   * C'est le point d'entrée EXACT du clic « Suivant » de l'étape « Connexion au
   * serveur » (`DeployAssistant.next()` → `connect()` → `openVpsSession`), et
   * c'est l'instant où le backend redémarrait sous `node --watch`.
   *
   * Elle n'OBSERVE que : surveillance du code source, appels de l'étape, fin de
   * process. Elle ne modifie ni la connexion, ni le coffre, ni la réponse — et
   * se désarme d'elle-même, quelle que soit l'issue.
   */
  forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
  /**
   * La requête QUI ARME est notée ici, et non par le middleware : celui-ci
   * s'exécute avant elle, quand la trace n'existe pas encore. Sans cette ligne,
   * la console montrerait `httpCalls=0` sur l'appel même qui a tout déclenché.
   */
  forensics.noterHttp(req.method, req.originalUrl ?? req.url);
  forensics.noterSsh('probe start', { host, username });

  let issueSonde = null;
  const sonde = engine.transportFactory
    ? engine.transportFactory({ host, username, password })
    : new SshTransport({
      host,
      username,
      password,
      observer: (fait) => { if (fait?.eventCode?.startsWith('SSH_')) issueSonde = fait.eventCode; },
    });
  try {
    await sonde.exec('true', { timeoutMs: 20_000 });
  } catch (err) {
    const verdict = classerEchecSsh(err, issueSonde);
    forensics.noterSsh('probe failed', { host, username, code: verdict.code });
    /**
     * DÉSARMEMENT DIFFÉRÉ (V2) — le run réel s'est interrompu JUSTE après ici.
     *
     * La V1 refermait la trace à cet instant précis, c'est-à-dire possiblement
     * quelques millisecondes AVANT le redémarrage qu'elle cherchait. On garde
     * le désarmement — 25 secondes de surveillance permanente seraient du bruit
     * — mais on laisse un court répit pendant lequel l'observation vit encore.
     */
    forensics.planifierDesarmement('SSH_REFUSED');
    throw ApiError.badRequest(verdict.message, {
      code: verdict.code,
      /** Le mot exact du transport — pour le diagnostic, jamais pour l'écran. */
      transportIssue: issueSonde,
      host,
      username,
    });
  } finally {
    // La sonde ne sert qu'à prouver. Le transport d'exécution est reconstruit
    // depuis la session, comme pour toute autre opération.
    await sonde.close?.().catch(() => {});
  }

  const session = vault.openSession({ host, username, password });
  forensics.noterSsh('probe ok', { host, username });
  /**
   * La connexion a abouti : l'observation n'a plus d'objet — mais on ne referme
   * pas dans la même milliseconde. Voir `planifierDesarmement` : c'est
   * exactement après cette étape que le backend s'est interrompu.
   */
  forensics.planifierDesarmement('CONNECTED');
  // On ne renvoie JAMAIS le mot de passe. Seul l'identifiant opaque + méta.
  return created(res, { sessionId: session.sessionId, expiresAt: session.expiresAt });
});

/** GET /deployment/vps-session/:sessionId — métadonnées (jamais le secret). */
export const describeVpsSession = asyncHandler(async (req, res) => {
  const info = vault.describeSession(req.params.sessionId);
  if (!info) {
    throw ApiError.notFound(
      'La session serveur a expiré. Reconnectez-vous au serveur pour continuer.',
      { code: 'SESSION_EXPIRED' },
    );
  }
  return ok(res, info);
});

/** DELETE /deployment/vps-session/:sessionId — détruit la session (efface la RAM). */
export const closeVpsSession = asyncHandler(async (req, res) => {
  vault.closeSession(req.params.sessionId);
  return ok(res, { closed: true });
});

/* -------------------------------- Cibles -------------------------------- */

export const listTargets = asyncHandler(async (req, res) => ok(res, await targets.listTargets()));

export const createTarget = asyncHandler(async (req, res) => {
  try {
    const t = await targets.createTarget(req.body);
    return created(res, t);
  } catch (err) {
    throw toApiError(err);
  }
});

/**
 * SUPPRESSION D'UNE FICHE — jamais d'une destination en place.
 *
 * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
 * Un `confirm()` du navigateur puis `deleteOne()` : la fiche disparaissait,
 * le serveur gardait le service PM2 (qui détenait toujours son port), la
 * configuration Nginx et les fichiers. Plus rien ne disait qu'il restait
 * quelque chose à nettoyer.
 *
 * Le nom d'hôte saisi doit être EXACT : c'est le seul contrôle qui distingue
 * « je veux supprimer CETTE destination » de « j'ai cliqué sur la mauvaise
 * ligne ». Une case à cocher ne fait pas cette distinction.
 */
export const deleteTarget = asyncHandler(async (req, res) => {
  const target = await targets.getTargetOr404(req.params.id);
  assertHostnameConfirmed(req.body?.confirmHostname, target,
    'Suppression refusée parce que le nom d’hôte saisi ne correspond pas.');
  return ok(res, await targets.deleteTarget(req.params.id, { actor: req.user?.email ?? null }));
});

/** Le nom d'hôte saisi doit être EXACT — comparaison insensible à la casse seule. */
function assertHostnameConfirmed(saisi, target, message) {
  if (String(saisi ?? '').trim().toLowerCase() !== String(target.host).toLowerCase()) {
    throw ApiError.badRequest(`${message} Attendu : « ${target.host} ».`, { expected: target.host });
  }
}

/**
 * INVENTAIRE RÉEL DU SERVEUR — avant toute confirmation de retrait.
 *
 * On ne fait pas confirmer une destruction sans montrer ce qui sera détruit :
 * sinon l'opérateur ne confirme pas un retrait, il valide une phrase.
 */
export const inspectTarget = asyncHandler(async (req, res) => {
  const target = await targets.getTargetOr404(req.params.id);
  const { sessionId } = req.body;
  if (!sessionId) {
    throw ApiError.badRequest('Session serveur requise pour lire l’état réel.', { code: 'SESSION_REQUIRED' });
  }
  /**
   * UNE SESSION EXPIRÉE SE DIT AVANT D'ÊTRE UTILISÉE.
   *
   * Sans ce contrôle, l'expiration ressortait au fond du moteur sous la forme
   * d'un échec SSH — et l'écran concluait « serveur injoignable » alors que la
   * seule chose à faire était de se reconnecter.
   */
  if (!vault.describeSession(sessionId)) {
    throw ApiError.badRequest(
      'La session serveur a expiré. Reconnectez-vous au serveur, puis relancez l’inventaire.',
      { code: 'SESSION_EXPIRED' },
    );
  }
  try {
    const inventory = await engine.inspectDestination({
      url: target.url,
      sessionId,
      options: { remoteRoot: target.remoteRoot, backendPort: target.backendPort },
    });
    return ok(res, {
      target: targets.serializeTarget(target),
      inventory,
      // Ce que le retrait EXIGERA avant d'accepter. Annoncé maintenant : une
      // confirmation refusée après coup pour une raison qu'on connaissait
      // déjà est une perte de temps et une perte de confiance.
      requiresPersistentDataConfirmation: (inventory.persistentFiles ?? 0) > 0,
      blockedBySymlinks: (inventory.outboundSymlinks ?? []).length > 0,
    });
  } catch (err) {
    /**
     * UN INVENTAIRE RATÉ N'EST PAS UN BACKEND HORS LIGNE.
     *
     * Ce contrôleur vient de répondre : le backend va bien. Ce qui a échoué,
     * c'est la lecture DU SERVEUR DISTANT — et il faut le dire, sinon
     * l'opérateur redémarre le mauvais service.
     */
    const converti = toApiError(err);
    if (converti?.details?.code) throw converti;
    const verdict = classerEchecSsh(err);
    throw ApiError.badRequest(
      `Inventaire du serveur impossible. ${verdict.message}`,
      { code: 'INSPECTION_FAILED', cause: verdict.code },
    );
  }
});

/**
 * RETRAIT D'UN DÉPLOIEMENT — l'opération inverse du déploiement.
 *
 * Arrête et supprime le service, libère le port, retire le routage, installe
 * une quarantaine 410 sur le domaine, supprime les fichiers, puis vérifie
 * qu'il ne reste rien. La fiche subsiste : elle passe à l'état « vidée ».
 *
 * Flux NDJSON, comme un déploiement : c'est la même mécanique de rapport, et
 * la seule opération qui DÉTRUIT mérite au moins autant de traçabilité.
 */
export async function deprovisionStream(req, res) {
  /**
   * MÊME CEINTURE QUE LE DÉPLOIEMENT — voir `fluxProtege`.
   *
   * Elle protégeait `deployStream` et `precheckStream`, pas celui-ci. C'est
   * exactement par là que l'incident est passé : une `ValidationError` de
   * Mongoose levée APRÈS l'envoi des en-têtes NDJSON devient un rejet non
   * géré, et le flux reste ouvert sans qu'aucune ligne n'y soit jamais
   * écrite. L'opérateur voit sa checklist et attend indéfiniment.
   *
   * Aucune exception ne doit pouvoir laisser un retrait muet.
   */
  try {
    return await deprovisionFlux(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[deploiement] DEPROVISION interrompu par une erreur serveur : ${err.stack ?? err.message}`);
    void journal(null, {
      source: SOURCES.HTTP,
      level: LEVELS.ERROR,
      eventCode: EVENTS.HTTP_REQUEST_FAILED,
      message: `Erreur serveur pendant DEPROVISION : ${err.message}`,
      error: err,
      details: { headersSent: res.headersSent, operationType: 'DEPROVISION' },
    });
    if (!res.headersSent) {
      return res.status(500).json({
        code: 'DEPROVISION_STREAM_FAILED',
        message: 'Le retrait n’a pas pu être lancé. Rien n’a été retiré du serveur.',
      });
    }
    if (!res.writableEnded) {
      try {
        res.write(`${JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'deprovision.failed',
          code: 'DEPROVISION_STREAM_FAILED',
          message: 'Le retrait a été interrompu par une erreur serveur : '
            + `${err.message}. Le rapport technique en conserve le détail.`,
        })}\n`);
      } catch { /* le client est déjà parti */ }
      res.end();
    }
    return undefined;
  }
}

async function deprovisionFlux(req, res) {
  const { targetId, sessionId, removePersistentData } = req.body;

  let target;
  try {
    target = await targets.getTargetOr404(targetId);
  } catch (err) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode || 400).json({ success: false, message: apiErr.message });
  }

  try {
    assertHostnameConfirmed(req.body?.confirmHostname, target,
      'Retrait refusé parce que le nom d’hôte saisi ne correspond pas.');
    lifecycle.assertDeprovisionable(target);
    // Une opération sur A ne doit jamais pouvoir couper B : le port est le seul
    // identifiant qui ne se dérive pas de l'hôte, donc le seul partageable.
    lifecycle.assertOperationIsolated(target, await targets.listTargets());
  } catch (err) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode || 400).json({ success: false, message: apiErr.message });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  req.on('close', () => { clientGone = true; });
  let seq = 0;
  const write = (obj) => {
    if (clientGone) return;
    try {
      res.write(`${JSON.stringify({ sequenceNumber: ++seq, timestamp: new Date().toISOString(), ...obj })}\n`);
      res.flush?.();
    } catch { clientGone = true; }
  };

  /**
   * LE PLAN PART AVANT LE PREMIER TRAVAIL.
   *
   * L'interface n'apprenait l'existence d'une étape qu'au moment où celle-ci
   * commençait. Entre le clic et la première commande distante — création du
   * run, verrou de la fiche, réservation du port — il s'écoulait donc un
   * temps pendant lequel l'écran ne recevait rien du tout, et pendant lequel
   * l'incident, précisément, tuait le flux.
   *
   * On annonce donc d'abord ce qui va se passer. Une opération qui détruit ne
   * doit jamais laisser croire qu'elle n'a pas démarré.
   */
  const debutRetrait = Date.now();
  write({
    type: 'deprovision.started',
    operationType: 'DEPROVISION',
    target: { id: String(target._id), name: target.name, host: target.host, url: target.url },
    steps: DEPROVISION_STEPS,
  });

  const run = await runs.createRun({ target, user: req.user?.email, version: null, operationType: 'DEPROVISION' });
  const runId = String(run._id);
  write({ type: 'deprovision.run', runId, startedAt: run.startedAt });

  /** Les étapes RÉELLES, telles que le moteur les rapporte — pour le rapport. */
  const etapes = [];
  const noterEtape = (evt) => {
    if (!evt?.step) return;
    const existante = etapes.find((e) => e.id === evt.step);
    const ligne = {
      id: evt.step,
      label: evt.label ?? evt.step,
      order: existante?.order ?? etapes.length,
      status: evt.status ?? 'running',
      durationMs: evt.durationMs ?? null,
      technicalMessage: evt.error?.message ?? null,
      errorCode: evt.error?.code ?? null,
      critical: true,
      warnings: [],
    };
    if (existante) Object.assign(existante, ligne);
    else etapes.push(ligne);
  };

  // LE VERROU — atomique et conditionnel. Posé AVANT le moteur : si deux
  // retraits partent en même temps, le second ne trouve plus de fiche
  // correspondant à sa condition et est refusé ici, pas sur le serveur.
  try {
    await lifecycle.beginDeprovision(String(target._id), { runId });
  } catch (err) {
    // Le run existe déjà : le laisser « en cours » ferait croire à un retrait
    // qui tourne encore alors qu'il n'a jamais commencé.
    const refus = toApiError(err);
    await cloreRun(runId, {
      ok: false, status: 'error', finalStepId: 'deprovision.lock', steps: [],
      errorSummary: { code: refus.details?.code ?? 'DEPROVISION_LOCK_REFUSED', message: refus.message },
    }, write);
    write({ type: 'deprovision.failed', runId, failedStep: 'deprovision.lock', message: refus.message });
    return res.end();
  }

  // Le port entre en LIBÉRATION dès le début — il reste RETENU. Entre l'arrêt
  // du service et la preuve que le port est libre, le déclarer disponible
  // serait un mensonge.
  await ports.beginRelease(String(target._id)).catch(() => null);

  // Les racines des AUTRES destinations sont protégées explicitement : même
  // une fiche incohérente ne peut pas désigner le dossier d'un autre projet.
  const autres = await targets.listTargets();
  const protectedPaths = autres
    .filter((t) => t.id !== String(target._id))
    .map((t) => `${t.remoteRoot ?? '/var/www'}/${t.host}`);

  let result;
  try {
    result = await engine.deprovision({
      url: target.url,
      sessionId,
      options: {
        remoteRoot: target.remoteRoot,
        backendPort: target.backendPort,
        removePersistentData: removePersistentData === true,
        protectedPaths,
      },
      onStep: (evt) => { noterEtape(evt); write({ type: 'step', ...evt }); },
    });
  } catch (err) {
    result = { ok: false, failedStep: 'deprovision.lock', error: { message: toApiError(err).message } };
  }

  if (!result.ok) {
    await lifecycle.markDeprovisionFailed(String(target._id), {
      runId,
      error: {
        code: result.error?.code ?? 'DEPROVISION_FAILED',
        message: result.error?.message ?? 'Échec du retrait.',
        step: result.failedStep ?? null,
      },
    });
    const rapportEchec = rapportDeRetrait({
      target, runId, etapes, result, debutRetrait, removePersistentData,
    });
    await cloreRun(runId, {
      ok: false,
      status: 'error',
      finalStepId: result.failedStep ?? null,
      steps: etapes,
      structuredReport: rapportEchec,
      errorSummary: {
        code: result.error?.code ?? 'DEPROVISION_FAILED',
        message: result.error?.message ?? 'Échec du retrait.',
      },
    }, write);
    write({
      type: 'deprovision.failed',
      runId,
      code: result.error?.code ?? 'DEPROVISION_FAILED',
      failedStep: result.failedStep ?? null,
      report: rapportEchec,
      message: `Retrait interrompu à l’étape « ${result.failedStep ?? 'inconnue'} » : `
        + `${result.error?.message ?? 'échec.'} La destination reste connue — rien n’a été supprimé de sa fiche.`,
    });
    return res.end();
  }

  await lifecycle.markEmpty(String(target._id), { runId, quarantine: true });

  /**
   * LE PORT EST RENDU — parce qu'il a été CONSTATÉ libre. L'étape
   * `deprovision.port.release` du moteur interroge les sockets réelles et
   * échoue si le port est encore détenu ; un retrait réussi vaut donc preuve.
   */
  await ports.releasePort(String(target._id), { verifiedFree: true }).catch(() => null);

  /**
   * LES MÉDIAS REDEVIENNENT LOCAUX — la destination ne les sert plus.
   *
   * Un média laissé `PUBLISHED` sur un hôte qu'on vient de vider affirmerait
   * une présence constatée sur un serveur dont les fichiers ont été effacés.
   */
  const { unpublishProjectMediaOfDestination } = await import('../services/media/projectMedia.service.js');
  const depub = await unpublishProjectMediaOfDestination({
    host: target.host, environment: target.environment,
  }).catch(() => ({ unpublished: 0 }));

  const inv = result.inventory ?? {};
  /**
   * LE RAPPORT VIENT DU RUN, PAS DE L'ÉCRAN.
   *
   * Il était reconstruit par le navigateur à partir des étapes qu'il avait vu
   * passer : ce qu'il montrait n'était donc que ce qu'il avait reçu, et un
   * rechargement effaçait tout. Le rapport est désormais produit ici, persisté
   * avec le run, ET envoyé dans l'évènement terminal — le même objet des deux
   * côtés, consultable après coup.
   */
  const rapport = rapportDeRetrait({
    target, runId, etapes, result, debutRetrait, removePersistentData,
    unpublishedMedia: depub.unpublished,
  });
  await cloreRun(runId, {
    ok: true, status: 'ok',
    finalStepId: 'deprovision.finalize',
    steps: etapes,
    structuredReport: rapport,
  }, write);
  write({
    type: 'deprovision.succeeded',
    runId,
    report: rapport,
    message: `Destination vidée : service arrêté, port ${target.backendPort} libéré, routage retiré, `
      + `quarantaine 410 posée, ${inv.files ?? 0} fichier(s) supprimé(s)${inv.size ? ` (${inv.size})` : ''}. `
      + `${depub.unpublished} média(s) redeviennent locaux. Sa fiche peut maintenant être supprimée.`,
  });
  return res.end();
}

/**
 * SUPPRESSION DÉFINITIVE D'UNE DESTINATION — le second geste, en direct.
 *
 * ══ CE QU'ELLE FERME ════════════════════════════════════════════════════════
 *
 * `POST /targets/:id/delete` refusait dès que la quarantaine 410 subsistait,
 * en renvoyant vers « Supprimer la destination avec une session serveur
 * ouverte » — l'action même qu'elle refusait. Le moteur savait pourtant lever
 * une quarantaine depuis toujours (`removeQuarantine`) : personne ne
 * l'appelait. L'opérateur se retrouvait entre un retrait qui répondait « déjà
 * vidée » et une suppression qui répondait « quarantaine présente ».
 *
 * Cette route fait le travail : elle prouve que le serveur ne porte plus rien,
 * lève la quarantaine, re-prouve, puis oublie la fiche. Même mécanique que le
 * retrait — flux NDJSON, run persisté, checklist, rapport copiable — parce que
 * c'est la seconde opération qui DÉTRUIT, et qu'elle mérite la même
 * traçabilité.
 */
export async function destinationDeleteStream(req, res) {
  try {
    return await destinationDeleteFlux(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[deploiement] DESTINATION_DELETE interrompu : ${err.stack ?? err.message}`);
    void journal(null, {
      source: SOURCES.HTTP,
      level: LEVELS.ERROR,
      eventCode: EVENTS.HTTP_REQUEST_FAILED,
      message: `Erreur serveur pendant DESTINATION_DELETE : ${err.message}`,
      error: err,
      details: { headersSent: res.headersSent, operationType: 'DESTINATION_DELETE' },
    });
    if (!res.headersSent) {
      return res.status(500).json({
        code: 'DESTINATION_DELETE_STREAM_FAILED',
        message: 'La suppression n’a pas pu être lancée. Rien n’a été modifié.',
      });
    }
    if (!res.writableEnded) {
      try {
        res.write(`${JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'delete.failed',
          code: 'DESTINATION_DELETE_STREAM_FAILED',
          message: `La suppression a été interrompue par une erreur serveur : ${err.message}.`,
        })}\n`);
      } catch { /* le client est déjà parti */ }
      res.end();
    }
    return undefined;
  }
}

async function destinationDeleteFlux(req, res) {
  const { targetId, sessionId } = req.body;

  let target;
  try {
    target = await targets.getTargetOr404(targetId);
  } catch (err) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode || 400).json({ success: false, message: apiErr.message });
  }

  try {
    assertHostnameConfirmed(req.body?.confirmHostname, target,
      'Suppression refusée parce que le nom d’hôte saisi ne correspond pas.');
    lifecycle.assertDeletable(target);
    lifecycle.assertOperationIsolated(target, await targets.listTargets());
    /**
     * LA SESSION N'EST EXIGÉE QUE S'IL RESTE QUELQUE CHOSE À FAIRE SUR LE
     * SERVEUR. Une destination sans quarantaine se supprime sans SSH — exiger
     * un mot de passe pour ne rien faire serait une friction sans contrepartie.
     */
    if (target.quarantineEnabled === true && !sessionId) {
      throw ApiError.badRequest(
        `Le domaine « ${target.host} » répond encore 410. Sa levée exige une session serveur : `
        + 'connectez-vous au serveur, puis relancez la suppression.',
        { code: 'SESSION_REQUIRED', host: target.host, requiresSsh: true },
      );
    }
  } catch (err) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode || 400).json({
      success: false, message: apiErr.message, code: apiErr.details?.code ?? null,
    });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  req.on('close', () => { clientGone = true; });
  let seq = 0;
  const write = (obj) => {
    if (clientGone) return;
    try {
      res.write(`${JSON.stringify({ sequenceNumber: ++seq, timestamp: new Date().toISOString(), ...obj })}\n`);
      res.flush?.();
    } catch { clientGone = true; }
  };

  const debut = Date.now();
  write({
    type: 'delete.started',
    operationType: 'DESTINATION_DELETE',
    target: { id: String(target._id), name: target.name, host: target.host, url: target.url },
    steps: DESTINATION_DELETE_STEPS,
  });

  const run = await runs.createRun({
    target, user: req.user?.email, version: null, operationType: 'DESTINATION_DELETE',
  });
  const runId = String(run._id);
  /**
   * LE RUN REJOINT LA TENTATIVE HTTP — c'est ce lien qui rend l'incident
   * racontable : requestId → runId → étapes → verdict → coupure éventuelle.
   * Sans lui, la trace et le run existent chacun de leur côté et personne ne
   * sait qu'ils parlent de la même chose.
   */
  await req.forensics?.lier?.(runId, target._id).catch(() => {});
  void journal(runId, {
    source: SOURCES.HTTP, level: LEVELS.INFO, eventCode: EVENTS.HTTP_STREAM_OPENED,
    message: `Suppression de « ${target.name} » (${target.host}) demandée.`,
    details: { requestId: req.forensics?.requestId ?? null, host: target.host, quarantine: target.quarantineEnabled === true },
  });
  write({ type: 'delete.run', runId, startedAt: run.startedAt });

  const etapes = [];
  const noterEtape = (evt) => {
    if (!evt?.step) return;
    const existante = etapes.find((e) => e.id === evt.step);
    const ligne = {
      id: evt.step,
      label: evt.label ?? evt.step,
      order: existante?.order ?? etapes.length,
      status: evt.status ?? 'running',
      durationMs: evt.durationMs ?? null,
      technicalMessage: evt.error?.message ?? evt.reason ?? null,
      errorCode: evt.error?.code ?? null,
      critical: true,
      warnings: [],
    };
    if (existante) Object.assign(existante, ligne);
    else etapes.push(ligne);
  };

  /** Les étapes APPLICATIVES sont émises ici — le moteur ne connaît pas la fiche. */
  const etapeApp = async (id, fn) => {
    const meta = DESTINATION_DELETE_STEPS.find((s) => s.id === id) ?? { id, label: id };
    const t0 = Date.now();
    noterEtape({ step: id, label: meta.label, status: 'running' });
    write({ type: 'step', step: id, label: meta.label, status: 'running' });
    const detail = await fn();
    const evt = {
      step: id, label: meta.label, status: 'ok', durationMs: Date.now() - t0, detail: detail ?? null,
    };
    noterEtape(evt);
    void journal(runId, {
      source: SOURCES.ENGINE, level: LEVELS.INFO, eventCode: EVENTS.STEP_SUCCEEDED,
      message: `${meta.label} — terminée.`, stepId: id, details: { durationMs: evt.durationMs },
    });
    write({ type: 'step', ...evt });
    return detail;
  };

  const echouer = async (code, message, failedStep) => {
    const rapport = rapportDeSuppression({ target, runId, etapes, debut, ok: false, code, message, failedStep });
    await cloreRun(runId, {
      ok: false, status: 'error', finalStepId: failedStep ?? null, steps: etapes,
      structuredReport: rapport, errorSummary: { code, message },
    }, write);
    void journal(runId, {
      source: SOURCES.SYSTEM, level: LEVELS.ERROR, eventCode: EVENTS.STEP_FAILED,
      message: `Suppression interrompue : ${message}`, stepId: failedStep ?? null, details: { code },
    });
    write({ type: 'delete.failed', runId, code, failedStep: failedStep ?? null, report: rapport, message });
    return res.end();
  };

  let resultat = null;
  try {
    await etapeApp('delete.lock', async () => ({ targetId: String(target._id), host: target.host }));

    const autres = await targets.listTargets();
    const protectedPaths = autres
      .filter((t) => t.id !== String(target._id))
      .map((t) => `${t.remoteRoot ?? '/var/www'}/${t.host}`);

    /**
     * SANS QUARANTAINE, AUCUNE COMMANDE DISTANTE N'EST NÉCESSAIRE.
     * On ne se connecte pas à un serveur pour constater qu'on n'a rien à y
     * faire — et l'on dit que ces étapes ont été SAUTÉES, pas exécutées.
     */
    if (target.quarantineEnabled !== true) {
      for (const id of ['delete.inspect', 'delete.runtime.verify', 'delete.quarantine.release', 'delete.verify']) {
        const meta = DESTINATION_DELETE_STEPS.find((s) => s.id === id);
        const evt = {
          step: id, label: meta.label, status: 'skipped', durationMs: 0,
          reason: 'already_absent', detail: { alreadyDone: true, reason: 'already_absent' },
        };
        noterEtape(evt);
        write({ type: 'step', ...evt });
      }
      resultat = { ok: true, steps: [], inspection: null };
    } else {
      resultat = await engine.deleteDestination({
        url: target.url,
        sessionId,
        options: {
          remoteRoot: target.remoteRoot,
          backendPort: target.backendPort,
          protectedPaths,
        },
        onStep: (evt) => { noterEtape(evt); write({ type: 'step', ...evt }); },
      });
    }
  } catch (err) {
    const converti = toApiError(err);
    return echouer(converti.details?.code ?? 'DESTINATION_DELETE_FAILED', converti.message, 'delete.inspect');
  }

  if (!resultat.ok) {
    return echouer(
      resultat.error?.code ?? 'DESTINATION_DELETE_FAILED',
      resultat.error?.message ?? 'Suppression interrompue.',
      resultat.failedStep ?? null,
    );
  }

  /**
   * LA QUARANTAINE EST LEVÉE SUR LE SERVEUR : la fiche doit cesser de
   * l'annoncer AVANT qu'on la supprime. Sans cela, un échec de la suppression
   * laisserait une fiche affirmant un 410 qui n'existe plus.
   */
  if (target.quarantineEnabled === true) {
    await lifecycle.setQuarantine(String(target._id), false).catch(() => null);
  }

  try {
    await etapeApp('delete.record.remove', async () => {
      const supprime = await targets.deleteTarget(String(target._id), {
        actor: { userEmail: req.user?.email ?? null },
        confirmHostname: target.host,
      });
      return { deleted: true, lifecycleStatus: supprime.lifecycleStatus, deletedAt: supprime.deletedAt };
    });
  } catch (err) {
    const converti = toApiError(err);
    return echouer(converti.details?.code ?? 'DESTINATION_RECORD_DELETE_FAILED',
      converti.message, 'delete.record.remove');
  }

  await etapeApp('delete.finalize', async () => ({ host: target.host, quarantineReleased: true }));

  const rapport = rapportDeSuppression({
    target, runId, etapes, debut, ok: true,
    inspection: resultat.inspection ?? null,
    quarantineWasPresent: target.quarantineEnabled === true,
  });
  await cloreRun(runId, {
    ok: true, status: 'ok', finalStepId: 'delete.finalize', steps: etapes, structuredReport: rapport,
  }, write);
  /**
   * LE VERDICT EST ÉCRIT AVANT D'ÊTRE ANNONCÉ.
   *
   * Le run est finalisé, puis journalisé, puis seulement écrit au flux. Si le
   * client a déjà raccroché, la vérité reste entière en base : c'est elle que
   * la reconnexion relira.
   */
  void journal(runId, {
    source: SOURCES.SYSTEM, level: LEVELS.INFO, eventCode: EVENTS.FINALIZATION_SUCCEEDED,
    message: `Destination « ${target.name} » supprimée définitivement.`,
    stepId: 'delete.finalize',
    details: { host: target.host, quarantineReleased: target.quarantineEnabled === true },
  });
  write({
    type: 'delete.succeeded',
    runId,
    // Le verdict PORTE ce qui a disparu : l'écran n'a rien à relire pour
    // afficher son propre succès.
    deleted: true,
    targetId: String(target._id),
    deletedTargetSnapshot: rapport.deletedTargetSnapshot,
    report: rapport,
    message: `Destination « ${target.name} » supprimée. `
      + `${target.quarantineEnabled === true ? 'La quarantaine 410 a été levée sur le serveur. ' : ''}`
      + 'Son historique reste consultable.',
  });
  return res.end();
}

/** LE RAPPORT D'UNE SUPPRESSION — même forme que celui du retrait. */
function rapportDeSuppression({
  target, runId, etapes, debut, ok, code = null, message = null, failedStep = null,
  inspection = null, quarantineWasPresent = false,
}) {
  return {
    /**
     * L'INSTANTANÉ DE CE QUI VIENT DE DISPARAÎTRE.
     *
     * ══ POURQUOI LE VERDICT DOIT SE SUFFIRE ═════════════════════════════════
     *
     * L'écran affiche son succès APRÈS que la destination a cessé d'exister.
     * S'il doit relire la fiche pour se raconter, il relit une ressource
     * supprimée — et c'est un cas NORMAL, pas une exception : entre la
     * suppression et le rafraîchissement de la liste, l'interface détient
     * encore des références vers un objet qui n'est plus là.
     *
     * Le verdict porte donc tout ce qu'il faut pour l'afficher. Aucun refetch
     * n'est une condition du succès.
     */
    deletedTargetSnapshot: {
      id: String(target._id),
      name: target.name,
      host: target.host,
      url: target.url,
      environment: target.environment,
      backendPort: target.backendPort ?? null,
    },
    identification: {
      runId,
      operationType: 'DESTINATION_DELETE',
      targetId: String(target._id),
      targetName: target.name,
      host: target.host,
      url: target.url,
      environment: target.environment,
      startedAt: new Date(debut).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - debut,
    },
    outcome: {
      ok: ok === true,
      status: ok ? 'ok' : 'error',
      failedStep,
      error: ok ? null : { code, message },
    },
    steps: etapes,
    removed: {
      quarantine410: quarantineWasPresent,
      record: ok === true,
      port: target.backendPort ?? null,
    },
    verifications: {
      pm2Absent: ok === true,
      portFree: ok === true,
      applicationRoutingAbsent: ok === true,
      quarantineAbsent: ok === true,
      inspection,
    },
    warnings: [],
  };
}

/**
 * LE RAPPORT D'UN RETRAIT — ce qui a été fait, sur quoi, et ce qu'il en reste.
 *
 * Même forme qu'un rapport de déploiement (identification / étapes / résultat)
 * pour qu'un seul lecteur suffise, et pour qu'il se copie tel quel dans un
 * ticket ou un message.
 */
function rapportDeRetrait({
  target, runId, etapes, result, debutRetrait, removePersistentData, unpublishedMedia = 0,
}) {
  const inv = result.inventory ?? {};
  return {
    identification: {
      runId,
      operationType: 'DEPROVISION',
      targetId: String(target._id),
      targetName: target.name,
      host: target.host,
      url: target.url,
      environment: target.environment,
      startedAt: new Date(debutRetrait).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - debutRetrait,
    },
    outcome: {
      ok: result.ok === true,
      status: result.ok ? 'ok' : 'error',
      failedStep: result.failedStep ?? null,
      error: result.ok ? null : {
        code: result.error?.code ?? 'DEPROVISION_FAILED',
        message: result.error?.message ?? 'Échec du retrait.',
      },
    },
    steps: etapes,
    /** CE QUI A ÉTÉ RETIRÉ — relevé sur le serveur, jamais supposé. */
    removed: {
      service: inv.pm2Name ?? null,
      port: target.backendPort ?? null,
      nginxSites: inv.nginxSites ?? null,
      files: inv.files ?? 0,
      size: inv.size ?? null,
      persistentDataRemoved: removePersistentData === true,
      unpublishedMedia,
    },
    /** CE QUI A ÉTÉ VÉRIFIÉ APRÈS COUP — la preuve, distincte de l'action. */
    verifications: {
      quarantine410: result.ok === true,
      portFree: result.ok === true,
      remainingFiles: inv.remaining ?? null,
    },
    warnings: [],
  };
}

/* ------------------------------- Préflight ------------------------------ */

export const preflight = asyncHandler(async (req, res) => {
  const { sessionId, remoteRoot } = req.body;
  let url = req.body.url;
  if (!url && req.body.targetId) {
    const doc = await targets.getTargetOr404(req.body.targetId);
    url = doc.url;
  }
  if (!url) throw ApiError.badRequest('URL ou targetId requis.');
  try {
    const result = await engine.preflight({ url, sessionId, remoteRoot });
    return ok(res, result);
  } catch (err) {
    throw toApiError(err);
  }
});

/* ------------------------------ Déploiement ----------------------------- */

/**
 * ══ IL N'Y A PLUS QU'UNE SEULE FAÇON DE DÉPLOYER ════════════════════════════
 *
 * `POST /deployment/deploy` vivait ici : un déploiement complet rendu en UNE
 * réponse, sans flux. C'était l'entrée d'origine, et elle a survécu à tous les
 * lots qui ont durci la seconde.
 *
 * ── CE QU'ELLE CONTOURNAIT, ET POURQUOI C'EST DEVENU INACCEPTABLE ──────────
 *
 * Elle appelait `engine.deploy()` directement, donc SANS rien de ce qui rend
 * aujourd'hui un déploiement racontable et sûr :
 *
 *   · aucun `createRun` — le déploiement n'existait dans aucun journal durable,
 *     et l'écran n'avait rien à relire ;
 *   · aucune BARRIÈRE DE PUBLICATION — elle pouvait basculer la release sans
 *     jamais vérifier qu'elle savait encore l'écrire ;
 *   · aucun journal forensique ;
 *   · et surtout : `markDeploying(targetId)` SANS `runId`. Le verrou
 *     s'inscrivait donc à `null` — c'est-à-dire qu'il ne verrouillait RIEN, et
 *     qu'un `/deploy/stream` lancé dans la foulée passait le filtre
 *     conditionnel sans rien voir. Deux pipelines sur la même destination :
 *     deux bascules de release, deux redémarrages, deux vérifications qui
 *     s'observent l'une l'autre. C'est exactement le défaut que le verrou
 *     conditionnel avait fermé pour le flux, resté grand ouvert ici.
 *
 * ── POURQUOI SUPPRIMER PLUTÔT QUE CORRIGER ────────────────────────────────
 *
 * La réparer aurait produit une SECONDE implémentation du même parcours, à
 * maintenir en parallèle et à durcir deux fois à chaque lot. Or elle n'avait
 * plus aucun appelant : ni page du Manager, ni test, ni script — seulement un
 * wrapper de SDK que personne n'appelait et une ligne de documentation.
 *
 * Une route morte qui contourne les garanties n'est pas du code mort : c'est
 * une porte dérobée que personne ne surveille.
 *
 * `DeploymentEngine.deploy()` n'est PAS supprimé pour autant : c'est une
 * primitive du moteur MIROIR, éprouvée par `deployment-engine.test.js` et
 * identique dans tous les dépôts de l'écosystème. Ce qui disparaît est le
 * chemin HTTP, pas le moteur.
 *
 * Le parcours canonique — et désormais unique — est `POST /deployment/deploy/stream`.
 * Une garde de recette (`deployment-entrypoints.test.js`) échoue si une seconde
 * route de déploiement réapparaît.
 */

/**
 * POST /deployment/deploy/stream — déploiement en flux NDJSON.
 *
 * Émet une ligne JSON par évènement d'étape (`{type:'step',...}`) au fil du
 * pipeline (le moteur émet déjà `onStep`), puis une ligne finale
 * `{type:'result',...}` ou `{type:'error',...}`. Permet à l'UI d'afficher la
 * progression EN DIRECT sans polling ni fausse animation.
 *
 * N'utilise PAS asyncHandler : une fois les en-têtes envoyés, on ne peut plus
 * passer par le middleware d'erreur (il tenterait de réécrire le statut). On
 * gère donc toute erreur en interne et on la transmet dans le flux.
 */
/**
 * Cœur commun aux opérations en flux (déploiement ET préflight). Un préflight
 * est un déploiement `preflightOnly` de type PRECHECK : MÊME checklist live,
 * MÊME rapport persisté, MÊME historique. La seule différence : il s'arrête
 * avant l'upload.
 */
async function streamOperation(req, res, { operationType, preflightOnly }) {
  const { targetId, sessionId, email, remoteEnv, skipBuild } = req.body;

  let target;
  try {
    target = await targets.getTargetOr404(targetId);
  } catch (err) {
    const apiErr = toApiError(err);
    return res.status(apiErr.statusCode || 400).json({ success: false, message: apiErr.message });
  }

  // L'ENVIRONNEMENT VIENT DE LA DESTINATION — voir `deploy` ci-dessus.
  const env = target.environment;

  // PRÉREQUIS LOCAUX — AVANT les en-têtes NDJSON, avant le run, avant tout.
  // Un PRÉFLIGHT reste autorisé sur un dépôt non commité : c'est précisément
  // l'opération qu'on lance pour constater ce qui ne va pas, et elle ne
  // déploie rien.
  if (!preflightOnly) {
    const refusal = await localPrerequisitesFailure(env);
    if (refusal) {
      return res.status(400).json({
        success: false,
        code: refusal.details.code,
        message: refusal.message,
        details: refusal.details,
      });
    }
  }

  // Configuration DISTANTE (.env du VPS) construite CÔTÉ SERVEUR : aucun secret
  // ne transite par le navigateur. Le Manager n'envoie pas de remoteEnv ; on le
  // dérive de process.env (cluster Atlas déjà configuré) + secrets propres à la
  // cible (générés/persistés). Un échec ici est explicite et bloque AVANT tout
  // upload — jamais un backend qui redémarre en boucle faute de MONGODB_URI.
  let resolvedRemoteEnv = remoteEnv;
  let remoteEnvSummary = null;
  if (!resolvedRemoteEnv) {
    try {
      const built = buildRemoteEnv(target, { env });
      resolvedRemoteEnv = built.remoteEnv;
      remoteEnvSummary = describeRemoteEnv(built);
    } catch (err) {
      const apiErr = toApiError(err);
      return res.status(apiErr.statusCode || 400).json({ success: false, message: apiErr.message, code: err.code || 'DEPLOY_ENV_INCOMPLETE' });
    }
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering Nginx
  res.flushHeaders?.();

  // Déconnexion du client : on continue l'opération (le rapport est persisté).
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
  });
  const write = (obj) => {
    if (clientGone) return;
    try {
      res.write(`${JSON.stringify(obj)}\n`);
      res.flush?.();
    } catch {
      clientGone = true;
    }
  };

  const version = await engine.getVersion().catch(() => null);
  /**
   * ══ SANS RUN, ON NE TOUCHE À RIEN ═══════════════════════════════════════════
   *
   * La création du run précède le verrou, le plan de contrôle et toute commande
   * distante : à cet instant, rien n'a encore été modifié nulle part. Si elle
   * échoue, il n'y a donc RIEN à défaire — il suffit de ne pas commencer.
   *
   * Ce refus est explicite plutôt que laissé à la ceinture de sécurité du flux :
   * une erreur non typée y serait rendue comme une panne quelconque, alors que
   * celle-ci a un sens précis et une conduite à tenir (réessayer plus tard, sans
   * craindre un état intermédiaire sur le serveur).
   */
  let run;
  try {
    run = await runs.createRun({ target, user: req.user?.email, version, operationType });
  } catch (err) {
    write({
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'deployment.failed',
      status: 'error',
      errorCode: 'DEPLOYMENT_RUN_NOT_CREATED',
      message: 'Le déploiement n’a pas démarré : son journal n’a pas pu être ouvert. '
        + 'Aucune commande n’a été envoyée au serveur et rien n’a été modifié.',
    });
    return res.end();
  }
  const runId = String(run._id);

  /**
   * LE RUN EST RATTACHÉ À LA TRACE, ET DÉCLARÉ AU PROCESS.
   *
   * Le rattachement recolle les deux moitiés de l'histoire : ce qui s'est
   * passé AVANT la création du run (dans la tentative) et ce qui suit.
   * La déclaration au process permet qu'un rejet non géré — qui n'a aucun
   * contexte — s'inscrive dans le bon run plutôt que nulle part.
   */
  await req.forensics?.lier(runId, target._id).catch(() => {});
  setActiveRun(runId);
  // Continuité du numéro de séquence : les évènements émis par le contrôleur
  // (report_ready, garde-fou) prolongent la numérotation du moteur.
  let lastSeq = 0;
  const writeSeq = (obj) => write({ sequenceNumber: ++lastSeq, timestamp: new Date().toISOString(), deploymentRunId: runId, ...obj });

  /**
   * ══ `run.created` — LE PREMIER ÉVÈNEMENT, TOUJOURS, ET SANS CONDITION ═════
   *
   * ── LE DÉFAUT QU'IL FERME ─────────────────────────────────────────────────
   *
   * `deploymentRunId` voyage sur CHAQUE évènement (`writeSeq`), mais le premier
   * à partir était `deployment.env_resolved` — émis SEULEMENT si un résumé
   * d'environnement existait. L'écran apprenait donc l'identité du run à un
   * moment qui dépendait de la configuration de la destination, et parfois
   * seulement à la première étape métier.
   *
   * Or c'est cette identité, et elle seule, qui permet de basculer sur le suivi
   * persistant. Tant qu'elle manquait, l'interface n'avait d'autre choix que
   * d'accumuler les évènements reçus — c'est-à-dire de se construire une
   * seconde vérité, celle que ce lot supprime.
   *
   * Il est donc émis ici : après la création du run, avant toute décision, et
   * quoi qu'il arrive ensuite. Un type inconnu est ignoré par les anciens
   * consommateurs ; aucun appelant n'est cassé.
   */
  writeSeq({ type: 'run.created', runId, status: 'starting' });

  // Info NON SENSIBLE : quelle base / quels secrets ont été résolus (aucune valeur
  // secrète). Les évènements de type inconnu sont ignorés par le frontend.
  if (remoteEnvSummary) writeSeq({ type: 'deployment.env_resolved', envSummary: remoteEnvSummary });

  /**
   * ══ LE VERROU DE DÉPLOIEMENT — POSÉ AVEC SON RUN, ET RESPECTÉ ═════════════
   *
   * Deux défauts vivaient sur cette ligne, et la recette de bout en bout les a
   * révélés ensemble :
   *
   *   · le `runId` n'était pas transmis. Le verrou s'écrivait donc `null` —
   *     c'est-à-dire qu'il ne verrouillait rien, et que `beginDeprovision`,
   *     qui le lit pour refuser un retrait pendant un déploiement, ne voyait
   *     jamais de déploiement en vol ;
   *   · le `.catch(() => {})` avalait TOUT, y compris un refus. Une destination
   *     déjà en cours de publication laissait donc démarrer un second pipeline :
   *     deux bascules de release, deux redémarrages de service, et deux
   *     vérifications qui s'observent l'une l'autre.
   *
   * Le refus est désormais une réponse, pas un silence. Les autres échecs
   * (écriture concurrente, base momentanément indisponible) restent tolérés :
   * ils ne mettent pas deux pipelines face à face.
   */
  if (!preflightOnly) {
    try {
      await targets.markDeploying(targetId, runId);
    } catch (err) {
      if (err?.statusCode === 409 || err?.status === 409) {
        await cloreRun(runId, {
          ok: false,
          status: 'error',
          finalStepId: 'deployment.initialize',
          errorSummary: { code: 'DEPLOYMENT_ALREADY_RUNNING', step: 'deployment.initialize', message: err.message },
        }, writeSeq);
        writeSeq({ type: 'deployment.failed', status: 'error', errorCode: 'DEPLOYMENT_ALREADY_RUNNING', message: err.message });
        clearActiveRun(runId);
        return res.end();
      }
      /* Autre cause : on ne bloque pas un déploiement pour un défaut d'écriture. */
    }
  }


  // PLAN DE CONTRÔLE (P2.7) — résout/crée la destination + une release, marque
  // DEPLOYING. Best-effort : indisponible ne casse jamais le déploiement.
  let controlPlane = null;
  if (!preflightOnly) {
    try {
      controlPlane = await beginControlPlaneDeployment({ metierTarget: target, env, dbName: remoteEnvSummary?.dbName, runId });
      writeSeq({ type: 'control_plane.target.persist', targetId: controlPlane.targetId, releaseId: controlPlane.releaseId });
    } catch (err) {
      writeSeq({ type: 'control_plane.warning', code: err.code || 'CONTROL_DB_UNAVAILABLE', message: 'Plan de contrôle indisponible — déploiement poursuivi.' });
    }
  }

  /**
   * FOURNISSEUR DNS — le Panel d'abord, la clé locale en repli (L9).
   *
   * Le moteur dépend de l'interface `DnsProvider`, jamais d'Hostinger : c'est
   * cette couture qui permet de changer de CHEMIN sans toucher au pipeline.
   *
   * `resolveDnsProvider` tente la capacité `dns.*` du Panel — aucun credential
   * local, appartenance du domaine vérifiée côté Panel. Le repli n'existe plus
   * que pour UNE raison, nommée : ce Panel-là ne connaît pas encore le verbe
   * (déploiement progressif). Un refus, un délai dépassé, un Panel injoignable
   * ferment le chemin au lieu de rouvrir la clé locale — contourner un « non »
   * avec un secret local annulerait exactement le contrôle qu'on installe, et
   * rejouer une écriture dont l'issue est indéterminée la doublerait.
   */
  const hz = await resolveDnsProvider({
    siteHost: target.host,
    runId,
    invoke: capabilitiesAvailable() ? invokeCapability : null,
  }).catch(() => ({ available: false, reason: 'PANEL_UNAVAILABLE:ERROR', path: 'NONE', provider: null }));
  if (hz.path !== 'PANEL_CAPABILITY') {
    /**
     * UN SEUL CODE, PARCE QU'IL N'Y A PLUS QU'UNE SITUATION (L9.2).
     *
     * `DNS_PATH_LOCAL` a disparu avec le repli qu'il signalait. Il ne reste que
     * l'absence de DNS automatique, toujours accompagnée de sa cause : le
     * déploiement continue, il ne se croit pas complet, et personne n'a écrit
     * avec un secret qu'on croyait retiré.
     */
    writeSeq({
      type: 'deployment.warning',
      code: 'DNS_PATH_NONE',
      message: `Gestion DNS automatique indisponible (${hz.reason || 'sans motif'}).`,
    });
  }

  /**
   * IDENTITÉ DU PROJET DÉPLOYÉ — et, par elle, le droit de récupérer les médias
   * de ses emplacements antérieurs.
   *
   * Une destination sans parenté déclarée reçoit ici sa PROPRE identité : elle
   * devient son propre projet et n'hérite de rien. C'est volontairement le choix
   * conservateur — rapprocher deux destinations reste un acte déclaré, jamais
   * une déduction depuis la base, le domaine ou le serveur.
   */
  let projectIdentityId = null;
  if (!preflightOnly) {
    try {
      const ident = await identity.ensureOwnIdentity(target, { origin: 'MIGRATION', actor: req.user?.email, reason: 'déploiement' });
      projectIdentityId = ident.identityId;
    } catch (err) {
      writeSeq({ type: 'deployment.warning', code: err.code || 'PROJECT_IDENTITY_UNAVAILABLE', message: 'Identité de projet indisponible — aucune migration de médias ne sera tentée.' });
    }
  }

  /**
   * Emplacement de CE déploiement, enregistré au moment où le moteur en connaît
   * les chemins réels. Il ne deviendra une source de migration qu'une fois le
   * déploiement validé (`HEALTHY`) : un emplacement qui a échoué avant l'upload
   * n'a peut-être reçu aucun fichier, et en faire une source reviendrait à
   * migrer du vide en croyant migrer des médias.
   */
  let locationId = null;
  const resolveUploadsSources = async ({ host, siteRoot, sharedUploads }) => {
    if (!projectIdentityId) return null;
    const loc = await identity.recordLocation({
      projectIdentityId,
      deploymentTargetId: target._id,
      host,
      siteRoot,
      sharedUploadsPath: sharedUploads,
      sharedStoragePath: `${siteRoot}/shared/storage`,
      sshHost: target.sshHost || null,
      environment: env,
      deploymentRunId: runId,
      commit: version,
    });
    locationId = loc?._id || null;
    return identity.resolveUploadsSources({
      projectIdentityId,
      deploymentTargetId: target._id,
      sharedUploadsPath: sharedUploads,
    });
  };

  /**
   * L'OBSERVATEUR SSH — c'est ici que le moteur générique rencontre le journal.
   *
   * Le transport émet des faits (`SSH_CONNECT_STARTED`, `SSH_TIMEOUT`…) ; on
   * les écrit dans le run. Le mot de passe ne franchit jamais cette frontière :
   * le transport ne publie que la MÉTHODE d'authentification.
   */
  engine.transportObserver = ({ eventCode, host, port, username, authMethod, ...reste }) => {
    void journal(runId, {
      source: SOURCES.SSH,
      level: eventCode === 'SSH_READY' || eventCode === 'SSH_CONNECT_STARTED' ? LEVELS.INFO : LEVELS.ERROR,
      eventCode,
      stepId: 'ssh.connect',
      message: eventCode === 'SSH_READY'
        ? `Connexion établie avec ${username}@${host}:${port} en ${reste.durationMs} ms.`
        : eventCode === 'SSH_CONNECT_STARTED'
          ? `Connexion à ${username}@${host}:${port} (${authMethod}).`
          : `${eventCode} sur ${username}@${host}:${port}${reste.reason ? ` — ${reste.reason}` : ''}.`,
      errorCode: reste.errorCode ?? null,
      details: { host, port, username, authMethod, ...reste },
      port,
    });
  };

  /**
   * LE JOURNAL DURABLE DE CE RUN.
   *
   * Une file par run, et non un état global : deux déploiements simultanés sur
   * deux destinations écrivent dans deux documents, et l'échec de l'un ne doit
   * pas refuser la publication de l'autre.
   */
  const journalEtapes = createStepJournal(runId);

  /**
   * ══ LE PORT EST ARRÊTÉ AVANT QUE LE PIPELINE N'ÉCRIVE QUOI QUE CE SOIT ═════
   *
   * ── L'INCIDENT QUI A IMPOSÉ CE BLOC ───────────────────────────────────────
   *
   * `demo-fjservices06.ly-solution.com` a servi le site d'un AUTRE client
   * pendant plusieurs heures. Pas un octet de son code n'était en cause : son
   * Nginx proxifiait `/api/` vers `127.0.0.1:5102`, port que détenait le
   * backend de `kleenpro`. La vitrine du bon projet allait donc chercher
   * l'entreprise, le thème et le catalogue dans la base d'un autre — une fuite
   * inter-locataires, servie en HTTPS, sur le bon domaine.
   *
   * ── POURQUOI LE REGISTRE N'AVAIT RIEN VU ─────────────────────────────────
   *
   * `PortReservation` vit dans la base DU PROJET. Le registre d'un projet neuf
   * est donc vide, et il ignore tout ce qui tourne déjà sur le serveur
   * PARTAGÉ. C'est connu, c'est documenté, et c'est précisément ce que
   * `ensureUsablePort` corrige : elle interroge la MACHINE — sockets réelles et
   * process PM2, seule source qui connaisse tous les locataires — et réattribue
   * le port avant qu'il n'entre dans une configuration.
   *
   * ── LE VRAI DÉFAUT : ELLE N'ÉTAIT CÂBLÉE QUE SUR UN SEUL PILOTE ──────────
   *
   * `deploy-drive.js` l'appelait. CET écran — celui par lequel passent tous les
   * déploiements réels — ne l'appelait pas. Il ne disposait que de
   * `verifyBeforeStart`, à l'étape `services.start` : c'est-à-dire APRÈS
   * `nginx.configure`, APRÈS `https.configure` et APRÈS la bascule des
   * artefacts. Le moteur refusait bien de démarrer — il a raison de refuser —
   * mais il refusait trop tard : le site était déjà en ligne, câblé sur le
   * backend du voisin, et le rapport s'achevait sur un échec pendant que le
   * domaine servait les données d'un tiers.
   *
   * Deux portes, une seule protection : c'est la forme exacte du défaut que
   * `deploy-drive.js` documente déjà pour le DNS, dans l'autre sens. La
   * correction est donc la même — la protection appartient aux DEUX portes.
   *
   * ── POURQUOI AUSSI EN PRÉFLIGHT ──────────────────────────────────────────
   *
   * Un préflight est l'opération qu'on lance pour constater ce qui ne va pas.
   * Un port déjà pris est exactement cela. Et le geste reste sans effet sur le
   * serveur : il ne touche QUE le registre local. `ensureUsablePort` ne déplace
   * jamais un port que notre propre service PM2 détient (`DETENU_PAR_NOUS`) —
   * un redéploiement garde donc le sien, et seule une collision avec un tiers
   * provoque un déplacement, cas où la configuration en place était déjà
   * fausse.
   *
   * ── UNE VÉRIFICATION IMPOSSIBLE N'AUTORISE RIEN ──────────────────────────
   *
   * Si la machine ne répond pas, on ne déplace rien et on ne conclut rien : on
   * le DIT, et `verifyBeforeStart` reste bloquante avant le démarrage. Un
   * silence n'est pas un feu vert.
   */
  const identifiantsVps = vault.getSession(sessionId);
  if (identifiantsVps) {
    const transportPort = new SshTransport({
      host: identifiantsVps.host,
      username: identifiantsVps.username,
      password: identifiantsVps.password,
    });
    try {
      const verdict = await ports.ensureUsablePort({
        target,
        transport: transportPort,
        expectedPm2Name: pm2AppName(target.host),
      });
      if (verdict.moved) {
        target.backendPort = verdict.port;
        await target.save?.();
        /**
         * LE `.env` DISTANT SUIT LE PORT, SINON RIEN NE MARCHE.
         *
         * Nginx lit `options.backendPort` (ci-dessous, depuis `target`), le
         * backend lit `PORT` dans son `.env`. Déplacer l'un sans l'autre
         * produirait un proxy qui pointe là où personne n'écoute — un 502
         * propre, mais un 502 quand même.
         */
        if (resolvedRemoteEnv) resolvedRemoteEnv.PORT = String(verdict.port);
        await journal(runId, {
          source: SOURCES.PM2, level: LEVELS.WARNING,
          eventCode: EVENTS.PORT_REASSIGNED,
          stepId: 'deployment.initialize', port: verdict.port,
          message: `Port ${verdict.from} détenu par un autre service : réattribué à ${verdict.port} `
            + 'avant toute configuration du serveur web.',
          details: { from: verdict.from, to: verdict.port, reason: verdict.reason },
        });
        writeSeq({
          type: 'deployment.port_reassigned',
          message: `Port ${verdict.from} occupé sur le serveur — réattribué à ${verdict.port}.`,
          from: verdict.from, to: verdict.port, reason: verdict.reason,
        });
      } else {
        writeSeq({
          type: 'deployment.port_settled',
          message: `Port ${verdict.port} retenu${verdict.reason ? ` (${verdict.reason})` : ''}.`,
          port: verdict.port,
        });
      }
    } catch (err) {
      writeSeq({
        type: 'deployment.port_check_failed',
        message: `Vérification du port impossible (${err?.message ?? err}) — `
          + 'le moteur tranchera avant démarrage.',
      });
    } finally {
      await transportPort.close?.().catch?.(() => null);
    }
  }

  let etatPm2Avant = null;
  let result;
  try {
    result = await engine.deployWithReport({
      url: target.url,
      sessionId,
      user: req.user?.email,
      deploymentRunId: runId,
      onEvent: (evt) => {
        if (typeof evt.sequenceNumber === 'number') lastSeq = evt.sequenceNumber;
        write(evt);
        const statut = {
          'step.started': 'running', 'step.succeeded': 'ok', 'step.warning': 'warning',
          'step.failed': 'error', 'step.skipped': 'skipped',
        }[evt.type];
        if (statut && evt.stepId) {
          /**
           * ══ AVANT LA PUBLICATION, ON ATTEND ; APRÈS, ON CONTINUE ══════════
           *
           * Le flux NDJSON disparaît avec l'onglet du navigateur ; le backend
           * redémarre quand il se déploie lui-même. La seule trace qui survit
           * est celle qui a été persistée au fil de l'eau — et jusqu'ici elle
           * était écrite en `void`, donc sans que personne ne sache si elle
           * l'avait été.
           *
           * Deux régimes, séparés par la frontière de publication :
           *
           *   AVANT — l'écriture est CRITIQUE. Son échec est mémorisé et la
           *   barrière, interrogée juste avant le transfert, refusera de
           *   publier. On ne modifie pas la production sans pouvoir l'écrire.
           *
           *   APRÈS — l'écriture reste tentée mais son échec n'arrête rien :
           *   le monde a déjà changé, et s'arrêter ne le défait pas. La perte
           *   de durabilité devient un FAIT porté par le rapport.
           *
           * L'événement est mis en FILE plutôt qu'attendu ici : `onEvent` est
           * appelé de façon synchrone par le moteur, et l'attendre dans ce
           * rappel inverserait l'ordre des écritures.
           */
          const patch = {
            stepId: evt.stepId,
            label: evt.label ?? null,
            status: statut,
            publicMessage: evt.publicMessage ?? null,
            technicalMessage: evt.technicalMessage ?? null,
            errorCode: evt.errorCode ?? evt.error?.code ?? null,
            durationMs: evt.durationMs ?? null,
            /**
             * LES DÉTAILS DU DIAGNOSTIC — persistés, pas seulement diffusés.
             *
             * Le run du 07/08 00:34 ne gardait que « en ligne mais n'écoute
             * pas sur 5002 » : ni PID, ni chemin, ni ports observés, ni
             * journaux du service. Tout cela existait dans l'erreur du moteur
             * et se perdait au bord du flux. Le sanitizer du journal s'applique
             * ensuite, comme à toute entrée.
             */
            details: evt.details ?? evt.error?.details ?? null,
          };
          journalEtapes.enqueue(patch);
        }
      },
      options: {
        /**
         * LA RÉPONSE À LA BARRIÈRE — c'est l'application qui la donne, parce
         * que c'est elle qui écrit. Le moteur ne fait que poser la question au
         * seul instant où elle est encore utile : avant la première commande
         * qui change ce que voit le public.
         *
         * Elle est fournie comme les autres ports applicatifs du moteur
         * (`runtimeConfigSync`, `resolveUploadsSources`) : par `options`, et
         * jamais par une variable d'environnement ou un drapeau de test.
         */
        assertDurable: () => journalEtapes.assertDurable(),

        targetId,
        targetName: target.name,
        operationType,
        preflightOnly,
        remoteRoot: target.remoteRoot,
        backendPort: target.backendPort,
        env,
        email,
        remoteEnv: resolvedRemoteEnv, // config .env RÉSOLUE côté serveur (JAMAIS le remoteEnv brut du body)
        runtimeConfigSync: syncRuntimeNetworkConfiguration, // écrit les URLs HTTPS dans la base de la destination
        // Le moteur ne cherche JAMAIS de source de médias : elle lui est fournie,
        // tirée de l'historique des emplacements de CE projet.
        resolveUploadsSources: preflightOnly ? undefined : resolveUploadsSources,

        /**
         * REGISTRE DES PORTS — opposé juste AVANT le démarrage du service.
         *
         * Le moteur sait ce que le SERVEUR dit d'un port (sockets, process
         * PM2). Il ignore quelle AUTRE destination l'a réservé, depuis quand,
         * pour quel projet. C'est cette information qui manquait le jour où un
         * port a été réattribué alors qu'un ancien service le détenait encore.
         */
        beforeServiceStart: preflightOnly ? undefined : async ({ transport, pm2Name }) => {
          /**
           * ÉTAT AVANT, puis MARQUEUR DE REPRISE — dans cet ordre.
           *
           * Le backend redémarre parfois SA PROPRE application : la ligne qui
           * suit peut être la dernière que ce process exécute. Tout ce qui doit
           * survivre est donc écrit AVANT, jamais après.
           */
          const avant = await journalPm2Before(runId, transport, {
            processName: pm2Name, port: target.backendPort,
          });
          etatPm2Avant = avant;

          await journal(runId, {
            source: SOURCES.PM2, level: LEVELS.WARNING,
            eventCode: EVENTS.APPLICATION_RESTART_EXPECTED,
            stepId: 'pm2', processName: pm2Name, port: target.backendPort,
            message: 'Redémarrage du service imminent. Si ce backend sert l’interface, '
              + 'la connexion va être coupée : c’est attendu, pas une panne.',
            details: { expectedProcessName: pm2Name, expectedPort: target.backendPort },
          });
          await ecrireMarqueurReprise({
            runId, targetId, operation: operationType,
            nextExpectedStep: 'health', expectedProcessName: pm2Name, expectedPort: target.backendPort,
          });
          // Le frontend doit savoir AVANT la coupure, sinon il l'interprète
          // comme une erreur serveur générique.
          writeSeq({
            type: 'backend_restarting',
            message: 'Redémarrage du serveur…',
            runId, expectedProcessName: pm2Name, expectedPort: target.backendPort,
          });

          await journal(runId, {
            source: SOURCES.PM2, level: LEVELS.INFO, eventCode: EVENTS.PM2_RESTART_REQUESTED,
            stepId: 'pm2', processName: pm2Name, port: target.backendPort,
            message: `Redémarrage de « ${pm2Name} » demandé.`,
          });

          const verdict = await ports.verifyBeforeStart({ target, transport, expectedPm2Name: pm2Name });
          writeSeq({
            type: 'deployment.port_verified',
            message: `Port ${verdict.port} vérifié juste avant démarrage : `
              + `${verdict.free ? 'libre' : 'détenu par notre propre service'}.`,
          });
        },

        /**
         * ACTIVATION — après la preuve rendue par le moteur : process en
         * ligne, stable, PID connu, port écouté par CE pid. Un port n'est
         * déclaré « actif » qu'à ce moment, jamais sur un `pm2 start` qui
         * rend 0.
         */
        afterServiceStarted: preflightOnly ? undefined : async (info) => {
          await ports.activateReservation(String(target._id), {
            pid: info.pid ?? null, processName: info.name ?? null,
          });
          /**
           * ÉTAT APRÈS — et la PREUVE que le port nous appartient.
           *
           * Un `pm2 restart` qui rend 0 ne prouve rien : c'est ainsi qu'un
           * ancien service a pu conserver un port pendant que le nouveau
           * bouclait sur EADDRINUSE. On relit donc les sockets réelles.
           */
          await journalPm2After(runId, info.transport ?? null, {
            processName: info.name ?? null, port: target.backendPort, avant: etatPm2Avant,
          }, write);
          await effacerMarqueurReprise(runId).catch(() => null);
        },

        /**
         * REPRISE DES MÉDIAS EXISTANTS — exécutée SUR la destination.
         *
         * ── POURQUOI PAS ICI ────────────────────────────────────────────────
         * Le parc historique n'existe que dans le `shared/uploads` de la
         * destination : le poste qui déploie n'a qu'un `.gitkeep`. Conduire la
         * reprise depuis ce process inventorierait du vide et conclurait qu'il
         * n'y a rien à reprendre — ce qui s'est exactement produit.
         *
         * On exécute donc le script du backend FRAÎCHEMENT DÉPLOYÉ : il lit son
         * propre `.env`, sa base, et le dossier où sont les octets. Aucun
         * fichier ne remonte, aucun disque local n'est lu.
         *
         * ── UN CONFLIT ARRÊTE LE DÉPLOIEMENT ────────────────────────────────
         * Si une fiche porte déjà un autre descripteur que celui qu'elle cite,
         * personne d'autre qu'un humain ne peut trancher. Le script sort en 2,
         * n'écrit rien, et l'étape échoue avec le rapport.
         */
        adoptApplicationMedia: preflightOnly ? undefined : async ({ transport, backendDir, host }) => {
          const { runRemoteProjectMediaAdoption } =
            await import('../services/media/projectMediaAdoption.service.js');
          const issue = await runRemoteProjectMediaAdoption({ transport, backendDir });

          if (!issue.ok) {
            const { DeploymentError } = await import('../deployment-engine/errors.js');
            throw new DeploymentError(issue.code, issue.message, {
              step: 'project_media_adopt',
              details: {
                conflicts: issue.report?.conflicts?.slice(0, 10) ?? null,
                tail: issue.report ? null : issue.tail,
              },
            });
          }

          const rapport = issue.report;
          if (rapport.created || rapport.attached) {
            writeSeq({
              type: 'deployment.media_adopted',
              message: `${rapport.created} média(s) existant(s) décrit(s), `
                + `${rapport.attached} fiche(s) raccrochée(s) sur ${host}.`,
            });
          }
          if (rapport.missing?.length) {
            writeSeq({
              type: 'deployment.warning',
              code: 'PROJECT_MEDIA_REFERENCE_WITHOUT_FILE',
              message: `${rapport.missing.length} référence(s) de fiche sans fichier sur la destination.`,
            });
          }
          return rapport;
        },

        /**
         * MÉDIAS DE CE PROJET — transférés puis PROUVÉS sur la destination.
         *
         * Une instance se configure AVANT d'être déployée : logo, bannières,
         * photos avant/après y sont importés alors qu'aucune destination ne
         * les sert. Sans cette étape, le premier déploiement mettait le site
         * en ligne avec des images absentes, et il fallait tout réimporter
         * depuis l'interface déployée.
         */
        publishApplicationMedia: preflightOnly ? undefined : async ({ transport, sharedUploads, host }) => {
          const { publishProjectMediaOnDestination } = await import('../services/media/projectMedia.service.js');
          const rapport = await publishProjectMediaOnDestination({
            transport, sharedUploads, host, environment: env,
          });
          if (rapport.transferred.length || rapport.published) {
            writeSeq({
              type: 'deployment.media_published',
              message: `${rapport.transferred.length} média(s) transféré(s), `
                + `${rapport.published} publié(s) sur ${host}.`,
            });
          }
          if (rapport.missing.length) {
            writeSeq({
              type: 'deployment.warning',
              code: 'PROJECT_MEDIA_MISSING',
              message: `${rapport.missing.length} média(s) introuvables : ils restent locaux.`,
            });
          }
          return rapport;
        },
        skipBuild,
        sshHost: target.sshHost,
        sshUser: target.sshUser,
        version,
        // Gestion DNS automatique (si Hostinger configuré et actif).
        dnsProvider: hz.available ? hz.provider : null,
        /**
         * PLUS AUCUN SECRET DNS À MASQUER (L9.2) — il n'y en a plus côté projet.
         * Le champ reste dans le contrat du moteur, qui accepte d'autres
         * fournisseurs ; il vaut `null`, et c'est un fait, pas un oubli.
         */
        dnsSecret: null,
        dnsTtl: 300,
        dnsNotConfiguredReason: hz.available ? null : hz.reason,
        // Le rapport doit dire PAR QUEL CHEMIN le DNS a été administré.
        dnsPath: hz.path ?? 'NONE',
        dnsResolutionOpts: { timeoutMs: 30_000, minIntervalMs: 3_000, maxIntervalMs: 10_000 },
      },
    });
  } catch (err) {
    // deployWithReport ne devrait pas lever (il capture) — garde-fou ultime.
    const apiErr = toApiError(err);
    result = {
      ok: false,
      status: 'error',
      finalStepId: 'deployment.initialize',
      version,
      steps: [],
      structuredReport: null,
      markdownReport: null,
      errorSummary: { code: apiErr.details?.code || 'UNEXPECTED', message: apiErr.message },
    };
    writeSeq({ type: 'deployment.failed', status: 'error', message: apiErr.message });
  }

  /**
   * ══ ON ATTEND LA FILE AVANT D'ÉCRIRE LE RAPPORT ═════════════════════════════
   *
   * Les transitions d'étapes sont écrites en série et en arrière-plan. Finaliser
   * sans les attendre laisserait une écriture d'étape arriver APRÈS la clôture
   * du run : le document se retrouverait `success` avec une étape encore
   * `running`, et la reprise des runs orphelins n'y verrait rien à corriger.
   */
  await journalEtapes.drain().catch(() => {});

  /**
   * ══ LA PERTE DE DURABILITÉ APRÈS PUBLICATION EST UN FAIT, PAS UN SILENCE ════
   *
   * Passé la bascule, une écriture perdue n'arrête plus rien — le monde a déjà
   * changé. Mais le rapport doit dire qu'il est INCOMPLET, sans quoi on relira
   * plus tard une timeline trouée en la croyant fidèle. Il est INTERDIT d'en
   * conclure que la release n'a pas été activée : elle l'a été.
   */
  const perteTardive = journalEtapes.lateFailure();
  if (perteTardive) {
    writeSeq({
      type: 'deployment.journal_incomplete',
      code: 'DEPLOYMENT_JOURNAL_INCOMPLETE',
      stepId: perteTardive.stepId,
      message: 'La version a bien été publiée, mais certaines étapes n’ont pas pu être enregistrées : '
        + 'la chronologie de ce run est incomplète. Vérifiez l’état réel du site avant toute relance.',
    });
  }

  /**
   * Persistance du rapport (TOUJOURS) — même pour un préflight échoué.
   *
   * Son échec N'EST PLUS avalé : c'est l'écriture qui clôt le run, et sans elle
   * le run reste `running` jusqu'à ce qu'un redémarrage le reprenne. Le dire
   * ici, dans le flux, est la seule occasion de le dire à quelqu'un.
   */
  let saved = null;
  let rapportPersiste = true;
  try {
    saved = await runs.finalizeRun(runId, {
      ...result,
      // La chronologie est-elle intacte ? Le run le portera, pour le prochain
      // lot de réconciliation comme pour la lecture humaine.
      journalComplete: !perteTardive,
      journalDegradedAtStepId: perteTardive?.stepId ?? null,
    });
  } catch (err) {
    rapportPersiste = false;
    writeSeq({
      type: 'deployment.report_not_persisted',
      code: 'DEPLOYMENT_REPORT_NOT_PERSISTED',
      message: 'L’opération est terminée sur le serveur, mais son rapport n’a pas pu être enregistré : '
        + `${String(err?.message || 'écriture refusée').slice(0, 200)}. `
        + 'Ce run restera « en cours » jusqu’au prochain démarrage ; fiez-vous à cet écran.',
    });
  }

  /**
   * L'ISSUE DE LA FINALISATION — déclarée ICI, où le rapport la lira.
   *
   * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────────
   * Ces deux variables vivaient à l'intérieur du bloc `if (!preflightOnly)`, et
   * étaient lues plus bas, hors de ce bloc. `let` étant à portée de bloc, la
   * lecture de `erreurFinalisation` levait une `ReferenceError` — dans TOUS les
   * cas, préflight comme déploiement, puisqu'elle est évaluée sans condition.
   * Le rapport terminal n'était donc jamais émis, `res.end()` jamais atteint :
   * le flux restait ouvert et l'interface tournait indéfiniment.
   *
   * Les remonter ne masque pas le défaut, il le supprime : ces valeurs décrivent
   * l'issue de la finalisation POUR LE RAPPORT, et leur place est celle du
   * rapport, pas celle de la tentative.
   *
   * ── LE CAS DU PRÉFLIGHT ─────────────────────────────────────────────────────
   * Un PRECHECK ne finalise aucune destination : il n'a rien à réussir de ce
   * côté. `true` dit « rien à faire, donc rien d'en attente » ; `false` aurait
   * annoncé un échec de finalisation là où aucune n'était due.
   */
  let finalise = preflightOnly;
  let erreurFinalisation = null;
  // Un préflight ne modifie pas l'état déployé de la cible.
  if (!preflightOnly) {
    /**
     * FINALISATION DE LA DESTINATION — son échec n'est PLUS avalé.
     *
     * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────
     * `.catch(() => {})` masquait l'unique écriture qui fait passer la
     * destination de « Publication… » à « En ligne ». Le 06/08, une
     * ValidationError sur un statut d'étape `warning` a donc laissé la
     * destination figée en DEPLOYING pendant que l'écran annonçait un succès :
     * deux vérités contradictoires, et aucune trace de la cause.
     *
     * L'échec est désormais transmis dans le flux et retire le succès : mieux
     * vaut un déploiement annoncé « à vérifier » qu'un succès qui ment.
     */
    try {
      await targets.recordDeployment(targetId, {
        pipeline: { steps: (result.steps || []).map((s) => ({ step: s.id, label: s.label, status: s.status, durationMs: s.durationMs })), failedStep: result.finalStepId },
        version: result.ok ? result.version : null,
        ok: result.ok,
        user: req.user?.email,
        durationMs: saved?.durationMs,
        error: result.errorSummary?.message || null,
      });
      finalise = true;
    } catch (err) {
      erreurFinalisation = err.message;
      writeSeq({
        type: 'deployment.finalization_failed',
        code: 'DEPLOYMENT_TARGET_NOT_FINALIZED',
        message: `La mise en ligne a abouti, mais l'état de la destination n'a pas pu être enregistré : ${err.message}. `
          + 'La destination reste affichée « en cours » : ne relancez pas, signalez cette ligne.',
      });
    }

    // EMPLACEMENT DU PROJET — n'est promu en source de migration que si le
    // déploiement a été VALIDÉ. Sinon il reste marqué en échec et ne servira
    // jamais de référence à une copie de médias.
    if (locationId) {
      try {
        if (result.ok) await identity.markLocationHealthy(locationId, { deploymentRunId: runId });
        else await identity.markLocationFailed(locationId);
      } catch { /* la trace d'emplacement ne doit jamais casser un déploiement */ }
    }

    // PLAN DE CONTRÔLE (P2.7) — active la release + HEALTHY (succès) ou FAILED.
    if (controlPlane) {
      try {
        const cpFinal = await finalizeControlPlaneDeployment({ ...controlPlane, result, runId });
        writeSeq({ type: 'control_plane.target.finalize', targetId: controlPlane.targetId, status: cpFinal?.status || null, healthStatus: cpFinal?.healthStatus || null });
      } catch (err) {
        writeSeq({ type: 'control_plane.warning', code: err.code || 'CONTROL_PLANE_FINALIZE_FAILED', message: 'Finalisation du plan de contrôle échouée.' });
      }
    }
  }

  /**
   * L'INVARIANT DU SUCCÈS.
   *
   *   SUCCÈS affiché  ⟺  run OK
   *                   ET destination DEPLOYED
   *                   ET aucun verrou actif
   *                   ET activeDeploymentRunId = null
   *
   * On le VÉRIFIE en relisant la destination, plutôt que de le déduire du
   * déroulé : c'est précisément parce qu'on avait déduit le succès d'un
   * pipeline vert, sans relire l'état persisté, qu'un écran de succès a pu
   * coexister avec une destination figée en « Publication… ».
   */
  let verdict = { finalized: true, checks: null, targetState: null, missing: [] };
  if (!preflightOnly && result.ok) {
    /**
     * L'INVARIANT DU SUCCÈS — vérifié, jamais déduit.
     *
     * On RELIT la destination et la réservation de port. C'est précisément
     * parce qu'on avait déduit le succès d'un pipeline vert, sans relire ce
     * qui avait été écrit, qu'un écran de succès a pu coexister avec une
     * destination figée en « Publication… ».
     */
    verdict = await verifyFinalization(runId, targetId).catch((err) => ({
      finalized: false, checks: null, targetState: null, missing: [err.message],
    }));
    if (!verdict.finalized) {
      writeSeq({
        type: 'deployment.not_finalized',
        code: 'DEPLOYMENT_TARGET_NOT_FINALIZED',
        state: verdict.targetState,
        lifecycleStatus: verdict.checks?.lifecycleStatus ?? null,
        message: 'Le déploiement a abouti sur le serveur, mais la destination n’a pas atteint son état final : '
          + `${verdict.missing.join(' ; ')}. Le diagnostic complet est dans le run.`,
      });
    }
  }

  writeSeq({
    type: 'deployment.report_ready',
    operationType,
    ok: result.ok,
    status: result.status,
    finalStepId: result.finalStepId,
    /* Le succès n'est annoncé QUE si l'état persistant le confirme. */
    finalized: preflightOnly ? true : (finalise && verdict.finalized),
    finalizationError: erreurFinalisation ?? (verdict.missing?.join(' ; ') || null),
    targetState: verdict.targetState,
    /**
     * DURABILITÉ DU RUN — annoncée séparément du succès de l'opération.
     *
     * Les confondre obligerait à choisir entre deux mensonges : déclarer
     * l'échec d'un déploiement qui a réussi, ou taire que sa trace est
     * lacunaire. Ce sont deux faits distincts, et ils sont rendus tels quels.
     */
    journalComplete: !perteTardive,
    reportPersisted: rapportPersiste,
  });
  clearActiveRun(runId);
  if (!clientGone) res.end();
}

/**
 * CEINTURE DE SÉCURITÉ DU FLUX — aucune exception ne le laisse ouvert.
 *
 * ── POURQUOI ELLE EXISTE ────────────────────────────────────────────────────
 * Express n'attend pas les gestionnaires `async` : une exception levée après
 * l'envoi des en-têtes ne produit ni réponse d'erreur, ni fin de flux. Elle
 * devient un rejet non géré, et le client reste suspendu sur une requête que
 * plus personne ne terminera. C'est ce qu'a produit la `ReferenceError` sur
 * `erreurFinalisation` : le rapport n'était pas émis, `res.end()` pas atteint,
 * et l'interface tournait sans fin sur « Connexion sécurisée au serveur ».
 *
 * Corriger cette variable suffisait à faire disparaître CE cas. Cette ceinture
 * traite la CLASSE : quelle que soit l'exception, le client reçoit un dernier
 * évènement explicite et le flux se ferme. Elle ne masque rien — l'erreur est
 * journalisée et le rejet reste visible ; elle garantit seulement qu'un défaut
 * serveur ne se traduit jamais par une attente éternelle côté opérateur.
 *
 * Elle ne peut pas changer le statut HTTP : les en-têtes sont déjà partis. Le
 * verdict métier voyage donc dans le DERNIER évènement NDJSON, que l'interface
 * traite comme terminal.
 */
async function fluxProtege(req, res, options) {
  try {
    return await streamOperation(req, res, options);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[deploiement] ${options.operationType} interrompu par une erreur serveur : ${err.stack ?? err.message}`);
    void journal(req.forensics?.runId ?? null, {
      source: SOURCES.HTTP,
      level: LEVELS.ERROR,
      eventCode: EVENTS.HTTP_REQUEST_FAILED,
      message: `Erreur serveur pendant ${options.operationType} : ${err.message}`,
      error: err,
      details: { headersSent: res.headersSent, operationType: options.operationType },
    });

    if (!res.headersSent) {
      return res.status(500).json({
        code: 'DEPLOYMENT_STREAM_FAILED',
        message: 'La vérification n’a pas pu être menée à son terme. Rien n’a été déployé.',
      });
    }
    // En-têtes déjà envoyés : on ne peut plus qu'être explicite dans le flux.
    if (!res.writableEnded) {
      try {
        res.write(`${JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'deployment.report_ready',
          operationType: options.operationType,
          ok: false,
          status: 'error',
          errorCode: 'DEPLOYMENT_STREAM_FAILED',
          message: 'L’opération a été interrompue par une erreur serveur. '
            + 'Rien n’a été déployé ; le rapport technique en conserve le détail.',
        })}
`);
      } catch { /* le client est déjà parti : il n'y a plus personne à prévenir */ }
      res.end();
    }
    return undefined;
  }
}

/** POST /deployment/deploy/stream — déploiement complet (DEPLOYMENT). */
export async function deployStream(req, res) {
  return fluxProtege(req, res, { operationType: 'DEPLOYMENT', preflightOnly: false });
}

/**
 * POST /deployment/preflight/stream — préflight de première classe (PRECHECK).
 * Produit exactement les mêmes artefacts qu'un déploiement (checklist live,
 * logs, rapport persisté, historique) ; s'arrête avant l'upload.
 */
export async function preflightStream(req, res) {
  return fluxProtege(req, res, { operationType: 'PRECHECK', preflightOnly: true });
}

/* --------------------------- Rapports / historique --------------------------- */

export const listRuns = asyncHandler(async (req, res) => {
  const targetId = req.query.targetId || undefined;
  return ok(res, await runs.listRuns({ targetId }));
});

export const getRun = asyncHandler(async (req, res) => {
  const doc = await runs.getRunOr404(req.params.id);
  return ok(res, runs.serializeRunFull(doc));
});

/**
 * `GET /deployment/runs/active` — Y A-T-IL UN DÉPLOIEMENT EN COURS ?
 *
 * ══ LA QUESTION QUE L'ÉCRAN NE POUVAIT PAS POSER ═══════════════════════════
 *
 * Le suivi vivait entièrement dans la page React : les étapes s'accumulaient
 * dans un `useState` alimenté par le flux, et le `runId` n'était connu qu'après
 * réception d'un événement. Quitter l'écran coupait le flux (`AbortController`)
 * et jetait l'état — alors que le run, lui, continuait côté serveur et
 * s'écrivait dans la base à chaque étape.
 *
 * L'utilisateur revenait donc sur un écran vide, avec un bouton « Déployer »
 * réarmé, devant un déploiement bien vivant qu'il ne voyait plus. Rien n'était
 * perdu — RIEN N'ÉTAIT DEMANDÉ.
 *
 * ── DEUX RÉPONSES, ET IL FAUT LES DEUX (§27) ───────────────────────────────
 *
 *   `active`  le run à REPRENDRE. Absent la plupart du temps, et c'est normal.
 *   `latest`  le dernier run, quel qu'en soit le sort. Il sert à montrer un
 *             résultat récent — jamais à reprendre quoi que ce soit.
 *
 * Les confondre ferait présenter l'échec d'hier comme un déploiement en cours.
 */
export const getActiveRun = asyncHandler(async (req, res) => {
  const targetId = typeof req.query?.targetId === 'string' ? req.query.targetId : null;
  const operationType = typeof req.query?.operationType === 'string' ? req.query.operationType : null;

  const [actif, dernier] = await Promise.all([
    runs.findActiveRun({ targetId, operationType }),
    runs.findLatestRun({ targetId, operationType }),
  ]);

  return ok(res, {
    active: Boolean(actif),
    run: runs.serializeRunSnapshot(actif),
    latest: runs.serializeRunSnapshot(dernier),
  });
});

/**
 * `GET /deployment/runs/:id/observe` — OBSERVER, SANS RIEN DÉCLENCHER.
 *
 * ══ POURQUOI UNE SECONDE SURFACE PLUTÔT QUE DE REBRANCHER `/deploy/stream` ══
 *
 * `/deploy/stream` DÉMARRE un déploiement : la requête HTTP est l'acte métier.
 * S'y reconnecter pour « reprendre le suivi » lancerait un second run — soit
 * exactement l'accident que ce lot existe pour rendre impossible.
 *
 * La lecture et l'écriture sont donc deux verbes distincts, et cette route ne
 * sait que lire. Elle ne touche ni le moteur, ni le verrou de destination, ni
 * le plan de contrôle.
 *
 * ══ POURQUOI ON RELIT LA BASE PLUTÔT QUE DE S'ABONNER AU MOTEUR ════════════
 *
 * Le moteur écrit CHAQUE transition d'étape en base au moment où elle arrive
 * (`recordStep` → `updateOne`). La base est donc déjà le journal vivant du run.
 *
 * Un bus d'événements en mémoire serait plus « temps réel » et strictement pire
 * ici : il ne survivrait pas au redémarrage du backend, ne servirait pas un
 * second onglet arrivé en retard, et introduirait une seconde source de vérité
 * à tenir d'accord avec la première. Relire l'autorité coûte une requête par
 * seconde et ne peut pas diverger.
 *
 * ── LA COURSE INSTANTANÉ/FLUX EST FERMÉE PAR CONSTRUCTION (§10) ────────────
 *
 * L'instantané initial et les mises à jour suivantes sortent de la MÊME
 * lecture, dans le même ordre. Il n'existe aucune fenêtre entre « je lis
 * l'état » et « je m'abonne » — puisqu'il n'y a pas d'abonnement.
 */
export async function observeRun(req, res) {
  const doc = await runs.getRunOr404(req.params.id);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const runId = String(doc._id);
  let clientParti = false;
  /**
   * LE DÉPART DE L'OBSERVATEUR N'EST PAS UNE ANNULATION (§17, §36).
   *
   * On note, on ferme la boucle de lecture, et c'est tout. Aucun signal n'est
   * envoyé au moteur : quitter la page, fermer l'onglet, perdre le réseau ou
   * rafraîchir ne sont pas des demandes d'annulation, et ce code n'a aucun
   * moyen de les confondre avec une — il n'en possède pas.
   */
  req.on('close', () => {
    clientParti = true;
    logger.info(`[deployment] observer disconnected run ${runId} — job continues`);
  });

  const ecrire = (obj) => {
    if (clientParti) return false;
    try { res.write(`${JSON.stringify(obj)}\n`); res.flush?.(); return true; }
    catch { clientParti = true; return false; }
  };

  logger.info(`[deployment] observer attached run ${runId}`);

  /** 1. L'INSTANTANÉ COMPLET — l'écran est reconstruit avant tout événement. */
  let dernier = runs.serializeRunSnapshot(doc);
  ecrire({ type: 'run.snapshot', snapshot: dernier });

  /** 2. LES ÉCARTS, tant que le run vit et que quelqu'un regarde. */
  const INTERVALLE_MS = 1000;
  const PLAFOND_MS = 60 * 60 * 1000; // un run ne s'observe pas indéfiniment
  const debut = Date.now();

  while (!clientParti && dernier?.active && Date.now() - debut < PLAFOND_MS) {
    await new Promise((r) => { setTimeout(r, INTERVALLE_MS).unref?.(); });
    if (clientParti) break;

    const instantane = await runs.readRunSnapshot(runId);
    if (!instantane) break;
    /**
     * ON N'ÉMET QUE SI QUELQUE CHOSE A BOUGÉ.
     *
     * `revision` est dérivée de l'état lui-même. Émettre à chaque tic
     * remplirait la console d'un observateur silencieux et ferait passer une
     * absence de progrès pour de l'activité.
     */
    if (instantane.revision !== dernier.revision) {
      dernier = instantane;
      ecrire({ type: 'run.snapshot', snapshot: instantane });
    }
  }

  /**
   * 3. LA FIN — dite explicitement, même si le run était DÉJÀ terminé à
   * l'ouverture (§14). Un observateur qui rebranche après coup reçoit son
   * instantané final et une fermeture propre, jamais un flux qui pend.
   */
  if (!clientParti) {
    ecrire({ type: 'run.closed', status: dernier?.status ?? 'unknown', snapshot: dernier });
    logger.info(`[deployment] observer detached run ${runId} — status=${dernier?.status}`);
    res.end();
  }
  return undefined;
}

/**
 * GET /deployment/dns-status?hostname= — la gestion DNS est-elle utilisable ?
 *
 * ── CE QUE CETTE ROUTE NE LIT PLUS ──────────────────────────────────────────
 *
 * Le credential Hostinger du projet. Elle rendait `configured` / `verified` sur
 * la clé LOCALE, et l'assistant de déploiement en faisait un garde-fou : un
 * projet sans clé locale — l'état cible depuis L9.2 — s'y voyait refuser la
 * publication d'un domaine que le Panel sait parfaitement administrer.
 *
 * Elle pose désormais la même question que le déploiement, au même endroit.
 * Sans `hostname`, elle répond ce qu'elle peut : l'appairage.
 */
export const getDnsStatus = asyncHandler(async (req, res) => ok(res, await diagnoseDnsAutomation({
  hostname: typeof req.query?.hostname === 'string' ? req.query.hostname.trim().toLowerCase() : null,
  invoke: capabilitiesAvailable() ? invokeCapability : null,
})));

/**
 * LE CONTRAT D'ÉTAPES DE DÉPLOIEMENT — la projection publique du REGISTRE.
 *
 * ── POURQUOI L'INTERFACE LA DEMANDE PLUTÔT QUE DE LA RECOPIER ─────────────
 *
 * Elle en tenait TROIS copies : la checklist du déploiement, celle du
 * préflight (avec des libellés divergents pour les mêmes identifiants), et une
 * table indexée par les identifiants BRUTS du pipeline. Chacune écrite à la
 * main, dans un autre dépôt que le moteur. L'une d'elles avait déjà dérivé —
 * `dns.manager` renommé en `dns.apps` côté moteur, et une ligne d'écran
 * attendait pour toujours un événement qui n'arrivait plus.
 *
 * Cette route n'expose que ce que le registre déclare. Aucune commande, aucun
 * chemin, aucun diagnostic : une définition d'étape ne doit rien apprendre à
 * qui la lit sur l'infrastructure qui l'exécute.
 */
export const deploymentPhases = asyncHandler(async (req, res) => {
  const { describeDeploymentSteps } = await import('../deployment-engine/steps.js');
  return ok(res, describeDeploymentSteps());
});

/* ------------------------------ Duplication ----------------------------- */

/**
 * Le contrat de phases, tel que le registre le déclare. Une lecture pure : la
 * définition ne dépend ni d'une exécution en cours ni d'un état de projet.
 */
export const duplicationPhases = asyncHandler(async (req, res) => {
  const { describeDuplicationPhases } = await import('../duplication-engine/config/duplication.phases.js');
  return ok(res, describeDuplicationPhases());
});


export const duplicate = asyncHandler(async (req, res) => {
  const logs = [];
  try {
    const result = await engine.duplicate(req.body, {
      stamp: nowStamp(),
      onLog: (m) => logs.push(m),
    });
    return created(res, { ...result, logs });
  } catch (err) {
    throw toApiError(err);
  }
});

/**
 * POST /deployment/duplicate/stream — duplication en flux NDJSON.
 * Émet des phases nommées (mongo, databases, copy, config, discover,
 * dependencies, validate, done) puis un résultat final. Permet un écran de
 * progression premium sans logs bruts.
 */
export async function duplicateStream(req, res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let clientGone = false;
  const markClientGone = () => { clientGone = true; };
  req.on?.('close', markClientGone);
  req.on?.('aborted', markClientGone);
  res.on?.('close', markClientGone);
  res.on?.('error', markClientGone);
  const write = (obj) => {
    if (clientGone || res.writableEnded) return false;
    try {
      res.write(`${JSON.stringify(obj)}\n`);
      res.flush?.();
      return true;
    } catch {
      clientGone = true;
      return false;
    }
  };
  const logs = [];
  try {
    const result = await engine.duplicate(req.body, {
      stamp: nowStamp(),
      onLog: (m) => logs.push(m),
      onPhase: (evt) => write({ type: 'phase', ...evt }),
    });
    write({ type: 'result', ...result, logs });
    if (!clientGone && !res.writableEnded) res.end();
  } catch (err) {
    const apiErr = toApiError(err);
    const details = apiErr.details && typeof apiErr.details === 'object' ? apiErr.details : {};
    write({ type: 'error', code: details.code || 'ERROR', message: apiErr.message });
    if (!clientGone && !res.writableEnded) res.end();
  }
}

/* -------------------------------- Backup -------------------------------- */

export const backup = asyncHandler(async (req, res) => {
  const target = await targets.getTargetOr404(req.body.targetId);
  try {
    const result = await engine.backup({
      url: target.url,
      sessionId: req.body.sessionId,
      dbName: target.dbName,
      version: target.currentVersion,
      stamp: nowStamp(),
      remoteRoot: target.remoteRoot,
    });
    return ok(res, result);
  } catch (err) {
    throw toApiError(err);
  }
});

export const restore = asyncHandler(async (req, res) => {
  const target = await targets.getTargetOr404(req.body.targetId);
  try {
    const result = await engine.restore({
      url: target.url,
      sessionId: req.body.sessionId,
      dbName: target.dbName,
      archive: req.body.archive,
      remoteRoot: target.remoteRoot,
    });
    return ok(res, result);
  } catch (err) {
    throw toApiError(err);
  }
});

export const listBackups = asyncHandler(async (req, res) => {
  const target = await targets.getTargetOr404(req.params.id);
  // La session VPS passe en query pour un GET.
  const sessionId = req.query.sessionId;
  if (!sessionId) throw ApiError.badRequest('Session VPS requise (query sessionId).');
  try {
    const archives = await engine.listBackups({ url: target.url, sessionId });
    return ok(res, { archives });
  } catch (err) {
    throw toApiError(err);
  }
});
