/**
 * ══ AUCUN WORKER NE DOIT VOIR UN ÉTAT QUE L'AMORÇAGE DOIT ENCORE RÉPARER ════
 *
 * ── LE DÉFAUT QUE CETTE RECETTE VERROUILLE ─────────────────────────────────
 *
 * Les reprises structurelles vivaient dans `server.js`, APRÈS `bootstrap()`.
 * Or `bootstrap()` démarre les services de fond. L'ordre réel était donc :
 *
 *     BACKGROUND SERVICES  →  REPRISES  →  INVARIANTS  →  READY
 *
 * L'ordonnanceur du pont battait, le signe de vie annonçait « OK » au Panel,
 * les déclencheurs étaient armés et la veille du tunnel tournait — pendant que
 * l'état structurel était encore en cours de réparation.
 *
 * Le cas le plus coûteux n'était pas théorique. `migrateDeploymentTargets()` ne
 * RÉPARE pas « deux destinations actives dans le même environnement » : elle
 * REFUSE le démarrage. Le processus sortait donc en erreur — APRÈS avoir dit au
 * Panel qu'il était vivant et en bonne santé. Un backend qui s'annonce sain
 * puis meurt est pire qu'un backend qui ne démarre pas : la supervision a
 * enregistré un signe de vie qui n'engageait rien.
 *
 * ── CE QUE CETTE RECETTE PROUVE, ET COMMENT ────────────────────────────────
 *
 * Pas l'ordre des lignes dans un fichier : une preuve TEMPORELLE, prise sur une
 * exécution réelle. Le double de Panel HORODATE chaque appel qu'il reçoit ; la
 * reprise horodate sa fin. On compare les deux.
 *
 *     cycles de worker avant la fin des reprises = 0
 *
 * Et le cas bloquant, qui est le plus net : deux destinations actives → la
 * phase 1 lève, et AUCUNE ressource n'a été démarrée. Pas de minuteur, pas
 * d'écouteur, pas un seul octet parti vers le Panel.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'recovery_before_workers_test';
process.env.DB_PROD = 'recovery_before_workers_prod';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
// L'ordonnanceur DOIT battre : c'est lui, le worker dont on prouve qu'il ne
// part pas trop tôt. Le couper viderait la recette de son sujet.
process.env.PANEL_SCHEDULER_ENABLED = 'true';
// Cadences volontairement très courtes : un worker qui partirait trop tôt le
// ferait alors dans la fenêtre de la recette, au lieu de passer inaperçu.
process.env.PANEL_HEARTBEAT_INTERVAL_S = '1';
process.env.PANEL_SYNC_INTERVAL_S = '1';
delete process.env.PANEL_URL;
delete process.env.PANEL_PAIRING_CODE;

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

let pass = 0;
let fail = 0;
const check = (nom, condition, extra = '') => {
  if (condition) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (titre) => console.log(`\n${titre}`);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const bootstrapModule = await import('../config/bootstrap.js');
const {
  bootstrap, bootstrapStructuralState, startBackgroundServices, stopBackgroundServices,
  structuralStateReady, describeBackgroundServices, assertServiceInvariants,
  resetLifecycleForTests,
} = bootstrapModule;
const {
  runStructuralRecovery, assertStructuralInvariants, describeStructuralRecovery,
  structuralRecoveryCompleted, resetStructuralRecoveryForTests,
} = await import('../services/lifecycle/structuralRecovery.service.js');
const {
  BOOT_SECTION, BOOT_OUTCOME, beginBootstrapReport, describeBootstrapReport,
  bootstrapSummary, assertBootstrapInvariants, resetBootstrapReportForTests,
} = await import('../services/lifecycle/bootstrapReport.service.js');
const { describeScheduler, resetSchedulerForTests } = await import(
  '../services/panelBridge/bridgeScheduler.js'
);
const { hasSyncListener, resetSyncNotifier } = await import('../utils/syncNotifier.js');
const pairingStore = await import('../services/panelBridge/pairingStore.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const { drainHookLabels, beginDraining, markRunning } = await import(
  '../services/lifecycle/runtimeLifecycle.js'
);
const { resetReadiness, markReady, isReady, unavailabilityReason } = await import(
  '../services/lifecycle/readiness.service.js'
);
const { resetStartupReconciliationForTests } = await import(
  '../services/lifecycle/startupReconciliation.service.js'
);

await connectDatabase();

const DeploymentTarget = (await import('../models/DeploymentTarget.model.js')).default;
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { createMongoPairingAdapter } = await import(
  '../services/panelBridge/persistence/mongoPairingAdapter.js'
);

await SystemConfiguration.updateOne(
  {}, { $set: { 'network.backendUrl': 'https://demo.exemple-public.fr' } }, { upsert: true },
);

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE DE PANEL — il HORODATE tout ce qu'il reçoit.
   C'est lui qui rend la preuve temporelle possible : chaque appel est un
   « cycle de worker », daté, et donc comparable à la fin des reprises.
   ══════════════════════════════════════════════════════════════════════════ */
const appelsPanel = [];
const noterAppel = (verbe) => { appelsPanel.push({ verbe, at: Date.now() }); };

/**
 * ══ QU'EST-CE QU'UN « CYCLE DE WORKER » ? ══════════════════════════════════
 *
 * Les verbes de l'ORDONNANCEUR, et eux seuls : signe de vie, poussée, tirage.
 * Ce sont les gestes PÉRIODIQUES, ceux qui partent sans que personne ne les
 * ait demandés — donc les seuls qui puissent surprendre un état non réparé.
 *
 * `invokeCapability` et `fetchWebhookVerificationSecret` n'en sont pas : ce
 * sont des étapes de PRÉPARATION (le provisionnement du webhook Stripe), que
 * l'ordre cible place délibérément en phase 3, avant les reprises. Les compter
 * comme des cycles ferait échouer la recette sur la séquence même qu'elle est
 * censée protéger — et pousserait à « corriger » un ordre qui est juste.
 *
 * La distinction n'est pas cosmétique : un provisionnement de webhook ne lit
 * aucune donnée que les reprises réparent (il lit l'adresse publique), là où un
 * heartbeat publie une SANTÉ que le backend n'est pas encore en droit de
 * promettre.
 */
const VERBES_WORKER = new Set(['heartbeat', 'pushChanges', 'pullChanges']);
const cyclesWorker = () => appelsPanel.filter((a) => VERBES_WORKER.has(a.verbe));

const fauxPanel = {
  async ping() { noterAppel('ping'); return { status: 'ok', service: 'panel-bridge-api', time: new Date().toISOString() }; },
  async bootstrap() { throw new Error('cette recette appaire directement.'); },
  async unpair() { noterAppel('unpair'); return { unpaired: true }; },
  async heartbeat() { noterAppel('heartbeat'); return { acknowledged: true, panelTime: new Date().toISOString() }; },
  async pushChanges({ changes = [] }) {
    noterAppel('pushChanges');
    return { results: changes.map((c) => ({ writeId: c.writeId, status: 'APPLIED' })) };
  },
  async pullChanges() { noterAppel('pullChanges'); return { changes: [], cursor: null, hasMore: false }; },
  async invokeCapability(code) {
    noterAppel(`invokeCapability:${code}`);
    if (code === 'webhook.endpoint.ensure') {
      return {
        capability: code,
        outcome: 'SUCCEEDED',
        result: {
          endpointId: 'we_recette', url: 'https://demo.exemple-public.fr/api/webhooks/stripe',
          events: ['*'], created: true, updated: false, secretAvailable: true,
        },
      };
    }
    return { capability: code, outcome: 'SUCCEEDED', result: {} };
  },
  async fetchWebhookVerificationSecret() {
    noterAppel('fetchWebhookVerificationSecret');
    return { webhookSecret: 'whsec_recette_ordre_bootstrap' };
  },
  async introspectFederatedPrincipal() { noterAppel('introspect'); return { active: true, principal: {} }; },
  /**
   * ── LA PROJECTION DES MODÈLES D'E-MAIL (contrat 1.11.0) ──────────────────
   *
   * `isPanelClient` exige TOUTE la surface : cinq méthodes ajoutées au contrat
   * n'avaient pas été reportées ici, et `new PanelBridge(...)` levait donc au
   * premier cycle d'ordonnanceur. La recette ne le disait pas franchement —
   * elle échouait sur « aucun cycle : la preuve serait vide », qui décrit le
   * symptôme et cache la cause.
   *
   * Elles ne servent à rien dans CETTE recette : ce qu'on y prouve est un ORDRE
   * de démarrage, pas un catalogue. Elles doivent seulement exister.
   */
  async listEmailTemplates() { noterAppel('listEmailTemplates'); return { templates: [] }; },
  async getEmailTemplate() { noterAppel('getEmailTemplate'); return { template: null }; },
  async previewEmailTemplate() { noterAppel('previewEmailTemplate'); return { subject: '', html: '' }; },
  async emailTemplateReadiness() { noterAppel('emailTemplateReadiness'); return { ready: true, missing: [] }; },
  async sendEmailTemplateTest() { noterAppel('sendEmailTemplateTest'); return { sent: true }; },
};

/** Repart d'un cycle de vie vierge, sans toucher aux données. */
async function reinitialiserCycleDeVie() {
  await stopBackgroundServices({ reason: 'recette' }).catch(() => {});
  resetSchedulerForTests();
  resetSyncNotifier();
  resetLifecycleForTests();
  resetStructuralRecoveryForTests();
  resetStartupReconciliationForTests();
  resetBootstrapReportForTests();
  beginBootstrapReport();
  appelsPanel.length = 0;
  markRunning();
}

const destination = (nom, environnement, port) => ({
  name: nom,
  url: `https://${nom}.exemple.fr`,
  host: `${nom}.exemple.fr`,
  type: 'subdomain',
  environment: environnement,
  backendPort: port,
  lifecycleStatus: 'ACTIVE',
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. LA GARDE — activer avant d’avoir préparé est REFUSÉ');
{
  await reinitialiserCycleDeVie();

  check('avant la phase 1 : l’état structurel n’est pas prêt', structuralStateReady() === false);

  let refuse = false;
  let message = '';
  try {
    await startBackgroundServices();
  } catch (err) {
    refuse = true;
    message = err.message;
  }
  check('démarrer les services de fond sans préparation est REFUSÉ', refuse);
  check('…et le refus DIT pourquoi (état non réparé)',
    /état structurel|bootstrapStructuralState/.test(message));
  check('…et rien n’a démarré', describeBackgroundServices().started === false);
  check('…aucun minuteur d’ordonnanceur', describeScheduler().running === false);
  check('…aucun déclencheur branché', hasSyncListener() === false);
  check('…et le Panel n’a rien reçu', appelsPanel.length === 0);

  /**
   * C'est la garde, et non la position des lignes, qui rend l'invariant vrai.
   * Une convention se perd au premier appelant pressé ; un refus, non.
   */
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. PREUVE TEMPORELLE — les reprises finissent AVANT le premier cycle');
{
  await reinitialiserCycleDeVie();

  // Le projet est APPAIRÉ et persisté : l'ordonnanceur battra donc réellement,
  // et son premier heartbeat part immédiatement au démarrage.
  pairingStore.configurePairingPersistence(createMongoPairingAdapter());
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });
  await pairingStore.setPairing({
    panelUrl: 'https://panel.exemple.test',
    projectId: 'projet-ordre',
    panelName: 'Panel Ordre',
    bridgeToken: 'jeton-ordre',
  });
  appelsPanel.length = 0;

  await bootstrapStructuralState();
  const finReprises = new Date(describeStructuralRecovery().finishedAt).getTime();

  check('les reprises structurelles sont TERMINÉES à la fin de la phase 1',
    structuralRecoveryCompleted() === true && Number.isFinite(finReprises));
  const avantServices = cyclesWorker().length;
  check('AUCUN cycle de worker pendant la phase 1 (cycles avant reprises = 0)',
    avantServices === 0, `${avantServices} cycle(s) : ${cyclesWorker().map((a) => a.verbe).join(', ')}`);

  /**
   * La PRÉPARATION, elle, a bien parlé au Panel — et c'est voulu : le
   * provisionnement du webhook Stripe est une étape structurelle, placée par
   * l'ordre cible en phase 3. On le constate explicitement plutôt que de le
   * laisser passer pour un oubli.
   */
  check('…la phase 1 a bien fait ses appels de PRÉPARATION (webhook Stripe provisionné)',
    appelsPanel.some((a) => a.verbe.startsWith('invokeCapability:webhook')));

  await startBackgroundServices();
  const debutServices = Date.now();

  // On laisse l'ordonnanceur battre : cadence à 1 s, on lui laisse deux tics.
  const echeance = Date.now() + 4_000;
  while (Date.now() < echeance && cyclesWorker().length === 0) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 25); });
  }

  check('…puis l’ordonnanceur travaille réellement (le worker EXISTE)',
    cyclesWorker().length > 0, 'aucun cycle : la preuve serait vide');

  const premierCycle = cyclesWorker()[0]?.at ?? Infinity;
  check(`PREUVE : reprises terminées à Tn, premier cycle de worker à Tn+${Math.max(0, premierCycle - finReprises)} ms`,
    premierCycle >= finReprises);
  check('PREUVE : cycles de worker antérieurs à la fin des reprises = 0',
    cyclesWorker().filter((a) => a.at < finReprises).length === 0);
  check('…et le démarrage des services est bien postérieur aux reprises',
    debutServices >= finReprises);

  /**
   * Le rapport d'amorçage porte la même preuve, section par section : les
   * constats sont horodatés à l'instant où ils sont déposés.
   */
  const entrees = describeBootstrapReport().entries;
  const derniereReprise = Math.max(...entrees
    .filter((e) => e.section === BOOT_SECTION.RECOVERY).map((e) => new Date(e.at).getTime()));
  const premierService = Math.min(...entrees
    .filter((e) => e.section === BOOT_SECTION.BACKGROUND).map((e) => new Date(e.at).getTime()));
  check('le rapport horodaté confirme : dernière reprise ≤ premier service',
    derniereReprise <= premierService);

  const invariantsStructurels = entrees.filter((e) => e.section === BOOT_SECTION.STRUCTURAL_INVARIANTS);
  check('les invariants structurels sont constatés ENTRE les deux',
    invariantsStructurels.length === 3
    && invariantsStructurels.every((e) => new Date(e.at).getTime() >= derniereReprise
      && new Date(e.at).getTime() <= premierService));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. REPRISE BLOQUANTE EN ÉCHEC — jamais READY, et AUCUN worker démarré');
{
  await reinitialiserCycleDeVie();
  resetReadiness();

  /**
   * ON RECONSTITUE UNE BASE HÉRITÉE — sans l'index d'unicité.
   *
   * ── POURQUOI CE DÉTOUR EST NÉCESSAIRE, ET CE QU'IL PROUVE AU PASSAGE ─────
   *
   * Une fois l'amorçage passé (section 2), l'index `environnement_actif_unique`
   * EXISTE : insérer une seconde destination active est alors refusé par la
   * base elle-même. C'est la garantie qui fonctionne — on la constate.
   *
   * Le cas que la reprise doit attraper est donc celui d'une base ANTÉRIEURE à
   * cet index. On le reconstitue fidèlement : index retiré, deux fiches
   * insérées, puis on demande à l'amorçage ce qu'il en fait.
   */
  await DeploymentTarget.deleteMany({});
  let refuseParLIndex = false;
  await DeploymentTarget.create(destination('alpha', 'TEST', 7001));
  try {
    await DeploymentTarget.create(destination('beta', 'TEST', 7002));
  } catch (err) {
    refuseParLIndex = err?.code === 11000;
  }
  check('la garantie est tenue par la BASE : une 2ᵉ destination active est refusée',
    refuseParLIndex);

  await DeploymentTarget.collection.dropIndex('environnement_actif_unique').catch(() => {});
  await DeploymentTarget.collection.insertOne({
    ...destination('beta', 'TEST', 7002), createdAt: new Date(), updatedAt: new Date(),
  });
  check('…état hérité reconstitué : deux destinations actives, sans index',
    (await DeploymentTarget.countDocuments({ lifecycleStatus: 'ACTIVE', environment: 'TEST' })) === 2);

  let leve = false;
  let codeErreur = '';
  try {
    await bootstrapStructuralState();
  } catch (err) {
    leve = true;
    codeErreur = err?.code || err?.message || '';
  }

  check('la phase 1 LÈVE sur une reprise bloquante en échec', leve);
  check('…en nommant le conflit', /ACTIVE_CONFLICT|destinations? ACTIVE/i.test(codeErreur));

  /**
   * ══ LE CŒUR DE CE LOT ═══════════════════════════════════════════════════
   *
   * Avant, à cet instant précis, l'ordonnanceur battait déjà et le Panel avait
   * reçu un heartbeat « OK » d'un backend qui allait mourir.
   */
  check('AUCUN service de fond n’a démarré', describeBackgroundServices().started === false);
  check('…aucun minuteur d’ordonnanceur', describeScheduler().running === false);
  check('…aucun déclencheur de synchronisation', hasSyncListener() === false);
  check('LE PANEL N’A REÇU AUCUN SIGNE DE VIE d’un backend qui ne démarrera pas',
    cyclesWorker().length === 0, cyclesWorker().map((a) => a.verbe).join(', '));

  check('l’état structurel n’est pas déclaré prêt', structuralStateReady() === false);
  check('…et les services refusent donc toujours de démarrer',
    await startBackgroundServices().then(() => false, () => true));

  const resume = bootstrapSummary();
  check('le rapport porte un échec BLOQUANT', resume.blockingErrors >= 1);
  check('…qui interdit READY',
    await Promise.resolve().then(() => { try { assertBootstrapInvariants(); return false; } catch { return true; } }));
  check('…et le service reste en SERVICE_STARTING',
    isReady() === false && unavailabilityReason()?.code === 'SERVICE_STARTING');

  await DeploymentTarget.deleteMany({});
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. REPRISE DÉGRADABLE EN ÉCHEC — mode dégradé explicite, service ouvert');
{
  await reinitialiserCycleDeVie();

  /**
   * On casse la reprise des MÉDIAS au niveau du modèle — une doublure de
   * données, jamais une modification du produit. C'est la seule reprise dont
   * l'échec est réellement inductible sans toucher au code de production.
   */
  const original = ProjectMedia.updateMany;
  ProjectMedia.updateMany = async () => { throw new Error('panne simulée du stockage média'); };
  try {
    await runStructuralRecovery();
  } finally {
    ProjectMedia.updateMany = original;
  }

  const entrees = describeBootstrapReport().entries;
  const medias = entrees.find((e) => e.name === 'Reprise des médias');
  check('la reprise dégradable est DEGRADED, jamais FAILED',
    medias?.outcome === BOOT_OUTCOME.DEGRADED && medias?.blocking === false);
  check('…et la cause est nommée', medias?.reason === 'MEDIA_MIGRATION_FAILED');
  check('les reprises se poursuivent malgré elle (les runs sont traités)',
    Boolean(entrees.find((e) => e.name === 'Reprise des déploiements interrompus')));
  check('…la reprise structurelle est déclarée TERMINÉE', structuralRecoveryCompleted() === true);
  check('…les invariants structurels PASSENT (aucune garantie n’est rompue)',
    assertStructuralInvariants() === true);
  check('…et rien n’interdit READY : une reprise cosmétique ne ferme pas le service',
    bootstrapSummary().blockingErrors === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. WORKER OBLIGATOIRE MANQUANT — bloquant ; OPTIONNEL — explicite');
{
  await reinitialiserCycleDeVie();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });
  await bootstrapStructuralState();
  await startBackgroundServices();

  check('projet appairé : l’ordonnanceur tourne réellement', describeScheduler().running === true);

  /**
   * On ÉTEINT l'ordonnanceur puis on rejoue le contrôle d'invariants : c'est
   * exactement l'état « `startX()` a rendu sans lever, mais rien ne tourne » —
   * celui qu'un contrôle naïf laisserait passer.
   */
  resetSchedulerForTests();
  resetBootstrapReportForTests();
  beginBootstrapReport();
  await assertServiceInvariants({ restored: true, wired: true });

  const ordonnanceur = describeBootstrapReport().entries.find((e) => e.name === 'Ordonnanceur du pont actif');
  check('projet APPAIRÉ + cadence voulue + minuteur absent = échec BLOQUANT',
    ordonnanceur?.outcome === BOOT_OUTCOME.FAILED && ordonnanceur?.blocking === true);
  check('…qui interdit READY',
    (() => { try { assertBootstrapInvariants(); return false; } catch { return true; } })());
  check('…et la raison est lisible', ordonnanceur?.reason === 'SCHEDULER_NOT_RUNNING');

  // Le même manque, sur un projet AUTONOME, n'est PAS une panne.
  resetBootstrapReportForTests();
  beginBootstrapReport();
  await assertServiceInvariants({ restored: false, wired: true });
  const autonome = describeBootstrapReport().entries.find((e) => e.name === 'Ordonnanceur du pont actif');
  check('projet AUTONOME : le même manque est DEGRADED, pas bloquant',
    autonome?.outcome === BOOT_OUTCOME.DEGRADED && autonome?.blocking === false);
  check('…parce que la criticité vient du RÔLE, pas du type de service',
    /aucun Panel à servir/.test(autonome?.detail || ''));

  // Un déclencheur manquant : même règle.
  resetSyncNotifier();
  resetBootstrapReportForTests();
  beginBootstrapReport();
  await assertServiceInvariants({ restored: true, wired: true });
  const triggers = describeBootstrapReport().entries.find((e) => e.name === 'Déclencheurs de synchronisation branchés');
  check('déclencheurs absents sur un projet appairé = échec BLOQUANT',
    triggers?.outcome === BOOT_OUTCOME.FAILED && triggers?.blocking === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6. IDEMPOTENCE — double amorçage, double activation, aucun doublon');
{
  await reinitialiserCycleDeVie();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });

  const premier = await bootstrap();
  check('la façade `bootstrap()` enchaîne les DEUX phases',
    premier.structural && premier.backgroundServices.started === true);
  const ressourcesInitiales = describeBackgroundServices().resources.length;

  const second = await startBackgroundServices();
  check('seconde activation : NOOP explicite, jamais un second démarrage',
    second.started === false && second.reason === 'NOOP_ALREADY_STARTED');
  check('…et l’inventaire des ressources n’a pas bougé',
    describeBackgroundServices().resources.length === ressourcesInitiales);
  check('…aucun service en double', describeBackgroundServices().duplicates.length === 0);

  await bootstrap();
  check('second amorçage complet : toujours aucun doublon',
    describeBackgroundServices().duplicates.length === 0
    && describeBackgroundServices().resources.length === ressourcesInitiales);
  check('…un seul écouteur de synchronisation', hasSyncListener() === true);
  check('…un seul vidangeur « services de fond »',
    drainHookLabels().filter((l) => l === 'services de fond').length === 1);

  const reprises = await runStructuralRecovery();
  check('les reprises sont rejouables sans effet de bord', reprises.completed === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7. APTITUDE — 503 tant que les trois frontières ne sont pas franchies');
{
  await reinitialiserCycleDeVie();
  resetReadiness();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });

  check('avant les reprises : SERVICE_STARTING',
    isReady() === false && unavailabilityReason()?.code === 'SERVICE_STARTING');

  await bootstrapStructuralState();
  check('après les reprises mais AVANT les workers : toujours SERVICE_STARTING',
    isReady() === false && unavailabilityReason()?.code === 'SERVICE_STARTING');
  check('…alors même que l’état structurel est prêt', structuralStateReady() === true);

  await startBackgroundServices();
  check('après les workers, avant markReady() : toujours SERVICE_STARTING',
    isReady() === false);

  assertBootstrapInvariants();
  markReady();
  check('après invariants + markReady() : READY', isReady() === true);

  const { describeReadiness } = await import('../services/lifecycle/readiness.service.js');
  const etat = describeReadiness();
  check('/readyz porte les compteurs des deux familles d’invariants',
    typeof etat.bootstrap.structuralInvariants?.ok === 'number'
    && typeof etat.bootstrap.serviceInvariants?.ok === 'number');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('8. ARRÊT SYMÉTRIQUE — ordre inverse, et plus rien ne tourne');
{
  await reinitialiserCycleDeVie();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });
  await bootstrap();

  const ordreDemarrage = describeBackgroundServices().resources;
  check('l’inventaire porte les ressources dans leur ordre de DÉMARRAGE',
    ordreDemarrage.length >= 3 && ordreDemarrage[0].includes('tunnel'));
  check('l’ordonnanceur tourne avant l’arrêt', describeScheduler().running === true);

  const issue = await stopBackgroundServices({ reason: 'recette' });
  check('l’arrêt rend le compte de ce qu’il a fermé',
    issue.stopped === true && issue.count === ordreDemarrage.length);
  check('…l’ordonnanceur est arrêté', describeScheduler().running === false);
  check('…l’inventaire est vidé', describeBackgroundServices().resources.length === 0);
  check('…et le vidangeur est désinscrit (pas de double fermeture au drainage)',
    drainHookLabels().filter((l) => l === 'services de fond').length === 0);

  const secondArret = await stopBackgroundServices({ reason: 'recette' });
  check('un second arrêt est un NOOP explicite', secondArret.reason === 'NOOP_NOT_STARTED');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('9. SIGTERM — pendant les reprises, et pendant un cycle de worker');
{
  // ── Pendant les REPRISES : rien n'a démarré, il n'y a rien à arrêter, et
  //    l'arrêt ne doit pas inventer de panne.
  await reinitialiserCycleDeVie();
  const arretSansServices = await stopBackgroundServices({ reason: 'sigterm' });
  check('arrêt pendant les reprises : NOOP, aucune fausse panne',
    arretSansServices.stopped === false && arretSansServices.reason === 'NOOP_NOT_STARTED');

  // ── Pendant un CYCLE : le drainage arrête PUIS attend ce qui vole encore.
  await reinitialiserCycleDeVie();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });
  await bootstrap();
  check('les services tournent', describeBackgroundServices().started === true);

  await beginDraining({ reason: 'sigterm' });
  check('le drainage a fermé les services de fond',
    describeScheduler().running === false && describeBackgroundServices().started === false);
  const { isShuttingDown } = await import('../services/lifecycle/runtimeLifecycle.js');
  check('…et le runtime refuse désormais du travail', isShuttingDown() === true);
  markRunning();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('10. CONTRAT `bootstrap()` — les appelants historiques sont préservés');
{
  await reinitialiserCycleDeVie();
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });

  // La forme historique — `await bootstrap()` sans argument — reste celle de la
  // cinquantaine de recettes existantes.
  const complet = await bootstrap();
  check('bootstrap() sans argument : état préparé ET services démarrés',
    complet.structural && complet.backgroundServices.started === true
    && hasSyncListener() === true);

  await reinitialiserCycleDeVie();
  const sansWorkers = await bootstrap({ startBackgroundServices: false });
  check('bootstrap({ startBackgroundServices: false }) : état préparé, AUCUN worker',
    sansWorkers.backgroundServices.started === false
    && describeScheduler().running === false && hasSyncListener() === false);
  check('…mais l’état structurel EST prêt', structuralStateReady() === true);
  check('…et les reprises ont bien tourné', structuralRecoveryCompleted() === true);

  const activationManuelle = await startBackgroundServices();
  check('…l’activation manuelle fonctionne ensuite', activationManuelle.started === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('11. ORDRE — la source de `server.js` exécute la séquence sûre');
{
  const src = await fs.readFile(path.join(SRC, 'server.js'), 'utf8');
  const iStructural = src.indexOf('await bootstrapStructuralState()');
  const iServices = src.indexOf('await startBackgroundServices()');
  const iAssert = src.indexOf('assertBootstrapInvariants()');
  const iReady = src.indexOf('markReady()');

  check('server.js prépare AVANT d’activer', iStructural > 0 && iServices > iStructural);
  check('…puis vérifie les invariants', iAssert > iServices);
  check('…et n’ouvre le service qu’ensuite', iReady > iAssert);
  /**
   * On regarde les IMPORTS, pas le texte : le point d'entrée COMMENTE encore
   * `migrateDeploymentTargets()` pour expliquer le défaut qu'il ferme, et une
   * recherche textuelle prendrait cette explication pour l'appel qu'elle décrit.
   */
  const importe = (specificateur) => new RegExp(`^import[^;]*from\\s+['"][^'"]*${specificateur}`, 'm').test(src);
  check('server.js n’importe plus aucune reprise (elles ont changé de phase)',
    !importe('destinationLifecycle\\.service') && !importe('portRegistry\\.service')
    && !importe('projectMedia\\.service') && !importe('runSteps\\.service')
    && !importe('restartMarker\\.service') && !importe('deploymentRun\\.service'));

  const srcBootstrap = await fs.readFile(path.join(SRC, 'config/bootstrap.js'), 'utf8');
  const iRecovery = srcBootstrap.indexOf('await runStructuralRecovery()');
  const iInvariants = srcBootstrap.indexOf('assertStructuralInvariants()');
  const iDemarrer = srcBootstrap.indexOf('await demarrerServices(');
  check('les reprises sont DANS la phase de préparation',
    iRecovery > 0 && iInvariants > iRecovery);
  check('…et le démarrage des services vit dans l’autre phase, après la garde',
    iDemarrer > 0 && srcBootstrap.indexOf('structuralStateReady()') < iDemarrer);
}

await disconnectDatabase().catch(() => {});
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
