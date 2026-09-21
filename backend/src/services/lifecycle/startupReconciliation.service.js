/**
 * LES RECONCILIATIONS DE DÉMARRAGE QUI N'ONT PAS ABOUTI — et ce qu'on en fait.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Une réconciliation sautée faute de dépendance ne laissait AUCUNE trace
 * exploitable : un `return { skipped: true }`, une ligne de journal, et plus
 * personne pour y revenir. Quand la dépendance arrivait — deux secondes plus
 * tard, dans le cas du Panel — rien ne le savait.
 *
 * Un `return` n'est pas une décision : c'est un abandon silencieux. Ce module
 * transforme l'abandon en OBLIGATION DIFFÉRÉE — nommée, comptée, reprise, et
 * visible dans le résumé de démarrage tant qu'elle n'est pas honorée.
 *
 * ══ CE QU'IL GARANTIT ═══════════════════════════════════════════════════════
 *
 *   · CLÉ UNIQUE par travail — deux inscriptions du même geste n'en font
 *     qu'un ; c'est ce qui interdit deux webhooks distants pour une reprise ;
 *   · IDEMPOTENCE — le travail lui-même est rejouable ; le gestionnaire ne
 *     fait que décider QUAND, jamais ce qui est fait ;
 *   · NON-RÉENTRANCE — une reprise en cours n'est jamais doublée par un tic ;
 *   · REPLI BORNÉ — cinq tentatives, délais croissants, puis abandon EXPLICITE
 *     (jamais une boucle qui martèle un fournisseur en panne) ;
 *   · ARRÊT — tous les minuteurs meurent au drainage : un redémarrage de
 *     développement ne laisse aucun travail fantôme derrière lui ;
 *   · ARRÊT SUR SUCCÈS — un travail réussi est retiré, pas simplement marqué.
 *
 * ══ POURQUOI ICI, ET PAS UN `setTimeout` PAR APPELANT ═══════════════════════
 *
 * Parce qu'un `setTimeout` dispersé n'est ni comptable, ni arrêtable, ni
 * observable. Le résumé de démarrage doit pouvoir dire « 1 reprise en
 * attente », et l'arrêt doit pouvoir tout éteindre — deux propriétés qu'aucune
 * minuterie locale ne peut offrir.
 */
import { logger } from '../../utils/logger.js';
import { onDrain, isShuttingDown } from './runtimeLifecycle.js';

export const STARTUP_JOB_STATE = Object.freeze({
  PENDING: 'PENDING',
  /** ARMÉ : aucune échéance, part sur ÉVÉNEMENT (voir `gated` ci-dessous). */
  ARMED: 'ARMED',
  RUNNING: 'RUNNING',
  RETRYING: 'RETRYING',
  SUCCEEDED: 'SUCCEEDED',
  EXHAUSTED: 'EXHAUSTED',
});

/**
 * REPLI BORNÉ — quinze secondes, puis doublement, plafonné à cinq minutes.
 *
 * La première tentative est proche : le cas le plus fréquent est une
 * dépendance qui arrive dans la seconde (appairage restauré, tunnel monté).
 * Les suivantes s'espacent : au-delà, c'est une vraie panne, et marteler un
 * fournisseur en difficulté ne l'aide pas.
 */
const BACKOFF_MS = Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000]);
const MAX_ATTEMPTS = BACKOFF_MS.length;

/** @type {Map<string, object>} clé de travail → descripteur. */
const travaux = new Map();
let arretInscrit = false;

function inscrireArret() {
  if (arretInscrit) return;
  arretInscrit = true;
  /**
   * L'ARRÊT S'INSCRIT AU CHARGEMENT DU MODULE QUI DÉMARRE LE TRAVAIL.
   *
   * Le laisser à l'appelant reviendrait à espérer qu'il y pense. Un minuteur
   * de reprise survivant à un `disconnect()` ferait exactement ce que le
   * drainage existe pour empêcher : lire une base fermée, et journaliser une
   * fausse panne sur un arrêt parfaitement normal.
   */
  onDrain(() => stopStartupReconciliation(), { label: 'reprises de démarrage' });
}

/**
 * Inscrit — ou remplace — un travail de reprise.
 *
 * @param {object} spec
 * @param {string} spec.key         identité STABLE du geste (« webhook:STRIPE:payment:TEST »)
 * @param {string} [spec.provider]
 * @param {string} [spec.capability]
 * @param {string} spec.label       libellé humain, utilisé dans le journal
 * @param {Function} spec.run       async () => { ok:boolean, done?:boolean, reason?:string, detail?:string }
 *                                  `done: true` signifie « plus rien n'est dû » (le travail est retiré).
 * @param {number} [spec.maxAttempts]
 * @param {boolean} [spec.gated]    travail ARMÉ, jamais programmé dans le temps.
 *
 * ── POURQUOI `gated` EXISTE ─────────────────────────────────────────────────
 *
 * Certaines dépendances ne reviennent pas d'elles-mêmes : un projet autonome
 * n'aura pas de Panel dans quinze secondes, ni dans cinq minutes — il en aura
 * un le jour où quelqu'un l'appairera. Programmer une reprise reviendrait à
 * marteler un rendez-vous que personne n'a pris, puis à l'abandonner
 * « épuisé » alors que rien n'a échoué.
 *
 * Un travail armé ne consomme aucun minuteur et ne s'épuise jamais. Il attend
 * l'ÉVÉNEMENT — appairage établi, tunnel monté — et part à ce moment-là.
 */
export function registerStartupJob({
  key, provider = null, capability = null, label, run, maxAttempts = MAX_ATTEMPTS,
  reason = '', detail = '', gated = false,
}) {
  if (typeof run !== 'function') throw new Error('registerStartupJob : `run` est requis.');
  inscrireArret();

  const existant = travaux.get(key);
  if (existant?.timer) clearTimeout(existant.timer);

  const travail = {
    key,
    provider,
    capability,
    label: label || key,
    run,
    gated: Boolean(gated),
    maxAttempts: Math.max(1, Math.min(maxAttempts, MAX_ATTEMPTS)),
    attempts: existant?.attempts ?? 0,
    state: gated ? STARTUP_JOB_STATE.ARMED : STARTUP_JOB_STATE.PENDING,
    lastReason: reason,
    lastDetail: detail,
    nextAttemptAt: null,
    timer: null,
    running: false,
  };
  travaux.set(key, travail);
  return travail;
}

/** Un travail n'est plus dû : on le retire (succès, ou plus rien à faire). */
function retirer(travail, etat) {
  if (travail.timer) clearTimeout(travail.timer);
  travail.timer = null;
  travail.nextAttemptAt = null;
  travail.state = etat;
  travaux.delete(travail.key);
}

/**
 * EXÉCUTE un travail UNE fois. Ne lève jamais.
 *
 * La non-réentrance est portée ici plutôt que par l'appelant : le même travail
 * peut être relancé par un tic de reprise, par la restauration de l'appairage
 * et par une commande manuelle — trois chemins qui ne se connaissent pas.
 */
export async function runStartupJob(key, { trigger = 'manual' } = {}) {
  const travail = travaux.get(key);
  if (!travail) return { key, ran: false, reason: 'UNKNOWN_JOB' };
  if (travail.running) return { key, ran: false, reason: 'ALREADY_RUNNING' };
  if (isShuttingDown()) return { key, ran: false, reason: 'SHUTTING_DOWN' };

  travail.running = true;
  travail.state = STARTUP_JOB_STATE.RUNNING;
  travail.attempts += 1;
  if (travail.timer) { clearTimeout(travail.timer); travail.timer = null; }

  let issue;
  try {
    issue = await travail.run({ attempt: travail.attempts, trigger });
  } catch (err) {
    issue = { ok: false, reason: err?.code || 'JOB_THREW', detail: String(err?.message || err) };
  } finally {
    travail.running = false;
  }

  travail.lastReason = issue?.reason || '';
  travail.lastDetail = issue?.detail || '';

  /**
   * ══ LA NATURE D'UN TRAVAIL PEUT CHANGER ENTRE DEUX TENTATIVES ══════════════
   *
   * ── LE TROU QUE CECI FERME ─────────────────────────────────────────────────
   *
   * Un travail ARMÉ attend un événement — l'appairage, par exemple. Quand
   * l'événement arrive et que la tentative échoue pour une TOUTE AUTRE raison
   * (le Panel répond 503), le travail restait armé : aucune échéance, et plus
   * aucun événement à espérer puisque l'appairage a déjà eu lieu. Le geste
   * dormait jusqu'au prochain redémarrage — exactement l'abandon silencieux que
   * ce module existe pour supprimer, une itération plus loin.
   *
   * L'exécutant rend donc la classification COURANTE de son échec. Un travail
   * armé dont la dépendance est arrivée devient une reprise ordinaire et reçoit
   * son repli borné ; à l'inverse, une reprise ordinaire qui découvre que la
   * dépendance a disparu (projet désappairé) redevient armée, et cesse de
   * brûler ses tentatives contre un mur.
   */
  if (typeof issue?.gated === 'boolean' && issue.gated !== travail.gated) {
    travail.gated = issue.gated;
    travail.attempts = issue.gated ? travail.attempts : 0;
  }

  if (issue?.ok) {
    retirer(travail, STARTUP_JOB_STATE.SUCCEEDED);
    logger.success(
      `Reprise de démarrage « ${travail.label} » aboutie à la tentative ${travail.attempts}`
      + `${issue.detail ? ` — ${issue.detail}` : ''}.`
    );
    return { key, ran: true, ok: true, done: true, attempts: travail.attempts, detail: issue.detail || '' };
  }

  if (issue?.done) {
    /**
     * « PLUS RIEN N'EST DÛ » n'est pas un succès, et ne doit pas se déguiser en
     * un. Le cas type : un fournisseur qu'on a désactivé entre-temps. On cesse
     * de reprendre, et on DIT pourquoi.
     */
    retirer(travail, STARTUP_JOB_STATE.SUCCEEDED);
    logger.info(
      `Reprise de démarrage « ${travail.label} » sans objet — ${issue.reason || 'plus rien n’est dû'}.`
    );
    return { key, ran: true, ok: false, done: true, attempts: travail.attempts, reason: issue.reason || '' };
  }

  /**
   * UN TRAVAIL ARMÉ NE S'ÉPUISE PAS et ne programme rien : la dépendance qui
   * lui manque ne reviendra pas d'elle-même. Il retourne à l'état ARMÉ, et
   * attend le prochain événement.
   */
  if (travail.gated) {
    travail.state = STARTUP_JOB_STATE.ARMED;
    travail.nextAttemptAt = null;
    return { key, ran: true, ok: false, done: false, armed: true, attempts: travail.attempts, reason: issue?.reason || '' };
  }

  if (travail.attempts >= travail.maxAttempts) {
    travail.state = STARTUP_JOB_STATE.EXHAUSTED;
    travail.nextAttemptAt = null;
    logger.warn(
      `Reprise de démarrage « ${travail.label} » ABANDONNÉE après ${travail.attempts} tentatives`
      + `${issue?.reason ? ` (${issue.reason})` : ''} — l’état reste DÉGRADÉ et visible dans /readyz.`
    );
    return { key, ran: true, ok: false, done: false, exhausted: true, attempts: travail.attempts, reason: issue?.reason || '' };
  }

  return { key, ran: true, ok: false, done: false, ...scheduleStartupRetry(key) };
}

/** Programme la prochaine tentative d'un travail, selon son repli borné. */
export function scheduleStartupRetry(key) {
  const travail = travaux.get(key);
  if (!travail || isShuttingDown()) return { scheduled: false };
  /** Un travail armé n'a pas d'échéance : le programmer serait le dénaturer. */
  if (travail.gated) return { scheduled: false, armed: true };
  if (travail.timer) clearTimeout(travail.timer);

  const delai = BACKOFF_MS[Math.min(travail.attempts, BACKOFF_MS.length - 1)];
  travail.state = STARTUP_JOB_STATE.RETRYING;
  travail.nextAttemptAt = new Date(Date.now() + delai).toISOString();
  travail.timer = setTimeout(() => {
    travail.timer = null;
    void runStartupJob(key, { trigger: 'backoff' });
  }, delai);
  /**
   * `unref()` — un processus qui n'a plus rien à faire doit pouvoir sortir. Un
   * minuteur de reprise qui retiendrait Node ferait échouer chaque recette, et
   * transformerait un `Ctrl-C` en attente inexplicable.
   */
  travail.timer.unref?.();
  return { scheduled: true, delayMs: delai, nextAttemptAt: travail.nextAttemptAt, attempts: travail.attempts };
}

/**
 * REJOUE TOUT CE QUI EST EN ATTENTE — le geste de la §12.
 *
 * Appelé quand une dépendance structurante APPARAÎT (appairage du Panel
 * restauré ou établi, tunnel monté). Séquentiel à dessein : deux
 * réconciliations distantes lancées ensemble sur le même fournisseur
 * s'entrechoqueraient, et l'idempotence n'est une garantie que par appel.
 */
export async function runPendingStartupJobs({ trigger = 'dependency-available' } = {}) {
  const cles = [...travaux.keys()];
  const issues = [];
  for (const cle of cles) {
    const travail = travaux.get(cle);
    if (!travail || travail.running) continue;
    /**
     * Une dépendance qui arrive REMET LE COMPTEUR À ZÉRO. L'épuisement
     * sanctionnait l'absence de cette dépendance ; la punir encore alors
     * qu'elle est là refuserait de réparer ce qui est réparable.
     */
    if (travail.state === STARTUP_JOB_STATE.EXHAUSTED) travail.attempts = 0;
    // eslint-disable-next-line no-await-in-loop
    issues.push(await runStartupJob(cle, { trigger }));
  }
  return issues;
}

/**
 * Nombre de reprises encore DUES — programmées ou épuisées, jamais armées.
 *
 * Les travaux armés en sont exclus à dessein : ils comptent une attente, pas
 * une dette. Les mêler ferait annoncer « mode dégradé » à chaque démarrage
 * d'un projet autonome, et l'annonce cesserait d'être lue.
 */
export function pendingStartupJobCount() {
  return [...travaux.values()].filter((t) => !t.gated).length;
}

/** Nombre de travaux ARMÉS — en attente d'une dépendance, sans échéance. */
export function deferredStartupJobCount() {
  return [...travaux.values()].filter((t) => t.gated).length;
}

/** État LISIBLE des reprises — `/readyz`, écran de diagnostic, recettes. */
export function describeStartupReconciliation() {
  return [...travaux.values()].map((t) => ({
    key: t.key,
    provider: t.provider,
    capability: t.capability,
    label: t.label,
    state: t.state,
    gated: t.gated,
    attempts: t.attempts,
    maxAttempts: t.maxAttempts,
    nextAttemptAt: t.nextAttemptAt,
    lastReason: t.lastReason,
    lastDetail: t.lastDetail,
  }));
}

/** Éteint TOUS les minuteurs de reprise. Idempotent — appelé au drainage. */
export function stopStartupReconciliation() {
  for (const travail of travaux.values()) {
    if (travail.timer) clearTimeout(travail.timer);
    travail.timer = null;
    travail.nextAttemptAt = null;
  }
  return { stopped: travaux.size };
}

/** Remise à zéro complète — recettes uniquement. */
export function resetStartupReconciliationForTests() {
  stopStartupReconciliation();
  travaux.clear();
}

export default {
  STARTUP_JOB_STATE,
  registerStartupJob,
  runStartupJob,
  runPendingStartupJobs,
  scheduleStartupRetry,
  pendingStartupJobCount,
  deferredStartupJobCount,
  describeStartupReconciliation,
  stopStartupReconciliation,
  resetStartupReconciliationForTests,
};
