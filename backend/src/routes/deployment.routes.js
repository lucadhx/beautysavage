import { Router } from 'express';
import * as ctrl from '../controllers/deployment.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { ROLES } from '../utils/constants.js';
import { traceDeploymentErrors, traceDeploymentRequests } from '../services/deployment/forensics/httpTrace.js';
import * as forensics from '../services/deployment/forensics/restartForensics.js';
import {
  createTargetSchema,
  idParam,
  vpsSessionSchema,
  sessionIdParam,
  preflightSchema,
  deploySchema,
  duplicateSchema,
  backupSchema,
  restoreSchema,
} from '../validators/deployment.validator.js';

const router = Router();

// Moteur de déploiement : DEV UNIQUEMENT (opérations d'infrastructure sensibles).
router.use(authenticate, authorize(ROLES.DEV));

/**
 * TRACE FORENSIQUE — montée AVANT toute route.
 *
 * Elle ouvre une trace dès la première ligne de la requête, donc AVANT que le
 * run n'existe. C'est ce qui rend diagnosticable un HTTP 500 survenu avant
 * `createRun` — le cas qui, le 06/08, n'avait laissé aucune trace.
 */
router.use(traceDeploymentRequests());

/**
 * TRACE FORENSIQUE DE L'ÉTAPE « CONNEXION AU SERVEUR » — passive.
 *
 * Elle n'inscrit un appel QUE lorsqu'une session de diagnostic est armée (le
 * clic « Suivant » de cette étape l'arme lui-même). Hors de cette fenêtre, ce
 * middleware ne fait rien : pas de journal, pas de coût.
 *
 * Elle note la MÉTHODE et le CHEMIN. Jamais le corps, jamais un en-tête : le
 * mot de passe VPS et le jeton de session traversent précisément ces requêtes.
 */
router.use((req, _res, next) => {
  try { forensics.noterHttp(req.method, req.originalUrl ?? req.url); } catch { /* jamais bloquant */ }
  next();
});

// Version courante du projet (SHA git).
router.get('/version', ctrl.getVersion);

// Sessions VPS (mot de passe en RAM, jamais persisté).
router.post('/vps-session', validate(vpsSessionSchema), ctrl.openVpsSession);
router.get('/vps-session/:sessionId', validate(sessionIdParam), ctrl.describeVpsSession);
router.delete('/vps-session/:sessionId', validate(sessionIdParam), ctrl.closeVpsSession);

// Cibles de déploiement.
router.get('/targets', ctrl.listTargets);
router.post('/targets', validate(createTargetSchema), ctrl.createTarget);
/**
 * SUPPRESSION — en POST, et non en DELETE.
 *
 * Elle exige désormais un CORPS : le nom d'hôte saisi par l'opérateur. Un
 * `DELETE` sans corps ne peut pas porter cette confirmation, et c'est
 * précisément l'absence de confirmation qui a permis de supprimer la fiche
 * d'une destination encore en ligne.
 */
router.post('/targets/:id/delete', validate(idParam), ctrl.deleteTarget);

/**
 * RETRAIT DU DÉPLOIEMENT — l'opération inverse du déploiement.
 *
 * `inspect` lit l'état RÉEL du serveur ; `deprovision/stream` exécute. Les
 * deux sont séparés parce qu'on ne fait pas confirmer une destruction sans
 * montrer d'abord ce qui sera détruit.
 */
router.post('/targets/:id/inspect', validate(idParam), ctrl.inspectTarget);
router.post('/deprovision/stream', ctrl.deprovisionStream);
// La SUPPRESSION définitive est une opération à part entière : elle lève la
// quarantaine 410 puis oublie la fiche, avec run, checklist et rapport.
router.post('/destination-delete/stream', ctrl.destinationDeleteStream);

router.get('/targets/:id/backups', validate(idParam), ctrl.listBackups);

// Exécutions / rapports (historique). ?targetId= pour filtrer.
router.get('/runs', ctrl.listRuns);
/**
 * ══ `/runs/active` AVANT `/runs/:id` — L'ORDRE EST LA GARDE ════════════════
 *
 * Express résout dans l'ordre de déclaration. Placée après, cette route serait
 * captée par `/runs/:id`, qui exigerait un ObjectId et répondrait 400 sur le
 * mot « active » — une panne d'autant plus désagréable qu'elle ressemblerait à
 * un défaut de données.
 */
router.get('/runs/active', ctrl.getActiveRun);
router.get('/runs/:id', validate(idParam), ctrl.getRun);
/**
 * OBSERVER UN RUN — en LECTURE seule, et c'est tout le point.
 *
 * `POST /deploy/stream` DÉMARRE un déploiement : s'y reconnecter pour reprendre
 * un suivi en lancerait un second. La reprise passe donc par un verbe distinct,
 * en GET, qui ne peut rien déclencher — l'incapacité est dans la route, pas
 * dans la discipline de l'appelant.
 */
router.get('/runs/:id/observe', validate(idParam), ctrl.observeRun);

/**
 * État de la gestion DNS automatique — pour l'UX avant publication.
 *
 * Nommée par la FONCTION, plus par le fournisseur : le projet ne sait pas, et
 * n'a plus à savoir, qui administre ses domaines. C'est le Panel qui le décide,
 * et le nom de la route ne doit pas ressusciter une dépendance supprimée.
 */
router.get('/dns-status', ctrl.getDnsStatus);

// Préflight (bloquant avant tout déploiement).
router.post('/preflight', validate(preflightSchema), ctrl.preflight);
// Préflight de PREMIÈRE CLASSE (PRECHECK) : checklist live + rapport persisté.
router.post('/preflight/stream', validate(deploySchema), ctrl.preflightStream);

/**
 * DÉPLOIEMENT — UNE SEULE PORTE, et c'est une suppression.
 *
 * `POST /deploy` (réponse unique) vivait juste ici. Elle appelait
 * `engine.deploy()` directement : sans run durable, sans barrière de
 * publication, sans journal forensique, et en posant le verrou de destination à
 * `null` — donc sans verrouiller. Zéro appelant, et une porte dérobée sur la
 * production. Voir le contrôleur pour le détail.
 *
 * Toute nouvelle route de déploiement doit passer par `deployStream` : la garde
 * `deployment-entrypoints.test.js` échoue si une seconde apparaît.
 */
router.post('/deploy/stream', validate(deploySchema), ctrl.deployStream);

// Duplication du projet courant.
/**
 * LE CONTRAT D'ÉTAPES DE DÉPLOIEMENT — lecture pure du registre canonique.
 * L'interface en dérive ses DEUX checklists (déploiement et préflight) au lieu
 * d'en recopier deux.
 */
router.get('/phases', ctrl.deploymentPhases);

/**
 * LE CONTRAT DE PHASES — la projection publique du REGISTRE canonique.
 *
 * ── POURQUOI LE MANAGER LA DEMANDE PLUTÔT QUE DE LA RECOPIER ───────────────
 *
 * Il en tenait sa propre copie, écrite à la main, avec les sous-projets Node
 * en dur. Elle a dérivé — des lignes attendaient un événement qui n'arrivait
 * plus. Deux tableaux entretenus par des humains dans deux dépôts finissent
 * toujours ainsi.
 *
 * Cette route n'expose que ce que le registre déclare : identifiant, ordre,
 * libellé, groupe, caractère dynamique et obligatoire. Aucun secret, aucun
 * état d'exécution — l'état vit dans le flux, la définition vit ici.
 */
router.get('/duplication/phases', ctrl.duplicationPhases);
router.post('/duplicate', validate(duplicateSchema), ctrl.duplicate);
// Variante en flux NDJSON : phases nommées en direct.
router.post('/duplicate/stream', validate(duplicateSchema), ctrl.duplicateStream);

// Backup / restauration.
router.post('/backup', validate(backupSchema), ctrl.backup);
router.post('/restore', validate(restoreSchema), ctrl.restore);

/**
 * TRACE DES ERREURS — montée APRÈS les routes.
 *
 * Elle enregistre l'exception là où elle a encore sa pile et son contexte,
 * puis relaie au traitement d'erreur habituel. Sans elle, un 500 n'arrivait
 * qu'au middleware global, qui ne sait rien du run ni de la requête.
 */
router.use(traceDeploymentErrors());

export default router;
