import mongoose from 'mongoose';

/**
 * EXÉCUTION de déploiement (DeploymentRun) — source de vérité d'une tentative.
 *
 * Chaque « Publier » crée un DeploymentRun. Il porte l'état vivant de la
 * checklist (steps), le résultat final, et le rapport technique (structuré JSON
 * + rendu Markdown copiable). Persisté pour rester disponible après
 * rechargement, reconnexion ou redémarrage du backend. AUCUN secret (le rapport
 * est redigé). Les logs sont bornés par le RunRecorder (limite BSON respectée).
 */

/** Une entrée du journal forensique — même forme que celle d'une tentative. */
const journalEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    source: { type: String, required: true },
    level: { type: String, default: 'info' },
    eventCode: { type: String, required: true },
    stepId: { type: String, default: null },
    message: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    pid: { type: Number, default: null },
    port: { type: Number, default: null },
    processName: { type: String, default: null },
    requestId: { type: String, default: null },
    errorCode: { type: String, default: null },
    stack: { type: String, default: null },
  },
  { _id: false },
);

const runStepSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    order: Number,
    /*
     * `interrupted` : le process qui exécutait l'étape a disparu. Écrit par les
     * DEUX chemins de reprise (`recoverOrphanRuns`, `finalizeOrphanRuns`) — une
     * étape ne reste jamais `running` derrière un run terminé (§8).
     */
    status: { type: String, default: 'pending' }, // pending|running|ok|warning|error|skipped|cancelled|interrupted
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    publicMessage: { type: String, default: null },
    technicalMessage: { type: String, default: null },
    errorCode: { type: String, default: null },
    retryable: { type: Boolean, default: null },
    critical: { type: Boolean, default: true },
    warnings: { type: [String], default: [] },
  },
  { _id: false }
);

const deploymentRunSchema = new mongoose.Schema(
  {
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'DeploymentTarget', required: true, index: true },
    targetName: String,

    /**
     * ══ LE VOCABULAIRE DES OPÉRATIONS — un mot par opération, partout ═══════
     *
     * Toute opération produit le MÊME rapport : checklist, journal, rapport
     * persisté, copiable. Le type dit LAQUELLE, et il n'y a qu'un mot pour
     * chacune — celui qu'emploient déjà le moteur, le cycle de vie et les
     * codes d'erreur :
     *
     *   PRECHECK            vérifier sans rien changer
     *   DEPLOYMENT          mettre en ligne
     *   ROLLBACK            revenir à la version précédente
     *   HEALTHCHECK         constater l'état
     *   BACKUP              sauvegarder
     *   DEPROVISION         VIDER le serveur — le contraire d'un déploiement
     *   DESTINATION_DELETE  supprimer la FICHE d'une destination déjà vidée
     *
     * ── POURQUOI DEPROVISION MANQUAIT, ET CE QUE ÇA A COÛTÉ ────────────────
     * Le mot existait partout ailleurs : `deprovision.js` et ses
     * `DEPROVISION_STEPS`, les états `DEPROVISIONING` / `DEPROVISION_FAILED`
     * du cycle de vie, le code d'erreur `DEPROVISION_FAILED`, et jusqu'à la
     * garde `activeRun.operationType !== 'DEPROVISION'` qui LE LIT. Seul cet
     * énuméré ne le connaissait pas.
     *
     * Conséquence en production : `createRun({ operationType: 'DEPROVISION' })`
     * levait une `ValidationError` de Mongoose APRÈS l'envoi des en-têtes
     * NDJSON. Le flux restait ouvert, muet, pour toujours ; l'opérateur voyait
     * sa checklist s'afficher et plus rien ne bougeait. Le retrait — la seule
     * opération qui DÉTRUIT — était la seule à ne pas pouvoir se raconter.
     *
     * `DESTINATION_DELETE` figure ici pour la même raison : l'historique de la
     * destination l'écrit déjà (DeploymentTarget.history), et un run qui
     * voudrait le porter demain ne doit pas retrouver ce mur.
     *
     * Les deux mots ne se confondent pas : vider un serveur et oublier une
     * fiche sont deux opérations, et une fiche peut être supprimée sans que
     * rien n'ait jamais été vidé.
     */
    operationType: {
      type: String,
      enum: [
        'PRECHECK', 'DEPLOYMENT', 'ROLLBACK', 'HEALTHCHECK', 'BACKUP',
        'DEPROVISION', 'DESTINATION_DELETE',
      ],
      default: 'DEPLOYMENT',
      index: true,
    },

    // Vitrine + Manager (dérivé) traités ensemble.
    siteUrl: String,
    siteHost: { type: String, index: true },
    managerUrl: String,
    managerHost: String,
    sshHost: String,
    sshUser: { type: String, default: 'root' },
    env: { type: String, default: 'PROD' },

    status: {
      type: String,
      /**
       * `finalization_failed` : le serveur a bien été mis à jour, mais l'état
       * persistant n'a pas atteint sa forme finale. Ce n'est ni un succès ni
       * un échec de déploiement — et le confondre avec l'un des deux est
       * précisément ce qui a produit un écran de succès mensonger.
       */
      enum: ['running', 'ok', 'warning', 'error', 'cancelled', 'interrupted', 'finalization_failed'],
      default: 'running',
      index: true,
    },
    currentStepId: { type: String, default: null },

    /**
     * LE PROCESS QUI EXÉCUTE CE RUN.
     *
     * SB Auto mène son pipeline DANS la requête : quand ce process disparaît,
     * le run meurt avec lui, quelle que soit la fraîcheur de ses écritures.
     * C'est donc l'existence de ce PID — et elle seule — qui distingue au
     * démarrage un déploiement encore mené d'un déploiement abandonné.
     */
    executorPid: { type: Number, default: null },
    finalStepId: { type: String, default: null },

    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },

    steps: { type: [runStepSchema], default: [] },

    /**
     * JOURNAL FORENSIQUE — append-only, écrit par `$push` atomique.
     *
     * ── POURQUOI DANS LE RUN ────────────────────────────────────────────
     * Le flux NDJSON disparaissait avec l'onglet du navigateur, et les
     * journaux PM2 exigeaient un accès SSH au bon moment. La seule trace qui
     * survit à un redémarrage du backend est celle qui est PERSISTÉE au fur
     * et à mesure, à côté de ce qu'elle décrit.
     *
     * Jamais réécrit : on ajoute. Un journal qu'on corrige ne raconte plus ce
     * qui s'est passé, mais ce qu'on a compris après coup.
     *
     * Aucun secret n'y entre — tout passe par le sanitizer central.
     */
    journal: { type: [journalEntrySchema], default: [] },

    /**
     * FINALISATION — le run n'est « réussi » que si l'état persistant le
     * confirme. Un pipeline vert ne suffit pas : c'est en le croyant qu'on a
     * affiché un succès pendant que la destination restait « Publication… ».
     */
    /**
     * ══ CE QUE LE PUBLIC A VU — indépendant du succès de l'opération ═════════
     *
     * Le run savait dire « réussi » ou « échoué » ; il ne savait pas dire « la
     * nouvelle version est en ligne ET la suite a échoué ». C'est pourtant
     * l'état le plus fréquent d'un déploiement interrompu après la bascule, et
     * celui où le pire conseil possible est « relancez ».
     *
     * `journalComplete: false` marque un run dont la chronologie est trouée :
     * une écriture a été perdue APRÈS publication. C'est le drapeau que le
     * prochain lot de réconciliation viendra lire — sans lui, un run incomplet
     * est indistinguable d'un run complet.
     */
    publication: {
      state: {
        type: String,
        enum: ['NOT_REACHED', 'POSSIBLE', 'OCCURRED'],
        default: 'NOT_REACHED',
      },
      boundaryStepId: { type: String, default: null },
      journalComplete: { type: Boolean, default: true },
      degradedAtStepId: { type: String, default: null },
    },

    /**
     * Le rapport complet n'a pas pu être écrit ; le verdict, si. Ce champ dit
     * pourquoi, et distingue un run sans rapport d'un run sans incident.
     */
    reportPersistenceError: { type: String, default: null },

    finalization: {
      attemptedAt: { type: Date, default: null },
      succeeded: { type: Boolean, default: null },
      error: { type: String, default: null },
      targetState: { type: String, default: null },
      checks: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    summary: { type: String, default: null },

    // Rapport technique.
    reportVersion: { type: String, default: '1.0' },
    structuredReport: { type: mongoose.Schema.Types.Mixed, default: null },
    markdownReport: { type: String, default: null },

    errorSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    warnings: { type: [String], default: [] },

    releaseId: { type: String, default: null },
    commitSha: { type: String, default: null },
    version: { type: String, default: null },
    user: { type: String, default: null },
  },
  { timestamps: true }
);

export const DeploymentRun = mongoose.model('DeploymentRun', deploymentRunSchema);
export default DeploymentRun;
