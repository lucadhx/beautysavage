import mongoose from 'mongoose';

/**
 * CIBLE DE DÉPLOIEMENT (cahier des charges §2 & §8).
 *
 * Une cible = une destination nommée (DEMO, PRODUCTION…) identifiée par son URL
 * COMPLÈTE. Le moteur en déduit host/type/domaine (jamais saisis séparément).
 * Elle mémorise sa version déployée, la date du dernier déploiement, son état et
 * son historique. AUCUN secret VPS n'est stocké ici (le mot de passe VPS n'existe
 * qu'en RAM — voir passwordVault).
 */

/** Une étape de pipeline telle qu'archivée dans l'historique. */
const historyStepSchema = new mongoose.Schema(
  {
    step: String,
    label: String,
    /**
     * TOUS les statuts que le moteur produit RÉELLEMENT.
     *
     * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────
     * L'énumération ne connaissait que `ok`, `error` et `running`. Or le
     * pipeline émet aussi `warning` (prérequis serveur non bloquants, DNS déjà
     * en place) et `skipped` (étape sans capacité injectée). Un déploiement
     * parfaitement réussi comportant une seule étape `warning` faisait donc
     * échouer l'enregistrement de son historique sur une ValidationError — et
     * comme l'appelant avalait l'erreur, la destination restait figée en
     * « Publication… » alors que l'écran annonçait un succès.
     *
     * Constaté le 06/08 : `server.preflight=warning`, `dns.site=warning`.
     *
     * Le modèle doit accepter ce que le moteur produit, sans quoi il refuse la
     * réalité au lieu de la décrire.
     */
    status: { type: String, enum: ['ok', 'error', 'running', 'warning', 'skipped'], default: 'ok' },
    durationMs: Number,
  },
  { _id: false }
);

/** Un déploiement passé (succès ou échec). */
const historyEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    /**
     * QUELLE opération — un déploiement, un retrait, une suppression.
     *
     * L'historique ne portait que des déploiements. Un retrait n'y laissait
     * donc aucune trace : la seule opération qui DÉTRUIT était la seule à ne
     * pas être racontée.
     */
    operationType: { type: String, default: 'DEPLOYMENT' },
    version: String,
    user: String, // email de l'utilisateur (jamais de secret)
    durationMs: Number,
    success: { type: Boolean, default: false },
    failedStep: { type: String, default: null },
    error: { type: String, default: null },
    steps: { type: [historyStepSchema], default: [] },
  },
  { _id: true }
);

const deploymentTargetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },

    /**
     * QUEL PROJET vit ici — déclaré, jamais deviné.
     *
     * Deux destinations partagent une identité UNIQUEMENT si un opérateur l'a
     * dit. Ni la base, ni le domaine, ni le serveur ne créent cette parenté :
     * deux projets distincts peuvent partager les trois.
     *
     * C'est ce lien, et lui seul, qui autorise une migration de médias.
     */
    projectIdentityId: { type: String, default: null, index: true },

    /**
     * CYCLE DE VIE DE LA DESTINATION, distinct de l'état du dernier déploiement.
     *
     * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────
     * Supprimer une fiche ne retirait rien du serveur : process PM2 en ligne
     * détenant le port, configuration Nginx active, fichiers. La fiche
     * disparue, plus personne ne savait qu'il restait quelque chose à
     * nettoyer — et l'allocation de port a recyclé un numéro encore détenu.
     *
     *   ACTIVE ──► RETIRED ──► DEPROVISIONING ──► EMPTY ──► DELETED
     *                              │                  ▲
     *                              └► DEPROVISION_FAILED┘   (reprise)
     *
     * `DELETED` est un état, pas une absence : la fiche sort des listes mais
     * son historique et son audit restent lisibles.
     *
     * ── POURQUOI `RETIRED` EXISTE ────────────────────────────────────────
     * Il manquait un état pour « ce n'est plus la destination qui sert, mais
     * le serveur porte peut-être encore ses fichiers, son service et son
     * port ». Sans lui, une destination remplacée n'avait que deux issues :
     * rester ACTIVE — et disputer l'environnement à celle qui sert vraiment —
     * ou passer EMPTY, ce qui AFFIRME que le serveur est vide alors que
     * personne ne l'a constaté.
     *
     * `RETIRED` ne réserve donc plus l'environnement, mais retient toujours
     * l'hôte et le port : rien n'est déclaré libre sans preuve.
     */
    lifecycleStatus: {
      type: String,
      enum: ['ACTIVE', 'RETIRED', 'DEPROVISIONING', 'EMPTY', 'DEPROVISION_FAILED', 'DELETED'],
      default: 'ACTIVE',
      index: true,
    },
    /** Le moment où elle a cessé d'être la destination qui sert. */
    retiredAt: { type: Date, default: null },
    deprovisionStartedAt: { type: Date, default: null },
    deprovisionCompletedAt: { type: Date, default: null },
    deprovisionFailedAt: { type: Date, default: null },
    lastDeprovisionRunId: { type: String, default: null },
    emptiedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    /** Cause du dernier retrait interrompu — conservée pour la reprise. */
    lastError: {
      step: { type: String, default: null },
      code: { type: String, default: null },
      message: { type: String, default: null },
      at: { type: Date, default: null },
    },
    /**
     * Le domaine est-il encore neutralisé (410) sur le serveur ?
     *
     * Une destination vidée laisse une quarantaine : sans elle, le domaine
     * retomberait sur un autre site du serveur. Supprimer la fiche sans lever
     * la quarantaine laisserait un bloc Nginx que plus rien ne désigne.
     */
    quarantineEnabled: { type: Boolean, default: false },
    /** Verrou lisible : tant qu'il est posé, aucun retrait ne démarre. */
    activeDeploymentRunId: { type: String, default: null },
    // Dernier run réellement validé : ce qui fait d'un emplacement une source sûre.
    lastHealthyDeploymentRunId: { type: String, default: null },
    // Emplacement courant sur le serveur, tel que déployé.
    currentSiteRoot: { type: String, default: null },
    // Destination que celle-ci remplace, quand elle a été créée comme suite.
    previousTargetId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeploymentTarget', default: null },

    /**
     * ENVIRONNEMENT DÉPLOYÉ — porté par la DESTINATION, jamais choisi au
     * moment de déployer.
     *
     * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────
     * L'environnement était un sélecteur de l'assistant, avec PROD pour
     * valeur par défaut. La même destination pouvait donc être déployée en
     * TEST puis en PROD — deux bases, deux jeux de médias, un seul domaine —
     * et rien ne le signalait. Un clic de trop publiait en production.
     *
     * Il décide de la base écrite dans le `.env` distant, de l'isolation des
     * médias, et de l'unicité de la destination ACTIVE.
     */
    environment: { type: String, enum: ['TEST', 'PROD'], required: true },

    // Déductions figées de parseTargetUrl (recalculées à chaque sauvegarde).
    //
    // L'unicité de l'hôte n'est PAS déclarée ici : elle vaut seulement parmi
    // les destinations VIVANTES, ce qu'un index partiel exprime (plus bas).
    // Une fiche DELETED conserve son hôte — c'est ce qui rend son audit
    // relisible — mais ne réserve plus le domaine.
    host: { type: String, required: true, lowercase: true },
    type: { type: String, enum: ['subdomain', 'domain'], required: true },
    registrableDomain: String,
    subdomain: { type: String, default: null },
    wildcardBase: { type: String, default: null },

    // Serveur (VPS) associé : adresse SSH + utilisateur. L'utilisateur par défaut
    // est « root » — l'utilisateur final n'a jamais à le connaître (masqué dans
    // « Options avancées »). Le mot de passe, lui, n'est JAMAIS stocké (RAM seule).
    sshHost: { type: String, default: null }, // IP/hôte du serveur, préconfiguré à la création
    sshUser: { type: String, default: 'root' },

    // Port local d'écoute du backend de cette cible (PM2 + proxy Nginx).
    backendPort: { type: Number, required: true },

    // Base MongoDB de la cible (pour backup/restore).
    dbName: { type: String, default: null },

    // Racine de déploiement sur le VPS.
    remoteRoot: { type: String, default: '/var/www' },

    // État courant.
    state: {
      type: String,
      enum: ['NEW', 'DEPLOYING', 'DEPLOYED', 'FAILED'],
      default: 'NEW',
    },
    currentVersion: { type: String, default: null },
    lastDeployedAt: { type: Date, default: null },

    // Historique borné (les plus récents en tête).
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true }
);

/**
 * UNICITÉ DE L'HÔTE parmi les destinations VIVANTES.
 *
 * Le filtre s'énonce en `$in` et non en `$ne` : MongoDB refuse une négation
 * dans un index partiel — un `$ne` fait échouer la construction EN SILENCE, et
 * l'index n'existe alors tout simplement pas. Énumérer les états vivants dit
 * d'ailleurs mieux la règle qu'une exclusion.
 */
deploymentTargetSchema.index(
  { host: 1 },
  {
    unique: true,
    partialFilterExpression: {
      // `RETIRED` retient l'hôte : le domaine reste servi tant qu'il n'a pas
      // été réellement retiré du serveur.
      lifecycleStatus: { $in: ['ACTIVE', 'RETIRED', 'DEPROVISIONING', 'EMPTY', 'DEPROVISION_FAILED'] },
    },
  },
);

/**
 * UNE SEULE DESTINATION ACTIVE PAR ENVIRONNEMENT — garanti par la BASE.
 *
 * ── POURQUOI UN INDEX, ET PAS UN CONTRÔLE DE SERVICE ────────────────────────
 * Un contrôle applicatif lit puis écrit : deux requêtes simultanées passent
 * toutes deux la lecture et écrivent toutes deux. L'index, lui, ne peut pas
 * être contourné — ni par une seconde implémentation, ni par un script, ni par
 * une écriture concurrente.
 *
 * Ce qu'il ferme concrètement : deux destinations ACTIVE en TEST font de la
 * résolution d'adresse et de la publication des médias une loterie, arbitrée
 * par la date du dernier déploiement.
 */
deploymentTargetSchema.index(
  { environment: 1 },
  {
    name: 'environnement_actif_unique',
    unique: true,
    partialFilterExpression: { lifecycleStatus: { $in: ['ACTIVE'] } },
  },
);

/** Lecture courante : « la destination ACTIVE de cet environnement ». */
deploymentTargetSchema.index({ environment: 1, lifecycleStatus: 1, state: 1 });

/** Ne conserve que les N derniers déploiements pour éviter une croissance illimitée. */
deploymentTargetSchema.methods.pushHistory = function pushHistory(entry, max = 50) {
  this.history.unshift(entry);
  if (this.history.length > max) this.history = this.history.slice(0, max);
};

export const DeploymentTarget = mongoose.model('DeploymentTarget', deploymentTargetSchema);
export default DeploymentTarget;
