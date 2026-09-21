/**
 * Persistance des exécutions de déploiement (DeploymentRun).
 *
 * Source de vérité d'une tentative : création à l'ouverture, finalisation
 * (succès/échec/interruption) avec rapport. Un run reste consultable après
 * rechargement/redémarrage. Finalisation des runs orphelins au démarrage.
 */
import { DeploymentRun } from '../models/DeploymentRun.model.js';
import { publicationVerdict } from '../deployment-engine/steps.js';
import { ApiError } from '../utils/ApiError.js';

/** Crée un run en statut « running ». */
export async function createRun({ target, user, version, operationType = 'DEPLOYMENT' }) {
  const managerHost = `manager.${target.host}`;
  /**
   * ══ L'ENVIRONNEMENT DU RUN EST CELUI DE SA DESTINATION ════════════════════
   *
   * Il valait `'PROD'` en dur, pour TOUS les runs. Sur un parc où une seule
   * destination existait, la constante avait l'air d'une constante ; c'est un
   * FAIT, et il appartient à la destination — laquelle le porte déjà, exigé et
   * sans valeur par défaut depuis que « un clic de trop publiait en production ».
   *
   * Ce que la valeur en dur produisait : un journal forensique qui affirme
   * « PROD » sur un déploiement de recette. Rien ne casse — personne ne DÉCIDE
   * d'après ce champ, il est écrit puis relu par les écrans d'historique — et
   * c'est précisément ce qui rend le défaut durable : le premier incident
   * examiné des mois plus tard le sera sur un journal qui se trompe
   * d'environnement, et l'enquête partira du mauvais côté.
   */
  const environnement = String(target.environment || 'PROD').toUpperCase();
  return DeploymentRun.create({
    target: target.id || target._id,
    targetName: target.name,
    operationType,
    siteUrl: target.url,
    siteHost: target.host,
    managerHost,
    managerUrl: `https://${managerHost}`,
    sshHost: target.sshHost || null,
    sshUser: target.sshUser || 'root',
    env: environnement,
    status: 'running',
    startedAt: new Date(),
    // Qui exécute. Relu au démarrage suivant pour savoir si ce run a encore
    // quelqu'un derrière lui, ou s'il est resté seul.
    executorPid: process.pid,
    version: version || null,
    commitSha: version || null,
    user: user || null,
  });
}

/** Finalise un run avec le résultat + le rapport. Toujours appelé (succès ou échec). */
export async function finalizeRun(runId, result) {
  const doc = await DeploymentRun.findById(runId);
  if (!doc) return null;
  const finishedAt = new Date();
  doc.status = result.status || (result.ok ? 'ok' : 'error');
  doc.finalStepId = result.finalStepId || null;
  doc.currentStepId = null;
  doc.finishedAt = finishedAt;
  doc.durationMs = finishedAt - doc.startedAt;
  // Étapes légères (sans execs — le détail complet vit dans structuredReport).
  doc.steps = (result.steps || []).map((s) => ({
    id: s.id,
    label: s.label,
    order: s.order,
    status: s.status,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    durationMs: s.durationMs,
    publicMessage: s.publicMessage,
    technicalMessage: s.technicalMessage,
    errorCode: s.errorCode,
    retryable: s.retryable,
    critical: s.critical,
    warnings: s.warnings || [],
  }));
  /**
   * LA PUBLICATION EST DÉDUITE DES ÉTAPES, JAMAIS DU VERDICT GLOBAL.
   *
   * Un run `error` peut parfaitement avoir publié — c'est même le cas qui
   * compte. Lire `result.ok` pour en décider reviendrait à réécrire l'histoire
   * dans le sens le plus rassurant, ce que ce champ existe précisément pour
   * empêcher.
   */
  const verdict = publicationVerdict(result.steps || []);
  doc.publication = {
    state: verdict.state,
    boundaryStepId: verdict.boundaryStepId,
    journalComplete: result.journalComplete !== false,
    degradedAtStepId: result.journalDegradedAtStepId ?? null,
  };

  doc.structuredReport = result.structuredReport || null;
  doc.markdownReport = result.markdownReport || null;
  doc.errorSummary = result.errorSummary || null;
  doc.warnings = (result.structuredReport?.warnings || []).map((w) => w.message).slice(0, 100);
  doc.version = result.version || doc.version;
  /**
   * LE RÉSUMÉ DIT CE QUI S'EST PASSÉ — pas ce qu'un déploiement aurait fait.
   *
   * Il n'existait qu'en deux versions : « Publié : <url> » ou « Vérification
   * échouée ». Un retrait réussi héritait donc de la première, et l'historique
   * annonçait une publication à l'endroit exact où un serveur venait d'être
   * vidé. Chaque opération nomme désormais son propre succès.
   */
  const SUCCES = {
    PRECHECK: () => 'Toutes les vérifications sont OK',
    DEPROVISION: () => `Destination vidée : ${doc.siteHost}`,
    DESTINATION_DELETE: () => `Fiche supprimée : ${doc.siteHost}`,
    ROLLBACK: () => `Version précédente rétablie : ${doc.siteUrl}`,
  };
  const ECHEC = {
    PRECHECK: 'Vérification échouée',
    DEPROVISION: 'Retrait interrompu',
    DESTINATION_DELETE: 'Suppression refusée',
  };
  const type = doc.operationType || 'DEPLOYMENT';
  doc.summary = result.ok
    ? (SUCCES[type] ?? (() => `Publié : ${doc.siteUrl}`))()
    : `${ECHEC[type] ?? 'Échec'} à l'étape « ${result.finalStepId || '?'} » : ${result.errorSummary?.message || ''}`.trim();
  try {
    await doc.save();
    return doc;
  } catch (err) {
    /**
     * ══ SI LE RAPPORT COMPLET NE PASSE PAS, LE VERDICT DOIT PASSER ══════════
     *
     * `save()` écrit tout d'un bloc : rapport structuré, markdown, journal,
     * étapes. Un seul de ces champs suffit à faire refuser l'écriture — un
     * document trop gros, un statut d'étape hors énumération — et le run reste
     * alors `running` POUR TOUJOURS, avec un écran qui tourne sur une opération
     * terminée depuis longtemps. C'est arrivé le 06/08.
     *
     * On retente donc l'ESSENTIEL, par opérateurs atomiques et sans les champs
     * volumineux : de quoi clore le run et dire ce qui s'est passé. Un run clos
     * sans son rapport reste lisible ; un rapport parfait jamais écrit ne l'est
     * pas. Ce n'est pas un second stockage — c'est la même base, moins de
     * champs.
     *
     * Si cette écriture-là échoue aussi, l'erreur est propagée : l'appelant en
     * informe l'utilisateur, et la reprise des runs orphelins fermera le run au
     * prochain démarrage.
     */
    await DeploymentRun.updateOne({ _id: runId }, {
      $set: {
        status: doc.status,
        finalStepId: doc.finalStepId,
        currentStepId: null,
        finishedAt,
        durationMs: doc.durationMs,
        publication: doc.publication,
        errorSummary: doc.errorSummary,
        summary: doc.summary,
        reportPersistenceError: String(err?.message || 'écriture refusée').slice(0, 200),
      },
    });
    return DeploymentRun.findById(runId);
  }
}

/** Marque le currentStep d'un run (progression). Best-effort. */
export async function setCurrentStep(runId, stepId) {
  await DeploymentRun.updateOne({ _id: runId }, { $set: { currentStepId: stepId } }).catch(() => {});
}

/** Vue de liste (historique) — sans le rapport volumineux. */
export function serializeRunSummary(doc) {
  return {
    id: String(doc._id),
    targetId: String(doc.target),
    targetName: doc.targetName,
    operationType: doc.operationType || 'DEPLOYMENT',
    siteUrl: doc.siteUrl,
    siteHost: doc.siteHost,
    managerUrl: doc.managerUrl,
    managerHost: doc.managerHost,
    sshHost: doc.sshHost,
    sshUser: doc.sshUser,
    status: doc.status,
    finalStepId: doc.finalStepId,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
    durationMs: doc.durationMs,
    version: doc.version,
    summary: doc.summary,
    user: doc.user,
  };
}

/** Vue complète (avec rapport structuré + markdown). */
export function serializeRunFull(doc) {
  return {
    ...serializeRunSummary(doc),
    steps: doc.steps,
    structuredReport: doc.structuredReport,
    markdownReport: doc.markdownReport,
    errorSummary: doc.errorSummary,
    warnings: doc.warnings,

    /**
     * LE JOURNAL FORENSIQUE — ce qui rend un incident lisible sans terminal.
     *
     * Il part tel qu'il a été écrit : les entrées ont déjà traversé le
     * sanitizer au moment de leur création. Le filtrer ici une seconde fois
     * laisserait croire que la base contient des secrets — elle n'en contient
     * pas, et c'est là que la garantie doit être tenue.
     */
    journal: (doc.journal ?? []).map((e) => ({
      at: e.at, source: e.source, level: e.level, eventCode: e.eventCode,
      stepId: e.stepId ?? null, message: e.message ?? null, details: e.details ?? null,
      pid: e.pid ?? null, port: e.port ?? null, processName: e.processName ?? null,
      requestId: e.requestId ?? null, errorCode: e.errorCode ?? null, stack: e.stack ?? null,
    })),

    /** Le verdict de finalisation — pourquoi un succès n'en est pas un. */
    finalization: doc.finalization?.attemptedAt ? {
      attemptedAt: doc.finalization.attemptedAt,
      succeeded: doc.finalization.succeeded,
      error: doc.finalization.error ?? null,
      targetState: doc.finalization.targetState ?? null,
      checks: doc.finalization.checks ?? null,
    } : null,
  };
}

export async function listRuns({ targetId, limit = 50 } = {}) {
  const q = targetId ? { target: targetId } : {};
  const docs = await DeploymentRun.find(q).sort({ startedAt: -1 }).limit(Math.min(limit, 200));
  return docs.map(serializeRunSummary);
}

export async function getRunOr404(id) {
  const doc = await DeploymentRun.findById(id).catch(() => null);
  if (!doc) throw ApiError.notFound('Rapport de déploiement introuvable.');
  return doc;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA REPRISE DU SUIVI — un déploiement appartient au backend, pas à l'écran.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LES STATUTS QUI SIGNIFIENT « ÇA TOURNE ENCORE ».
 *
 * Le modèle n'en connaît qu'un — `running` — et c'est suffisant : la
 * finalisation écrit `success`/`error` en une seule transition. Nommer
 * l'ensemble ici plutôt que de répéter `status === 'running'` à cinq endroits
 * évite qu'un futur statut intermédiaire soit oublié par l'un d'eux.
 */
export const STATUTS_ACTIFS = Object.freeze(['running']);

/**
 * L'INSTANTANÉ QUI PERMET DE RECONSTRUIRE L'ÉCRAN — et rien de plus.
 *
 * ══ POURQUOI PAS `serializeRunFull` ════════════════════════════════════════
 *
 * Celui-ci porte le rapport markdown, le rapport structuré et le journal
 * forensique complet — plusieurs centaines de kilo-octets sur un run bavard.
 * Or la question posée à la reconnexion est étroite : « quelles étapes sont
 * finies, laquelle tourne, où en est-on ». Rapatrier le rapport à chaque
 * reprise ferait payer un diagnostic à qui ne demande qu'une checklist.
 *
 * Le rapport reste disponible : `GET /runs/:id` ne bouge pas.
 */
export function serializeRunSnapshot(doc) {
  if (!doc) return null;
  const steps = (doc.steps ?? []).map((s) => ({
    id: s.id,
    label: s.label ?? null,
    status: s.status ?? 'pending',
    publicMessage: s.publicMessage ?? null,
    errorCode: s.errorCode ?? null,
    critical: s.critical !== false,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
  }));
  return {
    id: String(doc._id),
    targetId: String(doc.target),
    targetName: doc.targetName,
    operationType: doc.operationType || 'DEPLOYMENT',
    env: doc.env ?? null,
    status: doc.status,
    /** `true` tant que le moteur peut encore écrire dans ce run. */
    active: STATUTS_ACTIFS.includes(doc.status),
    currentStepId: doc.currentStepId ?? null,
    finalStepId: doc.finalStepId ?? null,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt ?? null,
    durationMs: doc.durationMs ?? null,
    updatedAt: doc.updatedAt ?? null,
    siteUrl: doc.siteUrl ?? null,
    managerUrl: doc.managerUrl ?? null,
    version: doc.version ?? null,
    user: doc.user ?? null,
    errorSummary: doc.errorSummary ?? null,
    steps,
    /**
     * LA VERSION DE L'INSTANTANÉ — ce qui rend la reconnexion sûre.
     *
     * Un observateur qui rebranche compare cette valeur : si elle n'a pas
     * bougé, rien ne s'est passé entre-temps et il n'a rien manqué. Elle est
     * dérivée de l'état, jamais d'un compteur en mémoire — un compteur
     * repartirait de zéro au redémarrage du process, et deux instantanés
     * différents porteraient le même numéro.
     */
    revision: `${doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0}`
      + `:${steps.filter((s) => s.status !== 'pending').length}`
      + `:${doc.currentStepId ?? ''}:${doc.status}`,
  };
}

/**
 * LE RUN ACTIF — celui qu'un écran qui s'ouvre doit reprendre.
 *
 * ══ POURQUOI LA BASE FAIT AUTORITÉ, ET NON UN REGISTRE EN MÉMOIRE ═══════════
 *
 * Il existe bien un registre de process (`processGuard`), mais il sert la
 * forensique et meurt avec le process. Si le backend redémarre pendant un
 * déploiement, c'est la BASE qui sait qu'un run était en cours — et c'est
 * exactement le moment où l'écran a besoin de le savoir.
 *
 * On lit donc `DeploymentRun`, jamais un cache. Le verrou
 * `DeploymentTarget.activeDeploymentRunId` n'est pas utilisé ici : il protège
 * la destination, il ne décrit pas l'avancement, et un verrou orphelin
 * désignerait un run déjà terminé.
 */
export async function findActiveRun({ targetId = null, operationType = null } = {}) {
  const q = { status: { $in: STATUTS_ACTIFS } };
  if (targetId) q.target = targetId;
  if (operationType) q.operationType = operationType;
  const doc = await DeploymentRun.findOne(q).sort({ startedAt: -1 }).catch(() => null);
  return doc ?? null;
}

/**
 * LE DERNIER RUN, ACTIF OU NON (§27).
 *
 * Distinct du précédent, et la distinction n'est pas cosmétique : un run
 * `error` d'hier ne doit jamais être présenté comme un déploiement en cours.
 * L'écran s'en sert pour montrer le dernier RÉSULTAT, pas pour reprendre.
 */
/**
 * L'INSTANTANÉ D'UN RUN, RELU EN BASE.
 *
 * Exposé pour que l'observateur n'ait pas à importer le modèle : un contrôleur
 * qui manipule directement la collection finit par y écrire.
 */
export async function readRunSnapshot(runId) {
  const doc = await DeploymentRun.findById(runId).catch(() => null);
  return doc ? serializeRunSnapshot(doc) : null;
}

export async function findLatestRun({ targetId = null, operationType = null } = {}) {
  const q = {};
  if (targetId) q.target = targetId;
  if (operationType) q.operationType = operationType;
  const doc = await DeploymentRun.findOne(q).sort({ startedAt: -1 }).catch(() => null);
  return doc ?? null;
}

/**
 * Finalise les runs orphelins (statut « running ») restés bloqués — typiquement
 * après un redémarrage du backend pendant un déploiement. Ne laisse jamais un
 * run indéfiniment en cours.
 */
export async function finalizeOrphanRuns({ olderThanMs = 60_000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const orphans = await DeploymentRun.find({ status: 'running', startedAt: { $lt: cutoff } });
  for (const doc of orphans) {
    /**
     * ══ AUCUNE ÉTAPE NE RESTE `running` DERRIÈRE UN RUN TERMINÉ (§8) ═══════
     *
     * Ce filet fermait le RUN sans toucher à ses ÉTAPES. Une étape restait donc
     * `running` pour toujours, alors que plus aucun process ne l'exécutait.
     *
     * Deux conséquences, toutes deux observées : l'écran affichait un point
     * pulsant sur une étape morte, et la progression était fausse — l'étape
     * n'étant ni achevée ni échouée, elle ne comptait nulle part, et la roue
     * restait figée sur la valeur d'avant l'interruption.
     *
     * `recoverOrphanRuns` le faisait déjà ; ce filet-ci, non. Deux chemins de
     * reprise qui ne laissent pas la base dans le même état finissent toujours
     * par diverger — celui qui est oublié devient celui qui tourne en
     * production.
     */
    const at = new Date();
    for (const s of doc.steps ?? []) {
      if (s.status === 'running') {
        s.status = 'interrupted';
        s.finishedAt = at;
      }
    }

    doc.status = 'interrupted';
    doc.finishedAt = new Date();
    doc.durationMs = doc.finishedAt - doc.startedAt;
    doc.finalStepId = doc.currentStepId || doc.finalStepId || 'deployment.initialize';
    doc.errorSummary = { code: 'INTERRUPTED', step: doc.finalStepId, message: 'Déploiement interrompu (redémarrage du serveur). Rapport partiel.' };
    doc.summary = 'Déploiement interrompu (rapport partiel).';
    if (!doc.markdownReport) {
      doc.markdownReport = `# Rapport de déploiement\n\n## Résumé\n- **Résultat** : ⚠️ Interrompu\n- **Site** : ${doc.siteUrl}\n- **Manager** : ${doc.managerUrl}\n- **Étape finale** : ${doc.finalStepId}\n\nLe déploiement a été interrompu (redémarrage du serveur) avant sa fin.`;
    }
    await doc.save();
  }
  return orphans.length;
}

export default {
  createRun,
  finalizeRun,
  setCurrentStep,
  listRuns,
  getRunOr404,
  serializeRunSummary,
  serializeRunFull,
  finalizeOrphanRuns,
};
