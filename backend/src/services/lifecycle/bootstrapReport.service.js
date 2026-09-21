/**
 * LE RÉSULTAT STRUCTURÉ DE L'AMORÇAGE — « API PRÊTE » devient une CONCLUSION.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Le démarrage journalisait des faits isolés, chacun décidant seul de son
 * niveau, et personne ne les additionnait. On lisait donc, dans cet ordre :
 *
 *     Webhook STRIPE/payment (TEST) : réconciliation sautée (PANEL_NOT_PAIRED).
 *     Pont Panel : appairage restauré.
 *     …
 *     API PRÊTE
 *
 * Trois lignes vraies, et une conclusion fausse : la dépendance manquante est
 * arrivée deux lignes plus bas, le geste sauté ne l'a jamais su, et « PRÊTE »
 * ne signifiait rien de plus que « `listen()` n'a pas levé ».
 *
 * Un journal n'est pas un rapport tant que personne ne le TOTALISE. Ce module
 * est le totalisateur : chaque brique du démarrage y dépose un constat typé,
 * avec sa PREUVE, et c'est la somme — pas l'absence de rouge — qui autorise
 * l'état READY.
 *
 * ══ CE QU'UN `OK` COÛTE ICI ═════════════════════════════════════════════════
 *
 * Une preuve, obligatoirement. `recordCheck` refuse un succès sans `proof` :
 * « Stripe prêt parce qu'une ligne existe en base » n'est pas un constat, c'est
 * une supposition — et c'est exactement la catégorie de faux positif qui rend
 * un journal vert inutilisable le jour où il compte.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Ni un ordonnanceur, ni un moteur de reprise (voir
 * `startupReconciliation.service.js`), ni un connaisseur de fournisseurs. Il
 * ne sait ni ce qu'est Stripe, ni ce qu'est un webhook : il compte des
 * constats et sait dire lesquels interdisent de servir.
 */
import { logger } from '../../utils/logger.js';

/** Les grandes étapes, dans l'ordre où le démarrage les traverse. */
export const BOOT_SECTION = Object.freeze({
  CORE: 'CORE',
  PANEL: 'PANEL',
  INTEGRATED_APIS: 'INTEGRATED APIs',
  BACKGROUND: 'BACKGROUND SERVICES',
  /**
   * LES REPRISES DE DONNÉES ONT LEUR PROPRE SECTION — et ce n'est pas cosmétique.
   *
   * Elles vivent dans `server.js`, APRÈS `bootstrap()`. Les ranger sous `CORE`
   * faisait réapparaître le titre « CORE » sous « BACKGROUND SERVICES », et un
   * journal qui revient en arrière ne se lit plus dans l'ordre — c'est
   * exactement ce qu'on cherche à réparer.
   */
  RECOVERY: 'REPRISES',
  /**
   * LA FRONTIÈRE `STRUCTURAL_RECOVERY_COMPLETE`.
   *
   * Elle sépare « l'état est réparé » de « les services travaillent ». Elle a
   * sa propre section parce qu'elle est la seule chose qui autorise le passage
   * — la confondre avec les invariants finaux ferait disparaître la question
   * qu'elle pose : à partir de quand un worker peut-il lire cette base sans
   * risquer d'y voir un état que l'amorçage doit encore corriger ?
   */
  STRUCTURAL_INVARIANTS: 'STRUCTURAL INVARIANTS',
  SERVICE_INVARIANTS: 'SERVICE INVARIANTS',
  INVARIANTS: 'INVARIANTS',
});

/**
 * L'ISSUE d'un contrôle de démarrage — quatre valeurs, et pas une de plus.
 *
 * `NOT_REQUIRED` n'est PAS un succès dégradé : c'est le constat qu'aucune
 * action n'était due. Les confondre ferait passer « Brevo n'est pas configuré »
 * pour « Brevo fonctionne », ce qui est le mensonge le plus coûteux d'un
 * démarrage.
 */
export const BOOT_OUTCOME = Object.freeze({
  OK: 'OK',
  NOT_REQUIRED: 'NOT_REQUIRED',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
});

/**
 * L'ÉTAT DE DÉMARRAGE D'UNE INTEGRATED API — le vocabulaire commun.
 *
 * Il vaut pour TOUS les fournisseurs, présents et futurs : le code qui le
 * calcule (`integratedApiStartup.service.js`) ne cite aucun nom.
 *
 *   DISABLED          le fournisseur est désactivé — rien n'est dû ;
 *   NOT_REQUIRED      aucune action de démarrage n'est requise (non configuré,
 *                     administré par la plateforme, sans webhook géré…) ;
 *   DEFERRED          rien n'est FAISABLE maintenant, la dépendance manquante
 *                     est NOMMÉE, et le geste est ARMÉ — il repartira seul dès
 *                     qu'elle apparaîtra ;
 *   READY             les prérequis ont été CONSTATÉS, rien à corriger ;
 *   RECONCILING       une réconciliation est en cours (état transitoire) ;
 *   READY_RECONCILED  une réconciliation distante a réellement eu lieu ;
 *   DEGRADED_RETRYING l'action due n'a pas abouti ; une reprise est programmée ;
 *   FAILED_BLOCKING   l'action due a échoué et interdit de servir.
 *
 * ── POURQUOI `DEFERRED` N'EST NI `NOT_REQUIRED` NI `DEGRADED_RETRYING` ──────
 *
 * Un projet AUTONOME n'a personne à qui demander le provisionnement de son
 * webhook Stripe. Le compter dégradé ferait rougir chaque démarrage normal, et
 * un rapport toujours rouge finit par n'être plus lu. Le compter
 * `NOT_REQUIRED` serait le mensonge inverse : le geste EST dû, simplement pas
 * encore possible — et c'est exactement l'ambiguïté qui laissait « Stripe :
 * réconciliation sautée » sans suite.
 *
 * `DEFERRED` dit les deux choses à la fois : rien n'est cassé, ET rien n'est
 * perdu. La preuve en est le travail armé dans le gestionnaire de reprises,
 * que `/readyz` énumère nommément.
 */
export const INTEGRATED_API_STARTUP = Object.freeze({
  DISABLED: 'DISABLED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  DEFERRED: 'DEFERRED',
  READY: 'READY',
  RECONCILING: 'RECONCILING',
  READY_RECONCILED: 'READY_RECONCILED',
  DEGRADED_RETRYING: 'DEGRADED_RETRYING',
  FAILED_BLOCKING: 'FAILED_BLOCKING',
});

/** Traduction état IntegratedAPI → issue de démarrage (pour la totalisation). */
const OUTCOME_BY_API_STATUS = Object.freeze({
  [INTEGRATED_API_STARTUP.DISABLED]: BOOT_OUTCOME.NOT_REQUIRED,
  [INTEGRATED_API_STARTUP.NOT_REQUIRED]: BOOT_OUTCOME.NOT_REQUIRED,
  /**
   * DIFFÉRÉ N'EST PAS DÉGRADÉ. Rien n'est en panne : une dépendance manque, le
   * geste est armé, et le service peut ouvrir sans réserve. Le compter dégradé
   * ferait annoncer « MODE DÉGRADÉ » à chaque démarrage d'un projet autonome —
   * c'est-à-dire au cas le plus courant.
   */
  [INTEGRATED_API_STARTUP.DEFERRED]: BOOT_OUTCOME.NOT_REQUIRED,
  [INTEGRATED_API_STARTUP.READY]: BOOT_OUTCOME.OK,
  [INTEGRATED_API_STARTUP.READY_RECONCILED]: BOOT_OUTCOME.OK,
  [INTEGRATED_API_STARTUP.RECONCILING]: BOOT_OUTCOME.DEGRADED,
  [INTEGRATED_API_STARTUP.DEGRADED_RETRYING]: BOOT_OUTCOME.DEGRADED,
  [INTEGRATED_API_STARTUP.FAILED_BLOCKING]: BOOT_OUTCOME.FAILED,
});

/** @type {{startedAt:string, finishedAt:string|null, entries:object[]}|null} */
let rapport = null;
let sectionCourante = null;

function maintenant() {
  return new Date().toISOString();
}

/** Ouvre un rapport neuf. Idempotent par écrasement : un démarrage, un rapport. */
export function beginBootstrapReport() {
  rapport = { startedAt: maintenant(), finishedAt: null, entries: [] };
  sectionCourante = null;
  return rapport;
}

function assurerRapport() {
  if (!rapport) beginBootstrapReport();
  return rapport;
}

/**
 * Imprime le titre d'une section — une fois, et seulement si elle change.
 *
 * Le rapport reste utilisable sans aucun titre (les recettes n'en veulent
 * pas) : l'affichage est une commodité, jamais une donnée.
 */
export function bootstrapSection(section) {
  if (sectionCourante === section) return;
  sectionCourante = section;
  logger.section(section);
}

/**
 * DÉPOSE UN CONSTAT, et le journalise dans la foulée.
 *
 * Enregistrer et journaliser au même endroit n'est pas une commodité : c'est
 * ce qui garantit que la ligne lue par l'exploitant et la ligne comptée par le
 * résumé décrivent le MÊME fait. Deux chemins finiraient par diverger, et le
 * jour où ils divergeraient, c'est le résumé qu'on croirait.
 *
 * @param {object} constat
 * @param {string} constat.section  une valeur de BOOT_SECTION
 * @param {string} constat.name     ce qui a été contrôlé (« MongoDB », « STRIPE/payment »)
 * @param {string} constat.outcome  une valeur de BOOT_OUTCOME
 * @param {string} [constat.proof]  OBLIGATOIRE si `outcome === OK` — ce qui a été vérifié
 * @param {string} [constat.reason] code stable expliquant un NOT_REQUIRED / DEGRADED / FAILED
 * @param {string} [constat.detail] phrase libre destinée à l'humain
 * @param {boolean} [constat.blocking] un échec interdit-il de servir ? (défaut : outcome === FAILED)
 * @param {string} [constat.kind]   'CHECK' (défaut) | 'INTEGRATED_API'
 */
export function recordCheck(constat) {
  const r = assurerRapport();
  const {
    section, name, outcome, proof = '', reason = '', detail = '',
    blocking, kind = 'CHECK', provider = null, capability = null,
    status = null, retryKey = null, silent = false,
  } = constat;

  if (outcome === BOOT_OUTCOME.OK && !proof) {
    /**
     * PAS DE `[ ok ]` SANS PREUVE — la règle est appliquée par le code, pas
     * par la discipline de celui qui l'écrit. Un succès non prouvé est
     * reclassé DEGRADED plutôt que refusé : faire échouer un démarrage pour
     * une faute de journalisation serait pire que le défaut qu'on corrige.
     */
    logger.warn(`[bootstrap] « ${name} » a déclaré un succès sans preuve — reclassé DEGRADED.`);
    return recordCheck({ ...constat, outcome: BOOT_OUTCOME.DEGRADED, reason: reason || 'PROOF_MISSING' });
  }

  const entree = {
    section,
    name,
    outcome,
    proof,
    reason,
    detail,
    kind,
    provider,
    capability,
    status,
    retryKey,
    blocking: blocking ?? outcome === BOOT_OUTCOME.FAILED,
    at: maintenant(),
  };
  r.entries.push(entree);

  if (!silent) {
    bootstrapSection(section);
    journaliser(entree);
  }
  return entree;
}

/** Le libellé d'une ligne : nom, état, puis la raison OU la preuve. */
function ligne(entree) {
  const etat = entree.status ? ` : ${entree.status}` : '';
  const queue = entree.detail || entree.proof || entree.reason || '';
  const motif = entree.reason && entree.detail ? ` (${entree.reason})` : '';
  return `${entree.name}${etat}${queue ? ` — ${queue}` : ''}${motif}`;
}

function journaliser(entree) {
  const texte = ligne(entree);
  switch (entree.outcome) {
    case BOOT_OUTCOME.OK:
      logger.success(texte);
      break;
    case BOOT_OUTCOME.NOT_REQUIRED:
      logger.info(texte);
      break;
    case BOOT_OUTCOME.DEGRADED:
      logger.warn(texte);
      break;
    default:
      logger.error(texte);
  }
}

/**
 * Dépose le constat de démarrage d'une IntegratedAPI.
 *
 * L'issue n'est pas fournie : elle est DÉDUITE de l'état. Laisser l'appelant
 * choisir les deux permettrait un jour d'écrire « READY / DEGRADED », c'est-à-
 * dire une ligne dont le journal et le résumé ne diraient pas la même chose.
 */
export function recordIntegratedApi({
  provider, capability = null, status, reason = '', detail = '', proof = '', retryKey = null,
}) {
  const outcome = OUTCOME_BY_API_STATUS[status] ?? BOOT_OUTCOME.DEGRADED;
  return recordCheck({
    section: BOOT_SECTION.INTEGRATED_APIS,
    name: capability ? `${provider}/${capability}` : String(provider),
    kind: 'INTEGRATED_API',
    provider,
    capability,
    status,
    outcome,
    /**
     * Un état READY sans preuve serait exactement le faux positif que la
     * doctrine interdit : on en fabrique une par défaut à partir de l'état,
     * mais l'appelant est censé fournir la vraie.
     */
    proof: outcome === BOOT_OUTCOME.OK ? proof || status : proof,
    reason,
    detail,
    retryKey,
    blocking: status === INTEGRATED_API_STARTUP.FAILED_BLOCKING,
  });
}

/**
 * MET À JOUR un constat d'IntegratedAPI déjà déposé — le cas de la reprise.
 *
 * ── POURQUOI CE VERBE EXISTE ────────────────────────────────────────────────
 *
 * Un webhook réconcilié quarante secondes après le démarrage doit CESSER
 * d'apparaître dégradé. Sans mise à jour, `/readyz` continuerait d'annoncer un
 * état résolu depuis longtemps — et l'exploitant chercherait une panne éteinte.
 */
export function updateIntegratedApi(provider, capability, patch = {}) {
  const r = assurerRapport();
  const entree = [...r.entries].reverse().find(
    (e) => e.kind === 'INTEGRATED_API' && e.provider === provider && e.capability === capability
  );
  if (!entree) return null;
  if (patch.status) {
    entree.status = patch.status;
    entree.outcome = OUTCOME_BY_API_STATUS[patch.status] ?? BOOT_OUTCOME.DEGRADED;
    entree.blocking = patch.status === INTEGRATED_API_STARTUP.FAILED_BLOCKING;
  }
  for (const cle of ['reason', 'detail', 'proof']) {
    if (patch[cle] !== undefined) entree[cle] = patch[cle];
  }
  entree.at = maintenant();
  return entree;
}

/* -------------------------------------------------------------------------- */
/*  TOTALISATION                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Le résumé CALCULÉ. Aucun compteur n'est tenu à la main : ils sont dérivés des
 * constats, donc incapables de diverger de ce que le journal a montré.
 */
export function bootstrapSummary() {
  const r = assurerRapport();
  const compter = (section, predicat) =>
    r.entries.filter((e) => e.section === section && predicat(e)).length;

  const sectionStats = (section) => ({
    ok: compter(section, (e) => e.outcome === BOOT_OUTCOME.OK),
    notRequired: compter(section, (e) => e.outcome === BOOT_OUTCOME.NOT_REQUIRED),
    degraded: compter(section, (e) => e.outcome === BOOT_OUTCOME.DEGRADED),
    failed: compter(section, (e) => e.outcome === BOOT_OUTCOME.FAILED),
    total: compter(section, () => true),
  });

  const apis = r.entries.filter((e) => e.kind === 'INTEGRATED_API');
  const parEtat = (etat) => apis.filter((e) => e.status === etat).length;

  const blockingFailures = r.entries.filter((e) => e.blocking && e.outcome === BOOT_OUTCOME.FAILED);

  return {
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    core: sectionStats(BOOT_SECTION.CORE),
    panel: sectionStats(BOOT_SECTION.PANEL),
    background: sectionStats(BOOT_SECTION.BACKGROUND),
    recovery: sectionStats(BOOT_SECTION.RECOVERY),
    structuralInvariants: sectionStats(BOOT_SECTION.STRUCTURAL_INVARIANTS),
    serviceInvariants: sectionStats(BOOT_SECTION.SERVICE_INVARIANTS),
    invariants: sectionStats(BOOT_SECTION.INVARIANTS),
    integratedApi: {
      ready: parEtat(INTEGRATED_API_STARTUP.READY) + parEtat(INTEGRATED_API_STARTUP.READY_RECONCILED),
      reconciled: parEtat(INTEGRATED_API_STARTUP.READY_RECONCILED),
      notRequired: parEtat(INTEGRATED_API_STARTUP.NOT_REQUIRED) + parEtat(INTEGRATED_API_STARTUP.DISABLED),
      deferred: parEtat(INTEGRATED_API_STARTUP.DEFERRED),
      degraded: parEtat(INTEGRATED_API_STARTUP.DEGRADED_RETRYING) + parEtat(INTEGRATED_API_STARTUP.RECONCILING),
      failed: parEtat(INTEGRATED_API_STARTUP.FAILED_BLOCKING),
      total: apis.length,
    },
    blockingErrors: blockingFailures.length,
    blockingDetails: blockingFailures.map((e) => `${e.name}${e.reason ? ` (${e.reason})` : ''}`),
    degradedDetails: r.entries
      .filter((e) => e.outcome === BOOT_OUTCOME.DEGRADED)
      .map((e) => `${e.name}${e.reason ? ` (${e.reason})` : ''}`),
  };
}

/** L'état complet — pour `/readyz` et les recettes. Jamais de secret. */
export function describeBootstrapReport() {
  const r = assurerRapport();
  return {
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summary: bootstrapSummary(),
    entries: r.entries.map((e) => ({
      section: e.section, name: e.name, outcome: e.outcome, status: e.status,
      reason: e.reason, proof: e.proof, detail: e.detail, blocking: e.blocking, at: e.at,
    })),
  };
}

/** Les constats qui INTERDISENT de servir. Vide = le service peut s'ouvrir. */
export function bootstrapBlockingFailures() {
  return assurerRapport().entries.filter((e) => e.blocking && e.outcome === BOOT_OUTCOME.FAILED);
}

export class BootstrapBlockedError extends Error {
  constructor(failures) {
    super(
      `Amorçage impossible — ${failures.length} prérequis bloquant(s) non satisfait(s) : `
      + failures.map((f) => `${f.name}${f.reason ? ` (${f.reason})` : ''}`).join(', ')
    );
    this.name = 'BootstrapBlockedError';
    this.code = 'BOOTSTRAP_BLOCKED';
    this.failures = failures.map((f) => ({ name: f.name, reason: f.reason, detail: f.detail }));
  }
}

/**
 * LA CONDITION DE PASSAGE À READY — écrite une fois, appliquée par le seul
 * appelant autorisé (`server.js`).
 *
 * Elle ne dit PAS « tout est vert ». Elle dit « rien de ce qui est
 * indispensable au fonctionnement métier ne manque ». Un fournisseur en
 * reprise, un Panel injoignable, un webhook différé : le service ouvre, et
 * l'état dégradé est ANNONCÉ. C'est la distinction que le lot exige — ne pas
 * transformer une panne externe en refus de démarrer.
 */
export function assertBootstrapInvariants() {
  const echecs = bootstrapBlockingFailures();
  if (echecs.length > 0) throw new BootstrapBlockedError(echecs);
  return true;
}

/**
 * CLÔT le rapport et journalise le résumé — la dernière ligne avant « PRÊTE ».
 *
 * @param {object} [opts]
 * @param {number} [opts.pendingRetries] reprises encore programmées (retry manager)
 */
export function finalizeBootstrapReport({ pendingRetries = 0, deferred = 0 } = {}) {
  const r = assurerRapport();
  r.finishedAt = maintenant();
  const resume = bootstrapSummary();
  resume.pendingRetries = pendingRetries;
  resume.deferredJobs = deferred;

  bootstrapSection(BOOT_SECTION.INVARIANTS);

  /**
   * LE DÉNOMINATEUR COMPTE CE QUI ÉTAIT DÛ, PAS CE QUI EXISTE.
   *
   * `panel=1/2` se lisait comme un manque, alors que le second constat était
   * « aucun appairage persisté — mode autonome », c'est-à-dire un état normal
   * où rien n'était dû. Un ratio qui compte les non-requis au dénominateur
   * annonce un échec permanent à tout projet qui n'utilise pas une option —
   * et un compteur qui n'est jamais plein cesse d'être lu.
   */
  const ratio = (s) => {
    const dus = s.ok + s.degraded + s.failed;
    return `${s.ok}/${dus}${s.notRequired ? ` (+${s.notRequired} non requis)` : ''}`;
  };

  const api = resume.integratedApi;
  const lignes = [
    `core=${ratio(resume.core)}`,
    `panel=${ratio(resume.panel)}`,
    `integratedApi=${api.ready} ready · ${api.notRequired} not_required · ${api.deferred} deferred · ${api.degraded} degraded · ${api.failed} failed`,
    `webhooks=${api.ready} conforme(s) dont ${api.reconciled} corrigé(s) au démarrage`,
    `services=${ratio(resume.background)}`,
    `reprises=${ratio(resume.recovery)}`,
    `structuralInvariants=${ratio(resume.structuralInvariants)}`,
    `serviceInvariants=${ratio(resume.serviceInvariants)}`,
    `invariants=${ratio(resume.invariants)}`,
    `blockingErrors=${resume.blockingErrors}`,
    `pendingRetries=${pendingRetries}`,
    `deferred=${deferred} (armé(s), en attente d’une dépendance)`,
  ];

  const degrade = resume.degradedDetails.length > 0 || pendingRetries > 0;
  const entete = resume.blockingErrors > 0
    ? 'Bootstrap INTERROMPU :'
    : degrade
      ? 'Bootstrap terminé en mode DÉGRADÉ :'
      : 'Bootstrap terminé :';
  const corps = `${entete}\n       ${lignes.join('\n       ')}`;

  if (resume.blockingErrors > 0) logger.error(corps);
  else if (degrade) logger.warn(corps);
  else logger.success(corps);

  if (resume.degradedDetails.length > 0) {
    logger.warn(`       dégradé(s) : ${resume.degradedDetails.join(', ')}`);
  }
  if (resume.blockingDetails.length > 0) {
    logger.error(`       bloquant(s) : ${resume.blockingDetails.join(', ')}`);
  }

  return resume;
}

/** Remise à zéro — recettes qui amorcent plusieurs fois un même processus. */
export function resetBootstrapReportForTests() {
  rapport = null;
  sectionCourante = null;
}

export default {
  BOOT_SECTION,
  BOOT_OUTCOME,
  INTEGRATED_API_STARTUP,
  beginBootstrapReport,
  bootstrapSection,
  recordCheck,
  recordIntegratedApi,
  updateIntegratedApi,
  bootstrapSummary,
  describeBootstrapReport,
  bootstrapBlockingFailures,
  assertBootstrapInvariants,
  finalizeBootstrapReport,
  resetBootstrapReportForTests,
};
