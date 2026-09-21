import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
/**
 * ══ DEUX FRONTIÈRES, ET LE POINT D'ENTRÉE LES NOMME ═════════════════════════
 *
 * `bootstrap()` reste exporté pour la cinquantaine d'appelants historiques,
 * mais le runtime réel n'en veut pas : il veut voir, dans son propre corps, que
 * l'état est PRÉPARÉ avant que quoi que ce soit ne soit ACTIVÉ. Un point
 * d'entrée qui appelle une façade ne montre plus l'ordre qu'il garantit.
 */
import { bootstrapStructuralState, startBackgroundServices } from './config/bootstrap.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { installProcessGuards } from './services/deployment/forensics/processGuard.js';
/**
 * LES REPRISES NE SONT PLUS IMPORTÉES ICI.
 *
 * Elles ont rejoint `services/lifecycle/structuralRecovery.service.js`, appelé
 * par la PHASE 1. Les laisser à ce niveau, c'était garantir qu'elles
 * s'exécutent après `bootstrap()` — donc après les services de fond.
 */
import { gracefulShutdown } from './services/lifecycle/runtimeLifecycle.js';
import { recyclePort } from './utils/portRecycling.js';
import {
  markBootFailed, markBootStep, markReady,
} from './services/lifecycle/readiness.service.js';
import {
  BOOT_SECTION, BOOT_OUTCOME, bootstrapSummary,
  assertBootstrapInvariants, beginBootstrapReport, finalizeBootstrapReport, recordCheck,
} from './services/lifecycle/bootstrapReport.service.js';
import { describeStructuralRecovery } from './services/lifecycle/structuralRecovery.service.js';
import { describeBackgroundServices } from './config/bootstrap.js';
import {
  deferredStartupJobCount, describeStartupReconciliation, pendingStartupJobCount,
} from './services/lifecycle/startupReconciliation.service.js';

async function start() {
  /**
   * LES OBSERVATEURS D'ERREURS D'ABORD — avant toute autre chose.
   *
   * Une exception survenue pendant la connexion à la base ou les migrations
   * doit elle aussi laisser une trace. Les installer après serait les
   * installer trop tard pour les pannes de démarrage.
   */
  installProcessGuards({ logger });

  /**
   * LE RAPPORT D'AMORÇAGE S'OUVRE AVANT LE PREMIER CONSTAT.
   *
   * Il est le totalisateur de tout ce qui suit : sans lui, chaque étape
   * journaliserait à nouveau dans son coin, et « API PRÊTE » redeviendrait ce
   * qu'il était — la constatation que `listen()` n'a pas levé.
   */
  beginBootstrapReport();

  /**
   * ══ LE PORT S'OUVRE AVANT L'AMORÇAGE — ET C'EST LE CŒUR DU CORRECTIF ══════
   *
   * ── CE QUI SE PASSAIT ─────────────────────────────────────────────────────
   *
   * `app.listen()` venait après `connectDatabase()`, `bootstrap()` et cinq
   * reprises. Or `bootstrap()` réconcilie les webhooks des fournisseurs avec un
   * plafond de vingt secondes, et sonde le tunnel ngrok en développement.
   * Pendant toute cette fenêtre, rien n'écoutait sur le port : le Manager
   * recevait un `502` d'nginx ou un `ECONNREFUSED`, tous deux affichés
   * « Serveur injoignable ».
   *
   * C'est ce qui produisait le symptôme observé — une tentative de déploiement
   * refusée avant même que ses prérequis ne se lancent, puis un succès quelques
   * dizaines de secondes plus tard sans qu'on ait rien changé.
   *
   * ── CE QUI LE REMPLACE ────────────────────────────────────────────────────
   *
   * Le port s'ouvre immédiatement, les sondes répondent, et les routes métier
   * sont gardées par `requireServiceReady` : elles refusent proprement — `503`
   * + code stable — tant que l'amorçage n'est pas terminé.
   *
   * L'invariant est INTACT : aucune route métier ne sert avant que ses
   * dépendances ne soient prêtes. Ce qui change, c'est la qualité du refus.
   */
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      `Port ${config.port} ouvert (ENV=${config.env}) ; amorçage en cours, `
      + 'les routes métier répondent 503 SERVICE_STARTING.'
    );
  });

  /**
   * ══ UN PORT OCCUPÉ SE RECYCLE, IL N'ARRÊTE PLUS LE DÉMARRAGE ══════════════
   *
   * ── CE QUI SE PASSAIT ─────────────────────────────────────────────────────
   *
   * `EADDRINUSE` tuait le démarrage, et le journal demandait « un autre backend
   * tourne-t-il déjà ? » — une question dont la réponse était OUI dans la quasi
   * totalité des cas, et toujours le même oui : un `node --watch` orphelin d'une
   * session précédente. Il fallait alors sortir du flux, retrouver le PID à la
   * main, le terminer, relancer. Plusieurs fois par jour, pour un reliquat qui
   * n'appartenait à personne.
   *
   * ── CE QUI LE REMPLACE ────────────────────────────────────────────────────
   *
   * On termine le détenteur et on reprend le port. `recyclePort` porte les
   * garde-fous (voir `utils/portRecycling.js`) : rien n'est recyclé sous PM2,
   * et jamais au détriment d'un processus supervisé. Un backend DÉPLOYÉ ne peut
   * donc pas prendre le port d'un voisin — c'est le seul cas qui comptait.
   *
   * ── UNE SEULE TENTATIVE, ET C'EST VOLONTAIRE ──────────────────────────────
   *
   * Si le port est repris entre la libération et la réécoute, une boucle
   * entrerait en concurrence avec ce qui vient de le prendre — deux backends se
   * tueraient l'un l'autre indéfiniment. Un second échec est donc un échec :
   * il nomme la cause et s'arrête, comme avant.
   */
  let recyclageTente = false;

  server.on('error', async (err) => {
    if (err?.code !== 'EADDRINUSE') {
      markBootFailed(err);
      logger.error(`Écoute impossible sur le port ${config.port} : ${err.message}`);
      process.exit(1);
      return;
    }

    if (recyclageTente) {
      markBootFailed(err);
      logger.error(
        `Port ${config.port} toujours occupé après recyclage — un processus l’a repris, `
        + 'ou il est protégé. Identifiez-le et terminez-le à la main.'
      );
      process.exit(1);
      return;
    }

    recyclageTente = true;
    logger.warn(`Port ${config.port} occupé — tentative de recyclage.`);
    const issue = await recyclePort(config.port, { log: (m) => logger.warn(m) });

    if (!issue.freed) {
      markBootFailed(err);
      logger.error(
        `Port ${config.port} déjà utilisé et non recyclable (${issue.reason}). `
        + 'Un autre backend tourne-t-il déjà ?'
      );
      process.exit(1);
      return;
    }

    logger.info(
      issue.killed.length
        ? `Port ${config.port} libéré (${issue.killed.length} processus terminé(s)) — reprise de l’écoute.`
        : `Port ${config.port} libéré entre-temps — reprise de l’écoute.`
    );
    server.listen(config.port);
  });

  markBootStep('connexion à la base de données');
  try {
    await connectDatabase();
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'MongoDB',
      outcome: BOOT_OUTCOME.OK,
      proof: `connectée — base ${config.dbName}`,
    });
  } catch (err) {
    /**
     * BLOQUANT, ET LE RAPPORT LE DIT AVANT DE MOURIR.
     *
     * Le port écoute déjà : entre cet échec et la sortie du processus,
     * `/readyz` peut encore être interrogé. Il doit alors nommer la base, pas
     * répondre « amorçage en cours » sur un amorçage qui n'aura jamais lieu.
     */
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'MongoDB',
      outcome: BOOT_OUTCOME.FAILED,
      blocking: true,
      reason: err?.code || 'DATABASE_UNAVAILABLE',
      detail: String(err?.message || err),
    });
    throw err;
  }

  markBootStep('préparation de l’état (cœur, panel, IntegratedAPI, reprises)');
  /**
   * ══ PHASE 1 — PRÉPARER L’ÉTAT, SANS RIEN ACTIVER ═════════════════════════
   *
   * CORE → PANEL → INTEGRATED APIs → REPRISES → INVARIANTS STRUCTURELS.
   *
   * ── LE DÉFAUT QUE CETTE LIGNE FERME ──────────────────────────────────────
   *
   * Les reprises structurelles vivaient ICI, après `bootstrap()` — donc APRÈS
   * le démarrage des services de fond. L’ordre réel était :
   *
   *     BACKGROUND SERVICES → REPRISES → INVARIANTS → READY
   *
   * L’ordonnanceur du pont battait, le signe de vie annonçait « OK » au Panel,
   * les déclencheurs étaient armés et la veille du tunnel tournait — pendant
   * que l’état structurel était encore en cours de réparation.
   *
   * Le cas le plus coûteux n’était pas théorique : `migrateDeploymentTargets()`
   * ne RÉPARE pas « deux destinations actives dans le même environnement », elle
   * REFUSE le démarrage. Le processus sortait donc en erreur — après avoir dit
   * au Panel qu’il était vivant et en bonne santé. Un backend qui s’annonce sain
   * puis meurt est pire qu’un backend qui ne démarre pas : la supervision a
   * enregistré un signe de vie qui n’engageait rien.
   *
   * LÈVE si une reprise bloquante échoue. À cet instant, aucun minuteur n’est
   * armé, aucun déclencheur branché, aucun heartbeat parti.
   */
  await bootstrapStructuralState();

  markBootStep('démarrage des services de fond');
  /**
   * ══ PHASE 2 — ACTIVER ════════════════════════════════════════════════════
   *
   * BACKGROUND SERVICES → INVARIANTS DE SERVICES.
   *
   * `startBackgroundServices()` REFUSE de démarrer quoi que ce soit tant que la
   * phase 1 n’a pas abouti. C’est cette garde — et non l’ordre des lignes — qui
   * rend l’invariant vrai : une convention se perd au premier appelant pressé.
   */
  await startBackgroundServices();

  /**
   * ══ L'INVARIANT CENTRAL DU LOT ═══════════════════════════════════════════
   *
   * « Aucune opération obligatoire n'est laissée en SKIPPED. » Il ne se prouve
   * pas par l'absence de ligne rouge : il se prouve en NOMMANT ce qui reste dû
   * et en montrant que chaque geste a un mécanisme qui le reprendra — une
   * échéance pour ce qui peut réussir tout seul, un événement armé pour ce qui
   * attend une dépendance.
   */
  const retriesEnAttente = pendingStartupJobCount();
  const armes = deferredStartupJobCount();
  const enAttente = describeStartupReconciliation();
  recordCheck({
    section: BOOT_SECTION.INVARIANTS,
    name: 'Aucune opération de démarrage abandonnée sans reprise',
    outcome: BOOT_OUTCOME.OK,
    proof: enAttente.length === 0
      ? 'toutes les actions dues au démarrage ont abouti'
      : `${retriesEnAttente} reprise(s) programmée(s) et ${armes} armée(s) : `
        + enAttente.map((j) => `${j.label} [${j.state}]`).join(', '),
  });

  /**
   * ══ LE CRITÈRE D'ACCEPTATION, ÉNONCÉ EN CHIFFRES ═════════════════════════
   *
   * « Aucun service de fond ne peut observer ou modifier un état que l'amorçage
   * doit encore réparer. » Une phrase ne se vérifie pas ; ces cinq compteurs,
   * si. Ils sont RELUS auprès de leurs modules au moment où on les écrit —
   * jamais recopiés depuis une variable posée plus haut, qui pourrait dater.
   */
  const recovery = describeStructuralRecovery();
  const resumeCourant = bootstrapSummary();
  const services = describeBackgroundServices();
  const echecsStructurels = resumeCourant.structuralInvariants.failed;
  const workersManquants = resumeCourant.serviceInvariants.failed;
  const acceptation = {
    structuralRecoveryPending: recovery.pending,
    structuralInvariantFailures: echecsStructurels,
    requiredWorkersMissing: workersManquants,
    duplicateWorkers: services.duplicates.length,
    blockingErrors: resumeCourant.blockingErrors,
  };
  const toutEstNul = Object.values(acceptation).every((n) => n === 0);
  recordCheck({
    section: BOOT_SECTION.INVARIANTS,
    name: 'Aucun service de fond n’a observé un état non réparé',
    outcome: toutEstNul ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: !toutEstNul,
    proof: toutEstNul
      ? Object.entries(acceptation).map(([k, v]) => `${k}=${v}`).join(' · ')
      : '',
    reason: toutEstNul ? '' : 'ACCEPTANCE_CRITERIA_UNMET',
    detail: toutEstNul
      ? ''
      : Object.entries(acceptation).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${v}`).join(' · '),
  });

  /**
   * ══ LA CONDITION DE PASSAGE À READY ══════════════════════════════════════
   *
   * `assertBootstrapInvariants()` lève si un prérequis BLOQUANT manque. Elle ne
   * lève PAS pour un fournisseur en reprise ou un Panel injoignable : le
   * service ouvre alors en mode dégradé, et le dit. Transformer toute panne
   * externe en refus de démarrer serait aussi faux que l'inverse.
   */
  assertBootstrapInvariants();
  const resume = finalizeBootstrapReport({ pendingRetries: retriesEnAttente, deferred: armes });

  /**
   * ══ L'ÉTAT READY — POSÉ ICI, ET NULLE PART AILLEURS ══════════════════════
   *
   * Tout ce dont une route métier a besoin est fait : base connectée, amorçage
   * terminé, migrations passées, runs orphelins finalisés. C'est le premier
   * instant où répondre à une requête métier est honnête.
   *
   * La garde `requireServiceReady` cesse de refuser à partir de cette ligne.
   * Avancer cet appel, ne serait-ce que d'une reprise, remettrait en service un
   * backend qui ne tient pas encore ses garanties.
   */
  markReady();
  const degrade = resume.degradedDetails.length > 0 || retriesEnAttente > 0;
  const annonce = `API PRÊTE sur ${config.publicUrl} (ENV=${config.env})`;
  if (degrade) {
    /**
     * PRÊTE, MAIS PAS INTACTE — et la nuance est dite dans la MÊME ligne.
     *
     * Un `[ ok ] API PRÊTE` posé au-dessus d'un résumé dégradé apprend à ne
     * plus lire le résumé. La dernière ligne du démarrage doit porter la même
     * vérité que celle qui la précède.
     */
    logger.warn(`${annonce} — MODE DÉGRADÉ : ${resume.degradedDetails.join(', ')}`);
  } else {
    logger.success(annonce);
  }

  /**
   * ══ CE QUI S'EST PASSÉ JUSTE AVANT LE REDÉMARRAGE PRÉCÉDENT ══════════════
   *
   * Une session de diagnostic vit en mémoire — donc elle meurt avec le process,
   * précisément dans le cas qu'elle sert à comprendre. Sa trace est appendue
   * hors du code source ; ce démarrage-ci la relit et la RÉIMPRIME.
   *
   * L'exploitant n'ouvre aucun fichier : la console qu'il a sous les yeux porte
   * déjà les faits d'avant la coupure. Silencieux s'il n'y a rien à dire.
   */
  try {
    const forensics = await import('./services/deployment/forensics/restartForensics.js');
    /**
     * DEUX QUESTIONS, DEUX RESTITUTIONS — et l'ordre a un sens.
     *
     * `rejouerTraceInterrompue()` répond à « qu'étais-je en train de faire quand
     * je suis mort ». `rejouerAttributionParent()` répond à « QUI m'a tué » —
     * établie par le lanceur, qui a survécu à l'événement là où ce process ne
     * le pouvait pas. Le contexte d'abord, le verdict ensuite : c'est l'ordre
     * dans lequel on lit un rapport.
     */
    forensics.rejouerTraceInterrompue();
    forensics.rejouerAttributionParent();
  } catch { /* le diagnostic ne doit jamais empêcher un démarrage */ }

  /**
   * ARRÊT ORDONNÉ — RUNNING → DRAINING → STOPPED.
   *
   * ══ L'ORDRE EST LA SEULE CHOSE QUI COMPTE ICI ═══════════════════════════
   *
   * 1. DRAINAGE, base encore ouverte. Les projections qui attendaient leur
   *    fenêtre de regroupement partent maintenant, l'ordonnanceur du pont
   *    s'arrête, et les flux d'interface sont refermés. Chaque composant
   *    inscrit sa propre fermeture : ce point d'entrée n'a pas à les connaître.
   * 2. `server.close()` cesse d'accepter, les connexions au repos sont
   *    libérées, et les requêtes réellement en cours ont le délai de grâce.
   * 3. La base se ferme en DERNIER, quand plus personne ne la lit.
   *
   * ══ POURQUOI LE DRAINAGE PRÉCÈDE `server.close()` ═══════════════════════
   *
   * `server.close()` n'appelle son rappel qu'à la fermeture de la DERNIÈRE
   * connexion. Un flux `GET /api/live/events` ne se ferme jamais seul : son
   * battement de maintien le garde ouvert, c'est sa fonction. Un seul Manager
   * ouvert suffisait donc à épuiser le délai de grâce, et l'arrêt se terminait
   * par `process.exit(1)` — base jamais refermée proprement, `reload` PM2
   * soldé par un code d'erreur sur un arrêt parfaitement normal.
   *
   * Le drainage ferme ces flux d'abord. `server.close()` peut alors aboutir.
   *
   * ══ CE QUE L'ARRÊT NE PEUT PAS PERDRE ═══════════════════════════════════
   *
   * Rien. Les écritures métier sont persistées avant toute projection, la file
   * est durable, et `reconcileAll()` reconstruit la photographie complète au
   * prochain démarrage. Le délai forcé reste — mais il redevient ce qu'il
   * aurait toujours dû être : un filet, pas le chemin normal.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`Signal ${signal} reçu — arrêt en cours...`);

    // La séquence complète vit dans `runtimeLifecycle` — un seul endroit, que
    // la recette éprouve réellement plutôt que d'en recopier l'ordre.
    const issue = await gracefulShutdown({ server, reason: signal }).catch(() => 'forced');

    try {
      await disconnectDatabase();
    } catch {
      /* la base est peut-être déjà partie : cela n'aggrave pas un arrêt */
    }
    // Le code de sortie DIT ce qui s'est passé : 0 quand tout s'est fermé,
    // 1 quand une requête a dû être coupée. Répondre 0 dans les deux cas
    // effacerait le seul signal qu'une requête ne se termine jamais.
    process.exit(issue === 'closed' ? 0 : 1);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  /**
   * L'ÉCHEC EST ENREGISTRÉ AVANT DE SORTIR.
   *
   * Le port est ouvert depuis la première seconde : entre l'échec et la sortie
   * du process, `/readyz` peut encore être interrogé. Il doit alors dire ce qui
   * a échoué — c'est la différence entre un diagnostic et une devinette.
   */
  markBootFailed(err);
  logger.error('Échec du démarrage', err);
  process.exit(1);
});
