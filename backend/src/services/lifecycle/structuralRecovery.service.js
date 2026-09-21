/**
 * LES REPRISES STRUCTURELLES — et pourquoi elles doivent précéder TOUT worker.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Ces reprises vivaient dans `server.js`, APRÈS `bootstrap()`. Or `bootstrap()`
 * démarre les services de fond. L'ordre réel était donc :
 *
 *     BACKGROUND SERVICES  →  REPRISES  →  INVARIANTS  →  READY
 *
 * Autrement dit : l'ordonnanceur du pont battait, le signe de vie annonçait
 * « OK » au Panel, les déclencheurs de synchronisation étaient armés et la
 * veille du tunnel tournait — pendant que l'état structurel du projet était
 * encore en cours de réparation.
 *
 * ── CE QUE CELA COÛTAIT CONCRÈTEMENT ────────────────────────────────────────
 *
 * `migrateDeploymentTargets()` ne répare PAS le cas « deux destinations actives
 * dans le même environnement » : elle REFUSE le démarrage. Le processus sortait
 * donc en erreur — mais après avoir dit au Panel qu'il était vivant et en bonne
 * santé. Un backend qui s'annonce sain puis meurt est pire qu'un backend qui ne
 * démarre pas : la supervision a enregistré un signe de vie qui n'engageait
 * rien.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Il ne réécrit aucune reprise : il les ORDONNE, les CLASSE, et rend leur issue
 * au rapport d'amorçage. Le contenu de chacune est inchangé — c'est le lifecycle
 * qui était faux, pas le travail.
 */
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { finalizeOrphanRuns } from '../deploymentRun.service.js';
import { migrateDeploymentTargets } from '../deployment/destinationLifecycle.service.js';
import { migratePortRegistry } from '../deployment/portRegistry.service.js';
import { migrateProjectMedia } from '../media/projectMedia.service.js';
import { recoverOrphanRuns } from '../deployment/forensics/runSteps.service.js';
import { consommerMarqueurReprise } from '../deployment/forensics/restartMarker.service.js';
import { recoverAbandonedWebhookEvents } from '../webhooks/webhookRecovery.js';
import {
  BOOT_SECTION, BOOT_OUTCOME, recordCheck,
} from './bootstrapReport.service.js';

/**
 * LA CLASSIFICATION D'UNE REPRISE — déduite de ce que son ÉCHEC laisserait
 * derrière lui, jamais de sa place dans le fichier.
 *
 *   STRUCTURAL / BLOCKING   elle porte une garantie que le reste du système
 *                           suppose vraie. Sans elle, un worker peut observer —
 *                           ou aggraver — un état incohérent. Son échec interdit
 *                           READY.
 *   BUSINESS / DEGRADABLE   elle complète ou referme des données métier. Son
 *                           échec laisse un état lisible et sera retenté au
 *                           démarrage suivant ; il ne rend aucun worker
 *                           dangereux.
 */
export const RECOVERY_CLASS = Object.freeze({
  STRUCTURAL_BLOCKING: 'STRUCTURAL_BLOCKING',
  BUSINESS_DEGRADABLE: 'BUSINESS_DEGRADABLE',
});

/** @type {{completed:boolean, startedAt:string|null, finishedAt:string|null, results:object, failures:object[]}} */
let etat = {
  completed: false,
  startedAt: null,
  finishedAt: null,
  results: {},
  failures: [],
};

/** Les reprises structurelles ont-elles TOUTES été exécutées ? */
export function structuralRecoveryCompleted() {
  return etat.completed;
}

/** Combien de reprises structurelles restent en vol ? (0 ou 1 — elles sont séquentielles.) */
export function structuralRecoveryPending() {
  return etat.startedAt && !etat.finishedAt ? 1 : 0;
}

export function describeStructuralRecovery() {
  return {
    completed: etat.completed,
    pending: structuralRecoveryPending(),
    startedAt: etat.startedAt,
    finishedAt: etat.finishedAt,
    results: { ...etat.results },
    failures: etat.failures.map((f) => ({ ...f })),
  };
}

/**
 * EXÉCUTE les reprises, dans l'ordre, en journalisant chacune.
 *
 * ── L'ORDRE INTERNE COMPTE AUSSI ────────────────────────────────────────────
 *
 * 1. Les DESTINATIONS d'abord : c'est la seule reprise bloquante, et la seule
 *    qui peut refuser le démarrage. La faire en premier évite de réparer des
 *    données pour un processus qui ne servira jamais.
 * 2. Le REGISTRE DES PORTS ensuite : il lit les destinations que l'étape 1
 *    vient de compléter (`lifecycleStatus`, `environment`). L'inverser le ferait
 *    travailler sur des fiches incomplètes.
 * 3. Les MÉDIAS, indépendants.
 * 4. Le MARQUEUR de reprise AVANT la reprise générique des runs — sinon un
 *    redémarrage parfaitement attendu (celui que le backend provoque en
 *    déployant sa propre application) serait qualifié d'incident.
 * 5. Les RUNS orphelins, puis la finalisation des plus anciens.
 *
 * Ne lève QUE pour une reprise `STRUCTURAL_BLOCKING`.
 */
export async function runStructuralRecovery() {
  etat = { completed: false, startedAt: new Date().toISOString(), finishedAt: null, results: {}, failures: [] };

  /* ── 1. DESTINATIONS — STRUCTURAL / BLOCKING ────────────────────────────── */
  /**
   * Elle porte « une seule destination ACTIVE par environnement » : elle
   * détecte les conflits (et REFUSE alors le démarrage), construit l'index
   * unique et le RELIT en base pour prouver qu'il existe.
   *
   * Son échec n'est pas absorbé : un démarrage qui la contourne annoncerait un
   * système conforme sans l'être — l'état le plus dangereux, puisque plus rien
   * ne signale l'absence de garantie.
   */
  let cycles = null;
  try {
    cycles = await migrateDeploymentTargets();
    etat.results.destinations = cycles;
    recordCheck({
      section: BOOT_SECTION.RECOVERY,
      name: 'Reprise des destinations',
      outcome: BOOT_OUTCOME.OK,
      proof: cycles?.lifecycleBackfilled
        ? `${cycles.lifecycleBackfilled} destination(s) reprise(s) dans le cycle de vie, index unique relu en base`
        : 'aucune destination à reprendre, index unique relu en base',
    });
  } catch (err) {
    etat.failures.push({ step: 'destinations', code: err?.code || 'DESTINATION_MIGRATION_FAILED', message: String(err?.message || err) });
    recordCheck({
      section: BOOT_SECTION.RECOVERY,
      name: 'Reprise des destinations',
      outcome: BOOT_OUTCOME.FAILED,
      blocking: true,
      reason: err?.code || 'DESTINATION_MIGRATION_FAILED',
      detail: String(err?.message || err),
    });
    etat.finishedAt = new Date().toISOString();
    /**
     * ON LÈVE ICI, et c'est tout le point du lot : aucun service de fond n'a
     * encore démarré. Le processus mourra sans avoir annoncé au Panel une santé
     * qu'il n'avait pas.
     */
    throw err;
  }

  /* ── 2. REGISTRE DES PORTS — STRUCTURAL, mais DÉGRADABLE ────────────────── */
  /**
   * Il complète des réservations et SIGNALE des conflits ; il n'en arbitre
   * aucun. Un conflit non repris ne rend aucun worker dangereux : c'est le
   * prochain DÉPLOIEMENT qui sera refusé, par une garde qui lui est propre.
   * Son échec est donc lisible et non bloquant.
   */
  const ports = await migratePortRegistry().catch((err) => ({ error: err }));
  etat.results.ports = ports;
  recordCheck({
    section: BOOT_SECTION.RECOVERY,
    name: 'Registre des ports',
    outcome: ports?.error ? BOOT_OUTCOME.DEGRADED : BOOT_OUTCOME.OK,
    proof: ports?.error
      ? ''
      : `${ports?.reservationsCreated || 0} réservation(s) inscrite(s), ${ports?.conflicts || 0} conflit(s) signalé(s)`,
    reason: ports?.error ? 'PORT_REGISTRY_FAILED' : '',
    detail: ports?.error ? String(ports.error?.message || ports.error) : '',
  });
  if (ports?.conflicts) {
    logger.warn(`${ports.conflicts} conflit(s) de port détecté(s) : le prochain déploiement des destinations concernées sera REFUSÉ tant qu'ils durent.`);
  }

  /* ── 3. MÉDIAS — BUSINESS / DÉGRADABLE ──────────────────────────────────── */
  const medias = await migrateProjectMedia().catch((err) => ({ error: err }));
  etat.results.medias = medias;
  recordCheck({
    section: BOOT_SECTION.RECOVERY,
    name: 'Reprise des médias',
    outcome: medias?.error ? BOOT_OUTCOME.DEGRADED : BOOT_OUTCOME.OK,
    proof: medias?.error
      ? ''
      : `${medias?.environmentBackfilled || 0} média(s) repris dans l'environnement ${config.env}`,
    reason: medias?.error ? 'MEDIA_MIGRATION_FAILED' : '',
    detail: medias?.error ? String(medias.error?.message || medias.error) : '',
  });

  /* ── 4 & 5. RUNS INTERROMPUS — BUSINESS / DÉGRADABLE ────────────────────── */
  const echecsRuns = [];
  const reprise = await consommerMarqueurReprise().catch((err) => {
    echecsRuns.push(`marqueur de reprise (${err?.code || err?.message})`);
    return null;
  });
  if (reprise?.consumed) {
    logger.info(`Redémarrage attendu constaté : run ${reprise.runId} repris (étape suivante ${reprise.nextExpectedStep ?? 'inconnue'}).`);
  } else if (reprise?.reason === 'PROCESS_INCHANGE') {
    logger.warn(`Marqueur de reprise présent mais le process n'a pas changé : run ${reprise.runId} laissé en l'état.`);
  }

  const repris = await recoverOrphanRuns({
    reason: 'process_restart',
    runRepris: reprise?.consumed ? reprise.runId : null,
  }).catch((err) => {
    echecsRuns.push(`reprise des runs orphelins (${err?.code || err?.message})`);
    return null;
  });
  if (repris?.recovered) {
    logger.warn(`${repris.recovered} déploiement(s) interrompu(s) par un redémarrage : étapes closes et journalisées.`);
  }

  const orphans = await finalizeOrphanRuns().catch((err) => {
    echecsRuns.push(`finalisation des runs orphelins (${err?.code || err?.message})`);
    return 0;
  });
  if (orphans) logger.warn(`${orphans} déploiement(s) orphelin(s) finalisé(s) (interrompus).`);

  etat.results.runs = { reprise, repris, orphans, echecs: echecsRuns };
  recordCheck({
    section: BOOT_SECTION.RECOVERY,
    name: 'Reprise des déploiements interrompus',
    outcome: echecsRuns.length === 0 ? BOOT_OUTCOME.OK : BOOT_OUTCOME.DEGRADED,
    proof: echecsRuns.length === 0
      ? `${repris?.recovered || 0} run(s) clos, ${repris?.preserved || 0} laissé(s) actif(s), ${orphans || 0} orphelin(s) finalisé(s)`
      : '',
    reason: echecsRuns.length === 0 ? '' : 'RUN_RECOVERY_FAILED',
    detail: echecsRuns.length === 0
      ? ''
      : `${echecsRuns.join(' ; ')} — un déploiement peut rester affiché « en cours » jusqu’au prochain démarrage`,
  });

  /* ── 6. WEBHOOKS ABANDONNÉS — BUSINESS / DÉGRADABLE ─────────────────────── */
  /**
   * ══ POURQUOI CETTE REPRISE EST ICI, ET PAS APRÈS LES WORKERS ═════════════
   *
   * Un processus tué entre l'enregistrement d'un événement fournisseur et son
   * application laisse un travail en suspens. Tant qu'il l'est, le contrat
   * qu'il devait faire converger est FAUX — un abonnement résilié dont le
   * contrat reste `ACTIVE`, un site servi qui ne devrait plus l'être.
   *
   * Les workers de fond lisent précisément cet état : l'ordonnanceur du pont
   * pousse la projection du contrat vers le Panel, la veille des impayés décide
   * de fermer ou non un site. Les laisser partir avant cette reprise leur
   * ferait propager, puis agir sur, un état que l'amorçage doit encore réparer.
   *
   * ── DÉGRADABLE, ET C'EST DÉLIBÉRÉ ───────────────────────────────────────
   *
   * Elle ne porte aucune garantie que les workers exigeraient : un événement
   * resté en file sera repris au prochain rejeu de Stripe. Son échec est donc
   * lisible et non bloquant — contrairement à l'unicité des destinations, qui
   * refuse le démarrage.
   */
  const webhooks = await recoverAbandonedWebhookEvents({
    reconcile: async () => {
      const { reconcileAll } = await import('../reconciliation.service.js');
      await reconcileAll({ actor: { type: 'SYSTEM', id: null } });
    },
  }).catch((err) => ({ error: err }));
  etat.results.webhooks = webhooks;
  recordCheck({
    section: BOOT_SECTION.RECOVERY,
    name: 'Reprise des webhooks abandonnés',
    outcome: webhooks?.error ? BOOT_OUTCOME.DEGRADED : BOOT_OUTCOME.OK,
    proof: webhooks?.error
      ? ''
      : `${webhooks?.scanned || 0} abandonné(s) examiné(s), ${webhooks?.rearmed || 0} remis en file, `
        + `${webhooks?.deadLettered || 0} abandonné(s) définitivement`
        + `${webhooks?.reconciled ? ', réconciliation déclenchée' : ''}`,
    reason: webhooks?.error ? 'WEBHOOK_RECOVERY_FAILED' : '',
    detail: webhooks?.error
      ? `${String(webhooks.error?.message || webhooks.error)} — les événements restent en file, `
        + 'et le prochain rejeu du fournisseur les reprendra'
      : '',
  });

  etat.finishedAt = new Date().toISOString();
  etat.completed = true;
  return describeStructuralRecovery();
}

/**
 * LES INVARIANTS STRUCTURELS — la frontière `STRUCTURAL_RECOVERY_COMPLETE`.
 *
 * ── CE QU'ILS SONT, ET CE QU'ILS NE SONT PAS ────────────────────────────────
 *
 * Ce ne sont pas les reprises relues une seconde fois : ce sont les GARANTIES
 * dont un service de fond a besoin pour ne pas travailler sur du sable. Ils
 * sont constatés ici, entre la dernière reprise et le premier worker, parce
 * que c'est le seul instant où la question a un sens.
 *
 * Ils sont déduits du runtime réel, pas d'une liste souhaitée :
 *   · l'index d'unicité des destinations a été RELU en base (`activeIndexVerified`) ;
 *   · aucune reprise n'est encore en vol ;
 *   · aucune reprise bloquante n'a échoué.
 *
 * Le registre des ports et l'état média n'y figurent pas comme garanties : le
 * code réel ne leur en fait porter aucune — les conflits de port sont arbitrés
 * au déploiement, et un média non repris n'est lu par aucun worker. Les
 * inscrire ici aurait produit un invariant décoratif, c'est-à-dire un invariant
 * qu'on finit par contourner.
 */
export function assertStructuralInvariants() {
  const constats = [];

  const indexVerifie = etat.results?.destinations?.activeIndexVerified === true;
  constats.push(recordCheck({
    section: BOOT_SECTION.STRUCTURAL_INVARIANTS,
    name: 'Une seule destination active par environnement',
    outcome: indexVerifie ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: !indexVerifie,
    proof: indexVerifie ? 'index unique relu en base après reprise, aucun conflit actif' : '',
    reason: indexVerifie ? '' : 'ACTIVE_INDEX_UNVERIFIED',
    detail: indexVerifie ? '' : 'la garantie ne peut pas être promise — aucun service de fond ne doit démarrer',
  }));

  const enVol = structuralRecoveryPending();
  constats.push(recordCheck({
    section: BOOT_SECTION.STRUCTURAL_INVARIANTS,
    name: 'Aucune reprise structurelle encore en vol',
    outcome: enVol === 0 ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: enVol !== 0,
    proof: enVol === 0 ? 'toutes les reprises ont rendu leur issue avant cette ligne' : '',
    reason: enVol === 0 ? '' : 'RECOVERY_STILL_RUNNING',
  }));

  const bloquantes = etat.failures.length;
  constats.push(recordCheck({
    section: BOOT_SECTION.STRUCTURAL_INVARIANTS,
    name: 'Aucune reprise bloquante en échec',
    outcome: bloquantes === 0 ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: bloquantes !== 0,
    proof: bloquantes === 0 ? 'les reprises portant une garantie ont toutes abouti' : '',
    reason: bloquantes === 0 ? '' : 'BLOCKING_RECOVERY_FAILED',
    detail: bloquantes === 0 ? '' : etat.failures.map((f) => `${f.step} (${f.code})`).join(', '),
  }));

  return constats.every((c) => c.outcome === BOOT_OUTCOME.OK);
}

/** Remise à zéro — recettes qui amorcent plusieurs fois un même processus. */
export function resetStructuralRecoveryForTests() {
  etat = { completed: false, startedAt: null, finishedAt: null, results: {}, failures: [] };
}

export default {
  RECOVERY_CLASS,
  runStructuralRecovery,
  assertStructuralInvariants,
  structuralRecoveryCompleted,
  structuralRecoveryPending,
  describeStructuralRecovery,
  resetStructuralRecoveryForTests,
};
