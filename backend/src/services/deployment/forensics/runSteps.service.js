/**
 * PERSISTANCE DES ÉTAPES ET REPRISE DES RUNS ORPHELINS.
 *
 * ══ L'INVARIANT ═════════════════════════════════════════════════════════════
 *
 *   Toute étape passée à RUNNING finit par un état terminal.
 *
 * Il paraît évident ; il ne l'était pas. Les transitions ne voyageaient que
 * dans le flux NDJSON : si le navigateur se fermait ou si le backend
 * redémarrait, la dernière étape restait `running` pour toujours, et l'écran
 * affichait un chargement éternel sur une opération terminée depuis
 * longtemps. Constaté le 06/08 : un run figé sur `ssh.connect` pendant
 * 8 min 36 s, jusqu'à ce qu'un redémarrage le libère.
 *
 * ══ CE QUI CHANGE ═══════════════════════════════════════════════════════════
 *
 * Chaque transition est ÉCRITE en base, en plus d'être émise. Et au démarrage,
 * tout run resté `running` est repris : son étape active passe `interrupted`,
 * le run est clos, et la raison est journalisée. Un chargement éternel devient
 * impossible — pas par surveillance, par construction.
 */
import DeploymentRun from '../../../models/DeploymentRun.model.js';
import { EVENTS, LEVELS, SOURCES, journal } from './runJournal.service.js';
import { isBeforePublication } from '../../../deployment-engine/steps.js';


/** Le statut d'étape → l'évènement de journal correspondant. */
const EVENEMENT = Object.freeze({
  running: EVENTS.STEP_STARTED,
  ok: EVENTS.STEP_SUCCEEDED,
  warning: EVENTS.STEP_WARNING,
  error: EVENTS.STEP_FAILED,
  skipped: EVENTS.STEP_SKIPPED,
  interrupted: EVENTS.STEP_INTERRUPTED,
});

const NIVEAU = Object.freeze({
  running: LEVELS.INFO,
  ok: LEVELS.INFO,
  warning: LEVELS.WARNING,
  error: LEVELS.ERROR,
  skipped: LEVELS.DEBUG,
  interrupted: LEVELS.WARNING,
});

/**
 * ENREGISTRE une transition d'étape — en base ET au journal.
 *
 * Écriture par opérateurs atomiques : le pipeline, le transport et le
 * middleware HTTP écrivent en même temps. Un `save()` relirait le document
 * entier et perdrait les écritures concurrentes.
 */
/**
 * ══ L'ÉCHEC D'UNE ÉCRITURE DURABLE, TYPÉ ════════════════════════════════════
 *
 * Il n'existait pas : `recordStep` attrapait sa propre erreur et l'écrivait sur
 * la console. Un appelant qui aurait pensé à `await` n'aurait donc RIEN appris
 * — la promesse se résolvait toujours. Le silence était double, et la moitié la
 * plus grave n'était pas le `void` de l'appelant.
 */
export class RecorderWriteError extends Error {
  constructor(message, { stepId = null, cause = null } = {}) {
    super(message);
    this.name = 'RecorderWriteError';
    this.code = 'DEPLOYMENT_RECORDER_WRITE_FAILED';
    this.stepId = stepId;
    /**
     * La cause d'origine est CONSERVÉE mais jamais publiée telle quelle : un
     * message de pilote Mongo porte volontiers l'URI de connexion, donc des
     * identifiants. Le rapport n'en garde qu'un motif borné.
     */
    this.cause = cause;
  }
}

/** Le motif d'une panne, sans jamais l'adresse ni les identifiants de la base. */
function motifSur(err) {
  const brut = String(err?.message || err || 'écriture refusée');
  return brut
    .replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://«caviardé»')
    .slice(0, 200);
}

/**
 * ÉCRITURE CRITIQUE — elle LÈVE.
 *
 * Réservée à ce qui doit être durable avant qu'on ne touche au monde : toute
 * étape antérieure à la frontière de publication. Son échec n'est pas une gêne
 * de traçabilité, c'est la perte de la capacité à dire ce qu'on est en train de
 * faire — et donc une raison d'arrêter avant de le faire.
 */
export async function recordStepCritical(runId, patch) {
  let issue = null;
  /**
   * ══ ON RÉESSAIE CE QUI PEUT PASSER, PAS CE QUI EST REFUSÉ ═══════════════════
   *
   * Une bascule de réplique ou une socket coupée dure une seconde ; refuser un
   * déploiement pour cela serait aussi faux que de publier sans journal. Un
   * document invalide, lui, sera refusé à l'identique au troisième essai — le
   * réessayer ne fait que retarder l'arrêt de trois cents millisecondes.
   *
   * Les tentatives sont bornées et courtes : la barrière attend cette réponse,
   * et une attente indéfinie devient elle-même une panne.
   */
  for (let essai = 1; essai <= 3; essai += 1) {
    issue = await ecrireEtape(runId, patch);
    if (issue.ok || !issue.transitoire) break;
    if (essai < 3) await new Promise((r) => { setTimeout(r, essai * 60); });
  }

  if (!issue.ok) {
    throw new RecorderWriteError(
      `Journal durable indisponible : l'étape « ${patch?.stepId} » n'a pas pu être enregistrée.`,
      { stepId: patch?.stepId, cause: issue.motif },
    );
  }
  return issue.resultat;
}

/** Une panne de passage (réseau, bascule de réplique) — pas un refus de fond. */
function estTransitoire(err) {
  if (!err) return false;
  if (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('RetryableWriteError')) return true;
  if (/^Mongo(Network|NotPrimary|ServerSelection|Timeout|Expired)/.test(String(err.name || ''))) return true;
  return /timed out|not primary|socket|topology|connection (closed|refused|reset)/i.test(String(err.message || ''));
}

/**
 * ÉCRITURE BEST-EFFORT — elle n'échoue jamais vers l'appelant, et le DIT.
 *
 * Réservée à ce qui suit la publication : à cet instant, le monde a déjà changé,
 * et refuser de continuer ne le défait pas. La perte de durabilité est alors un
 * FAIT à signaler, pas une raison d'arrêter — mais elle n'est plus invisible :
 * `lastFailure()` la rend, et le contrôleur la porte au rapport.
 */
let derniereDefaillance = null;

export function lastRecorderFailure() {
  return derniereDefaillance;
}

export function resetRecorderFailure() {
  derniereDefaillance = null;
}

export async function recordStep(runId, patch) {
  const issue = await ecrireEtape(runId, patch);
  if (!issue.ok) {
    derniereDefaillance = { stepId: patch?.stepId ?? null, reason: issue.motif, at: new Date().toISOString() };
    // eslint-disable-next-line no-console
    console.error(`[forensique] étape « ${patch?.stepId} » non persistée : ${issue.motif}`);
  }
  return issue.resultat;
}

/**
 * L'ÉCRITURE ELLE-MÊME — rend son issue, ne décide de rien.
 *
 * C'est la séparation qui manquait : une seule fonction faisait l'écriture ET
 * le choix d'ignorer son échec. Le choix appartient désormais à l'appelant, qui
 * sait s'il est avant ou après la frontière de publication.
 */
async function ecrireEtape(runId, {
  stepId, label = null, status, publicMessage = null, technicalMessage = null,
  errorCode = null, durationMs = null, details = null,
} = {}) {
  if (!runId || !stepId || !status) return { ok: true, resultat: null };
  const maintenant = new Date();

  try {
    // L'étape existe-t-elle déjà dans le tableau ? On met à jour, sinon on ajoute.
    const maj = await DeploymentRun.updateOne(
      { _id: runId, 'steps.id': stepId },
      {
        $set: {
          'steps.$.status': status,
          'steps.$.label': label ?? undefined,
          'steps.$.publicMessage': publicMessage,
          'steps.$.technicalMessage': technicalMessage,
          'steps.$.errorCode': errorCode,
          ...(status === 'running' ? { 'steps.$.startedAt': maintenant } : { 'steps.$.finishedAt': maintenant }),
          ...(durationMs !== null ? { 'steps.$.durationMs': durationMs } : {}),
          currentStepId: status === 'running' ? stepId : null,
        },
      },
    );

    if (maj.matchedCount === 0) {
      await DeploymentRun.updateOne({ _id: runId }, {
        $push: {
          steps: {
            id: stepId, label, status,
            startedAt: status === 'running' ? maintenant : null,
            finishedAt: status === 'running' ? null : maintenant,
            durationMs, publicMessage, technicalMessage, errorCode,
          },
        },
        $set: { currentStepId: status === 'running' ? stepId : null },
      });
    }
  } catch (err) {
    return { ok: false, motif: motifSur(err), transitoire: estTransitoire(err), resultat: null };
  }

  /**
   * LE JOURNAL EST SECONDAIRE À L'ÉTAT.
   *
   * L'étape est déjà écrite ; ce qui suit enrichit la trace. Son échec ne remet
   * pas en cause la durabilité de l'état du run — le distinguer évite de
   * refuser un déploiement pour une ligne de journal.
   */
  await journal(runId, {
    source: SOURCES.ENGINE,
    level: NIVEAU[status] ?? LEVELS.INFO,
    eventCode: EVENEMENT[status] ?? EVENTS.STEP_STARTED,
    stepId,
    message: publicMessage ?? label ?? stepId,
    errorCode,
    details: details ?? (durationMs !== null ? { durationMs } : null),
  }).catch(() => { /* trace enrichie, jamais l'état : voir ci-dessus */ });

  return { ok: true, resultat: { stepId, status } };
}

/**
 * ══ LE JOURNAL D'UN RUN — UNE FILE, DEUX RÉGIMES, UNE QUESTION ══════════════
 *
 * Le moteur appelle `onEvent` de façon SYNCHRONE, au fil du pipeline. On ne peut
 * donc pas y attendre une écriture : l'attendre rendrait le moteur dépendant de
 * la base, et l'ordre des écritures suivrait l'ordre d'achèvement de Mongo
 * plutôt que celui des étapes — une étape `ok` pourrait être écrite avant le
 * `running` qui la précède.
 *
 * Les transitions sont donc MISES EN FILE et écrites en série, dans l'ordre
 * d'émission. La file porte deux régimes séparés par la frontière de
 * publication, et le moteur pose une seule question au bon moment :
 * `assertDurable()`, qui vide la file et refuse de publier si ce qui précède
 * n'est pas écrit.
 *
 * ── LE CLIQUET ──────────────────────────────────────────────────────────────
 * Dès qu'une étape postérieure à la frontière apparaît, la file passe
 * définitivement en régime tolérant. Sans ce cliquet, une étape hors registre
 * (`isBeforePublication` rend `true` par prudence pour l'inconnu) redeviendrait
 * critique APRÈS la bascule — c'est-à-dire qu'on refuserait un déploiement déjà
 * publié, ce qui ne le défait pas et perd le rapport.
 */
export function createStepJournal(runId, { record = recordStep, recordCritical = recordStepCritical } = {}) {
  let chaine = Promise.resolve();
  let publie = false;
  let defaillanceCritique = null;
  let defaillanceTardive = null;

  const enqueue = (patch) => {
    if (!publie && !isBeforePublication(patch?.stepId)) publie = true;
    const critique = !publie;

    chaine = chaine.then(async () => {
      if (critique) {
        /**
         * Une défaillance déjà constatée n'est pas réessayée en boucle : la
         * décision est prise, la barrière la lira. Les étapes suivantes sont
         * tout de même TENTÉES en best-effort — si la base revient, la trace
         * de l'arrêt s'écrit, ce qui est précisément ce qu'on veut relire.
         */
        if (!defaillanceCritique) {
          try {
            await recordCritical(runId, patch);
            return;
          } catch (err) {
            defaillanceCritique = {
              stepId: patch?.stepId ?? null,
              reason: err?.cause ?? motifSur(err),
              code: err?.code ?? 'DEPLOYMENT_RECORDER_WRITE_FAILED',
              at: new Date().toISOString(),
            };
          }
        }
        await record(runId, patch).catch(() => {});
        return;
      }

      /**
       * L'ISSUE SE LIT SUR L'APPEL, PAS SUR UN ÉTAT GLOBAL.
       *
       * `lastRecorderFailure()` est un état de module : deux déploiements
       * simultanés y écrivent, et l'un pourrait s'attribuer la panne de
       * l'autre. La valeur RENDUE, elle, appartient à cet appel-ci — elle est
       * nulle quand l'écriture a été refusée. Le motif, lui, peut venir de
       * l'état global : il n'est qu'un texte d'explication.
       */
      const ecrit = await record(runId, patch).catch(() => null);
      if (!ecrit) {
        defaillanceTardive = {
          stepId: patch?.stepId ?? null,
          reason: lastRecorderFailure()?.reason ?? 'écriture refusée',
          at: new Date().toISOString(),
        };
      }
    });
  };

  /**
   * LA RÉPONSE À LA BARRIÈRE.
   *
   * Elle vide d'abord la file : la question « est-ce écrit ? » n'a de sens
   * qu'une fois tout ce qui précède réellement tenté. Puis elle LÈVE, et cette
   * levée arrête le déploiement avant la première commande de publication.
   */
  const assertDurable = async () => {
    await chaine;
    if (defaillanceCritique) {
      throw new RecorderWriteError(
        `Publication refusée : l'étape « ${defaillanceCritique.stepId} » n'a pas pu être enregistrée durablement.`,
        { stepId: defaillanceCritique.stepId, cause: defaillanceCritique.reason },
      );
    }
  };

  return {
    enqueue,
    assertDurable,
    drain: () => chaine,
    criticalFailure: () => defaillanceCritique,
    lateFailure: () => defaillanceTardive,
    published: () => publie,
  };
}

/**
 * REPREND les runs laissés « en cours » par un process qui n'est plus là.
 *
 * ── POURQUOI AU DÉMARRAGE, ET PAS SUR MINUTERIE ─────────────────────────────
 * Un run `running` n'est orphelin que si le process qui l'exécutait a disparu.
 * Le seul instant où l'on en est certain est le démarrage d'un NOUVEAU
 * process : aucun run antérieur ne peut encore être en cours, puisque son
 * exécutant est mort. Une minuterie, elle, devrait deviner un délai — et
 * finirait par tuer un déploiement lent mais vivant.
 *
 * L'étape active est marquée `interrupted`, jamais `error` : elle n'a pas
 * échoué, elle a été coupée. Confondre les deux ferait chercher une cause
 * technique là où il n'y a qu'un redémarrage.
 */
export async function recoverOrphanRuns({ reason = 'process_restart', runRepris = null } = {}) {
  const candidats = await DeploymentRun.find({ status: 'running' })
    .select('_id target currentStepId steps startedAt operationType updatedAt executorPid')
    .lean();

  /**
   * PREUVE DE VIE — le PROCESS qui exécute, pas la fraîcheur des écritures.
   *
   * ── POURQUOI LA FRAÎCHEUR NE PROUVE RIEN ICI ──────────────────────────────
   * SB Auto exécute son pipeline DANS la requête. Quand le process meurt, tout
   * meurt avec lui — y compris un run écrit deux secondes plus tôt. Se fier à
   * `updatedAt` revenait donc à épargner précisément les runs les plus sûrement
   * morts : ceux qui écrivaient encore à l'instant où le process a disparu.
   *
   * Le préflight du 06/08 23:02 l'a montré : le process s'arrête à 23:02:55.976
   * en pleine connexion SSH, le suivant démarre à 23:03:03 — et voyait une
   * écriture vieille de huit secondes, donc « vivante ». Le run restait
   * `running` pour toujours, avec `ssh.connect` en cours et personne pour le
   * conclure. Avant cette heuristique, le démarrage suivant le fermait : la
   * fraîcheur avait transformé un blocage temporaire en blocage définitif.
   *
   * On demande donc au système d'exploitation, seule autorité en la matière.
   * `process.kill(pid, 0)` n'envoie aucun signal : il teste l'existence.
   *   · pid vivant et différent du nôtre → un autre process d'API mène ce run ;
   *   · pid inexistant → l'exécutant est parti, le run est orphelin ;
   *   · pid absent du document (runs antérieurs) → indécidable, donc orphelin,
   *     ce qui est le comportement historique et l'issue sûre.
   */
  const vivant = (run) => {
    const pid = Number(run.executorPid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM : le process existe mais appartient à un autre utilisateur.
      return err.code === 'EPERM';
    }
  };

  const orphelins = [];
  const survivants = [];
  for (const run of candidats) (vivant(run) ? survivants : orphelins).push(run);

  /**
   * CE QU'ON ÉPARGNE, ON LE DIT.
   *
   * Voir `APPLICATION_RESTART_COMPLETED` suivi de
   * `RUN_INTERRUPTED_BY_PROCESS_RESTART` pour le MÊME redémarrage attendu était
   * le symptôme d'une reprise qui ignorait ce qu'elle venait de constater. Le
   * contrat l'interdit désormais des deux côtés.
   */
  for (const run of survivants) {
    await journal(run._id, {
      source: SOURCES.SYSTEM,
      level: LEVELS.INFO,
      eventCode: EVENTS.RUN_RESUMED_AFTER_EXPECTED_RESTART,
      stepId: run.currentStepId ?? null,
      message: String(run._id) === String(runRepris)
        ? 'Le redémarrage était attendu et le process qui exécute ce run est toujours là : il se poursuit sans interruption.'
        : 'Ce déploiement est mené par un process vivant : le redémarrage ne l’a pas interrompu.',
      details: {
        reason,
        marqueurConsomme: String(run._id) === String(runRepris),
        executorPid: run.executorPid ?? null,
        derniereEcriture: run.updatedAt ?? null,
        newPid: process.pid,
      },
      pid: process.pid,
    });
  }

  const repris = [];
  for (const run of orphelins) {
    const enCours = (run.steps || []).filter((s) => s.status === 'running');
    const maintenant = new Date();

    for (const s of enCours) {
      await DeploymentRun.updateOne(
        { _id: run._id, 'steps.id': s.id },
        { $set: { 'steps.$.status': 'interrupted', 'steps.$.finishedAt': maintenant } },
      ).catch(() => {});
    }

    await DeploymentRun.updateOne({ _id: run._id }, {
      $set: {
        status: 'interrupted',
        finishedAt: maintenant,
        durationMs: run.startedAt ? maintenant - new Date(run.startedAt) : null,
        currentStepId: null,
        summary: 'Interrompu : le processus qui exécutait cette opération a été redémarré.',
      },
    }).catch(() => {});

    await journal(run._id, {
      source: SOURCES.SYSTEM,
      level: LEVELS.WARNING,
      eventCode: EVENTS.RUN_INTERRUPTED_BY_PROCESS_RESTART,
      stepId: run.currentStepId ?? enCours[0]?.id ?? null,
      message: 'Le processus exécutant ce déploiement a été redémarré : le run est clos comme interrompu.',
      details: {
        reason,
        interruptedSteps: enCours.map((s) => s.id),
        newPid: process.pid,
        operationType: run.operationType,
      },
      pid: process.pid,
    });

    repris.push({ runId: String(run._id), steps: enCours.map((s) => s.id) });
  }

  return {
    recovered: repris.length,
    runs: repris,
    // Sans ce compte, une reprise qui n'a rien fermé est indistinguable d'une
    // reprise qui n'a rien trouvé.
    preserved: survivants.length,
    preservedRuns: survivants.map((r) => String(r._id)),
  };
}

export default { createStepJournal, recordStep, recordStepCritical, recoverOrphanRuns };
