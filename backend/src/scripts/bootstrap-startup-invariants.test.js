/**
 * ══ « API PRÊTE » DOIT ÊTRE UNE CONCLUSION, PAS UNE HABITUDE ═══════════════
 *
 * ── LE DÉFAUT QUE CETTE RECETTE VERROUILLE ─────────────────────────────────
 *
 * Le démarrage produisait, dans cet ordre exact :
 *
 *     Webhook STRIPE/payment (TEST) : réconciliation sautée (PANEL_NOT_PAIRED).
 *     Pont Panel : appairage restauré (Panel L.Y Solution).
 *     …
 *     API PRÊTE
 *
 * Trois lignes vraies, une conclusion fausse. La réconciliation des webhooks
 * venait AVANT la restauration de l'appairage ; le provisionnement Stripe passe
 * par le Panel depuis L6.3A ; il était donc sauté à CHAQUE démarrage, la
 * dépendance arrivait deux lignes plus bas, et rien ne rejouait le geste.
 *
 * ── CE QUE LA RECETTE PROUVE, ET POURQUOI SOUS CETTE FORME ─────────────────
 *
 * On ne prouve PAS l'absence de la ligne « réconciliation sautée » : un `catch`
 * vide donnerait le même silence. On prouve les faits positifs :
 *
 *   1. l'ORDRE — l'appairage est hydraté avant que les webhooks ne soient
 *      réconciliés, et la preuve est prise sur la SOURCE, pas sur un journal ;
 *   2. la MÉMOIRE — un geste impossible faute de dépendance devient un travail
 *      ARMÉ, nommé, énumérable dans `/readyz` ;
 *   3. la REPRISE — l'appairage qui arrive déclenche RÉELLEMENT le geste, sans
 *      redémarrage, et le fournisseur distant est vérifié ;
 *   4. l'IDEMPOTENCE — rejouer ne crée jamais un second endpoint ;
 *   5. l'HONNÊTETÉ — aucun `[ ok ]` n'est écrit sans preuve, et une panne
 *      distante ne se déguise jamais en succès ;
 *   6. l'ARRÊT — aucune minuterie de reprise ne survit au drainage.
 *
 * ── AUCUN APPEL RÉEL, AUCUNE ACTION FACTURABLE ─────────────────────────────
 *
 * Le Panel est un double complet en mémoire, qui tient un registre d'endpoints
 * pour que l'idempotence soit CONSTATÉE plutôt que supposée. Aucun octet ne
 * part vers Stripe, Brevo ou un Panel réel : la détection de tunnel vise une
 * adresse morte, et l'ordonnanceur du pont est coupé.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'bootstrap_invariants_test';
process.env.DB_PROD = 'bootstrap_invariants_prod';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
// HERMÉTIQUE : un vrai tunnel ngrok sur la machine de dev ne doit pas
// influencer ces assertions (la détection vise une adresse morte).
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
// L'ordonnanceur du pont ne doit pas battre pendant la recette : elle éprouve
// l'amorçage, pas la cadence.
process.env.PANEL_SCHEDULER_ENABLED = 'false';
// Aucun appairage automatique : la recette contrôle QUAND l'appairage arrive.
delete process.env.PANEL_URL;
delete process.env.PANEL_PAIRING_CODE;
/*
  ══ UN PROJET AUTONOME N'A AUCUNE DETTE — encore faut-il qu'il soit vierge ═══

  Cette recette compte les travaux de reprise armés au démarrage : elle attend
  UN seul travail différé (Stripe, en attente d'appairage) et AUCUN en attente.

  Or l'amorçage inscrit un second travail armé — l'envoi du lien d'activation
  du premier compte — dès qu'un compte est créé sans que le courriel ait pu
  partir. Sur un poste de développement, `FIRST_DEV_EMAIL` en crée un : la
  recette voyait deux travaux différés au lieu d'un, et quatre assertions
  tombaient. Chez le développeur seulement, jamais ailleurs — c'est-à-dire au
  pire endroit possible.

  On VIDE ces variables plutôt que de les supprimer : `dotenv` ne remplace pas
  une variable déjà posée, mais il remplit celles qui manquent.
*/
process.env.FIRST_DEV_EMAIL = '';
process.env.SEED_DEV_EMAIL = '';
process.env.FIRST_ADMIN_EMAIL = '';

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

const {
  INTEGRATED_API_STARTUP, BOOT_OUTCOME, BOOT_SECTION,
  beginBootstrapReport, recordCheck, bootstrapSummary, describeBootstrapReport,
  assertBootstrapInvariants, finalizeBootstrapReport, resetBootstrapReportForTests,
} = await import('../services/lifecycle/bootstrapReport.service.js');
const {
  STARTUP_JOB_STATE, registerStartupJob, runStartupJob, runPendingStartupJobs,
  scheduleStartupRetry, pendingStartupJobCount, deferredStartupJobCount,
  describeStartupReconciliation, resetStartupReconciliationForTests,
} = await import('../services/lifecycle/startupReconciliation.service.js');
const { statusFromWebhookResult, webhookJobKey } = await import(
  '../services/lifecycle/integratedApiStartup.service.js'
);

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. VOCABULAIRE — un constat de réconciliation devient un état');
{
  const nonExecute = statusFromWebhookResult(null);
  check('rapport absent : DEGRADED_RETRYING, jamais un succès par défaut',
    nonExecute.status === INTEGRATED_API_STARTUP.DEGRADED_RETRYING
    && nonExecute.reason === 'RECONCILIATION_NOT_RUN' && nonExecute.retryable === true);

  const nonAppaire = statusFromWebhookResult({ skipped: true, reason: 'PANEL_NOT_PAIRED' });
  check('PANEL_NOT_PAIRED : DEFERRED et ARMÉ (la dépendance arrivera, elle ne revient pas)',
    nonAppaire.status === INTEGRATED_API_STARTUP.DEFERRED
    && nonAppaire.gated === true && nonAppaire.retryable === true);

  const sansCle = statusFromWebhookResult({ skipped: true, reason: 'API_KEY_MISSING' });
  check('API_KEY_MISSING : NOT_REQUIRED, aucune reprise (non configuré n’est pas en panne)',
    sansCle.status === INTEGRATED_API_STARTUP.NOT_REQUIRED && sansCle.retryable === false);

  const coupe = statusFromWebhookResult({ skipped: true, reason: 'PROVIDER_DISABLED' });
  check('PROVIDER_DISABLED : NOT_REQUIRED, aucune reprise',
    coupe.status === INTEGRATED_API_STARTUP.NOT_REQUIRED && coupe.retryable === false);

  const sansUrl = statusFromWebhookResult({ skipped: true, reason: 'URL_NOT_PUBLIC' });
  check('URL_NOT_PUBLIC en développement : DEFERRED armé (la veille de tunnel déclenche)',
    sansUrl.status === INTEGRATED_API_STARTUP.DEFERRED && sansUrl.gated === true);

  const conforme = statusFromWebhookResult({ skipped: false, ok: true });
  check('déjà conforme : READY, et la preuve dit qu’on a RELU le distant',
    conforme.status === INTEGRATED_API_STARTUP.READY
    && /relu|conforme/.test(conforme.proof));

  const cree = statusFromWebhookResult({ skipped: false, ok: true, created: true });
  check('créé à distance : READY_RECONCILED, preuve de la correction',
    cree.status === INTEGRATED_API_STARTUP.READY_RECONCILED && /créé/.test(cree.proof));

  const corrige = statusFromWebhookResult({ skipped: false, ok: true, updated: true });
  check('corrigé à distance : READY_RECONCILED', corrige.status === INTEGRATED_API_STARTUP.READY_RECONCILED);

  const panne = statusFromWebhookResult({ skipped: false, ok: false, error: { code: 'HTTP_503', message: 'indisponible' } });
  check('panne distante : DEGRADED_RETRYING avec le code, JAMAIS un faux OK',
    panne.status === INTEGRATED_API_STARTUP.DEGRADED_RETRYING
    && panne.reason === 'HTTP_503' && panne.gated !== true);

  check('tout état favorable porte une preuve non vide',
    [conforme, cree, corrige].every((e) => typeof e.proof === 'string' && e.proof.length > 0));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. GESTIONNAIRE DE REPRISES — clé unique, repli borné, arrêt sur succès');
{
  resetStartupReconciliationForTests();

  let executions = 0;
  registerStartupJob({
    key: 'demo:ok', label: 'travail qui aboutit',
    run: async () => { executions += 1; return { ok: true, detail: 'fait' }; },
  });
  const abouti = await runStartupJob('demo:ok');
  check('succès : le travail est RETIRÉ, pas simplement marqué',
    abouti.ok === true && pendingStartupJobCount() === 0 && executions === 1);

  // Clé unique : deux inscriptions du même geste n'en font qu'un.
  registerStartupJob({ key: 'demo:dup', label: 'a', run: async () => ({ ok: false }) });
  registerStartupJob({ key: 'demo:dup', label: 'a', run: async () => ({ ok: false }) });
  check('clé unique : deux inscriptions du même geste = un seul travail',
    describeStartupReconciliation().filter((j) => j.key === 'demo:dup').length === 1);

  // Repli BORNÉ et croissant, puis abandon explicite.
  resetStartupReconciliationForTests();
  let tentatives = 0;
  registerStartupJob({
    key: 'demo:echec', label: 'travail qui échoue',
    run: async () => { tentatives += 1; return { ok: false, reason: 'HTTP_503' }; },
  });
  const delais = [];
  for (let i = 0; i < 6; i += 1) {
    const issue = await runStartupJob('demo:echec');
    if (issue.delayMs) delais.push(issue.delayMs);
    if (issue.exhausted) break;
  }
  check('repli croissant et borné (jamais une boucle qui martèle)',
    delais.length >= 2 && delais.every((d, i) => i === 0 || d >= delais[i - 1]) && delais.at(-1) <= 300_000);
  check('abandon EXPLICITE après le plafond de tentatives',
    describeStartupReconciliation()[0]?.state === STARTUP_JOB_STATE.EXHAUSTED && tentatives === 5);
  check('…et le travail reste ÉNUMÉRABLE (l’état dégradé ne disparaît pas)',
    pendingStartupJobCount() === 1);

  // Une dépendance qui arrive remet le compteur à zéro.
  let reussiraCetteFois = false;
  registerStartupJob({
    key: 'demo:echec', label: 'travail qui échoue',
    run: async () => (reussiraCetteFois ? { ok: true, detail: 'dépendance là' } : { ok: false, reason: 'HTTP_503' }),
  });
  reussiraCetteFois = true;
  await runPendingStartupJobs({ trigger: 'test' });
  check('la dépendance qui arrive répare même un travail épuisé', pendingStartupJobCount() === 0);

  // Travail ARMÉ : aucune échéance, aucun épuisement, déclenché par l'événement.
  resetStartupReconciliationForTests();
  let arme = 0;
  let dependanceLa = false;
  registerStartupJob({
    key: 'demo:arme', label: 'travail armé', gated: true,
    run: async () => { arme += 1; return dependanceLa ? { ok: true } : { ok: false, reason: 'PANEL_NOT_PAIRED' }; },
  });
  check('un travail armé n’est pas une dette : hors du compte des reprises dues',
    pendingStartupJobCount() === 0 && deferredStartupJobCount() === 1);
  check('…et il refuse toute programmation dans le temps',
    scheduleStartupRetry('demo:arme').scheduled === false);
  await runStartupJob('demo:arme');
  check('…il ne s’épuise jamais : il retourne ARMÉ',
    describeStartupReconciliation()[0]?.state === STARTUP_JOB_STATE.ARMED);
  dependanceLa = true;
  await runPendingStartupJobs({ trigger: 'test' });
  check('…et il part dès que la dépendance apparaît',
    arme === 2 && deferredStartupJobCount() === 0);

  /**
   * ══ UN TRAVAIL ARMÉ DONT LA DÉPENDANCE ARRIVE, PUIS QUI ÉCHOUE ═════════════
   *
   * C'est le trou d'une itération plus loin : l'appairage a bien eu lieu, mais
   * le fournisseur répond 503. Rester armé condamnerait le geste à attendre un
   * événement qui a DÉJÀ eu lieu — donc à dormir jusqu'au redémarrage, ce que
   * ce module existe précisément pour empêcher.
   */
  resetStartupReconciliationForTests();
  let phase = 'PAS_DE_PANEL';
  registerStartupJob({
    key: 'demo:bascule', label: 'armé puis repris', gated: true,
    run: async () => (phase === 'PAS_DE_PANEL'
      ? { ok: false, gated: true, reason: 'PANEL_NOT_PAIRED' }
      : { ok: false, gated: false, reason: 'HTTP_503' }),
  });
  await runStartupJob('demo:bascule');
  check('tant que la dépendance manque : ARMÉ, sans échéance',
    describeStartupReconciliation()[0]?.state === STARTUP_JOB_STATE.ARMED
    && describeStartupReconciliation()[0]?.nextAttemptAt === null);
  phase = 'PANEL_LA_MAIS_EN_PANNE';
  await runPendingStartupJobs({ trigger: 'test-appairage' });
  const bascule = describeStartupReconciliation()[0];
  check('dépendance arrivée + échec transitoire : le travail DEVIENT une reprise programmée',
    bascule?.state === STARTUP_JOB_STATE.RETRYING
    && bascule?.gated === false && Boolean(bascule?.nextAttemptAt));
  check('…et il compte désormais comme une dette, plus comme une attente',
    pendingStartupJobCount() === 1 && deferredStartupJobCount() === 0);

  // Non-réentrance : deux déclencheurs simultanés n'exécutent qu'une fois.
  resetStartupReconciliationForTests();
  let simultanees = 0;
  registerStartupJob({
    key: 'demo:reentrance', label: 'lent',
    run: async () => {
      simultanees += 1;
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true };
    },
  });
  await Promise.all([runStartupJob('demo:reentrance'), runStartupJob('demo:reentrance')]);
  check('non-réentrance : deux déclencheurs, une seule exécution', simultanees === 1);

  resetStartupReconciliationForTests();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. RAPPORT — pas de `[ ok ]` sans preuve, et un résumé CALCULÉ');
{
  resetBootstrapReportForTests();
  beginBootstrapReport();

  const sansPreuve = recordCheck({
    section: BOOT_SECTION.CORE, name: 'contrôle sans preuve', outcome: BOOT_OUTCOME.OK,
  });
  check('un succès sans preuve est REFUSÉ et reclassé dégradé',
    sansPreuve.outcome === BOOT_OUTCOME.DEGRADED && sansPreuve.reason === 'PROOF_MISSING');

  recordCheck({
    section: BOOT_SECTION.CORE, name: 'contrôle prouvé', outcome: BOOT_OUTCOME.OK,
    proof: 'relu en base',
  });
  const resume = bootstrapSummary();
  check('résumé calculé depuis les constats (jamais un compteur tenu à la main)',
    resume.core.ok === 1 && resume.core.degraded === 1 && resume.core.total === 2);

  check('aucun échec bloquant : les invariants passent',
    assertBootstrapInvariants() === true);

  recordCheck({
    section: BOOT_SECTION.CORE, name: 'prérequis bloquant', outcome: BOOT_OUTCOME.FAILED,
    blocking: true, reason: 'DATABASE_UNAVAILABLE',
  });
  let bloque = false;
  let messageBlocage = '';
  try { assertBootstrapInvariants(); } catch (err) {
    bloque = err.code === 'BOOTSTRAP_BLOCKED';
    messageBlocage = err.message;
  }
  check('un prérequis bloquant INTERDIT l’état READY, en nommant la cause',
    bloque && /DATABASE_UNAVAILABLE/.test(messageBlocage));

  const clot = finalizeBootstrapReport({ pendingRetries: 2, deferred: 1 });
  check('la clôture rend les compteurs réels', clot.blockingErrors === 1 && clot.pendingRetries === 2);
  check('le rapport est énumérable sans secret',
    !/whsec_|xkeysib|encryptedValue|Bearer /.test(JSON.stringify(describeBootstrapReport())));

  resetBootstrapReportForTests();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. ORDRE D’AMORÇAGE — la preuve est prise sur la SOURCE');
{
  const src = await fs.readFile(path.join(SRC, 'config/bootstrap.js'), 'utf8');

  const iPanel = src.indexOf('async function amorcerPanel');
  const iApis = src.indexOf('async function amorcerIntegratedApis');
  const iSeq = src.indexOf('await amorcerPanel()');
  const iSeqApis = src.indexOf('await amorcerIntegratedApis()');
  check('les deux étapes existent et sont nommées', iPanel > 0 && iApis > 0);
  check('LE CORRECTIF : l’appairage est amorcé AVANT les IntegratedAPI',
    iSeq > 0 && iSeqApis > 0 && iSeq < iSeqApis);

  const iHydrate = src.indexOf('hydratePairing()');
  const iEnsure = src.indexOf('ensureAllWebhooks(mode)');
  check('…et concrètement : hydratePairing() précède ensureAllWebhooks(mode)',
    iHydrate > 0 && iEnsure > 0 && iHydrate < iEnsure);

  check('l’amorçage passe toujours par l’orchestrateur générique (aucun provider cité)',
    src.includes('ensureAllWebhooks') && !/brevoWebhookConfig\.service|stripe.*\.service\.js/.test(src));

  /**
   * PLUS AUCUN `void` SUR UN GESTE D'AMORÇAGE.
   *
   * `void projectSync.reconcileAll()` et `void startupBridgeHello()` partaient
   * en vol pendant que le démarrage annonçait « PRÊTE ». Leur résultat
   * n'atteignait personne — un signe de vie jamais parti et un signe de vie
   * parti se ressemblaient beaucoup trop.
   */
  check('aucune photographie ni signe de vie lancé en fire-and-forget',
    !/void\s+projectSync\.reconcileAll|void\s+teamSync\.reconcileTeam|void\s+startupBridgeHello/.test(src));

  const srcServeur = await fs.readFile(path.join(SRC, 'server.js'), 'utf8');
  const iAssert = srcServeur.indexOf('assertBootstrapInvariants()');
  const iReady = srcServeur.indexOf('markReady()');
  check('READY est POSÉ APRÈS la vérification des invariants, jamais avant',
    iAssert > 0 && iReady > 0 && iAssert < iReady);

  const srcRetry = await fs.readFile(path.join(SRC, 'services/lifecycle/startupReconciliation.service.js'), 'utf8');
  check('les reprises s’inscrivent elles-mêmes au drainage (aucun timer orphelin)',
    srcRetry.includes('onDrain(() => stopStartupReconciliation()'));

  /**
   * TOUT CE QUE L'AMORÇAGE DÉMARRE, IL L'INSCRIT À L'ARRÊT.
   *
   * ── LA FORME A CHANGÉ, ET ELLE EST PLUS FORTE ────────────────────────────
   *
   * Chaque service inscrivait sa propre fermeture. C'était correct, mais rien
   * ne pouvait RÉPONDRE à « tout ce qui a démarré s'arrête-t-il ? » : il
   * fallait relire le code et espérer n'avoir rien oublié.
   *
   * Les ressources sont désormais INVENTORIÉES, et un vidangeur unique les
   * arrête en ordre inverse. La symétrie devient constatable — la recette la
   * vérifie d'ailleurs à l'exécution, plus bas, pas seulement ici.
   */
  check('l’ordonnanceur du pont est DRAINÉ (arrêté puis attendu), pas seulement arrêté',
    src.includes('drainBridgeScheduler()'));
  check('chaque ressource de fond est inventoriée à son démarrage',
    (src.match(/inscrireRessource\(/g) || []).length >= 3);
  check('un vidangeur UNIQUE arrête les services, en ordre inverse',
    src.includes("onDrain(() => stopBackgroundServices(")
    && /\[\.\.\.ressourcesDeFond\]\.reverse\(\)/.test(src));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. AMORÇAGE RÉEL — projet AUTONOME : le geste est différé, pas perdu');

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const pairingStore = await import('../services/panelBridge/pairingStore.js');

await connectDatabase();

/**
 * L'ADRESSE PUBLIQUE EST POSÉE AVANT LE PREMIER AMORÇAGE.
 *
 * Sans elle, la seule chose que la recette prouverait est « pas d'URL, donc
 * rien à faire » — c'est-à-dire le cas qui n'a jamais posé problème.
 */
await SystemConfiguration.updateOne(
  {}, { $set: { 'network.backendUrl': 'https://demo.exemple-public.fr' } }, { upsert: true },
);

const URL_ATTENDUE = 'https://demo.exemple-public.fr/api/webhooks/stripe';

/* ── LE DOUBLE DE PANEL — un registre d'endpoints, pour CONSTATER l'idempotence */
const endpointsDistants = [];
let appelsEnsure = 0;
let recuperationsSecret = 0;
let panneDuPanel = null;

const fauxPanel = {
  async ping() { return { status: 'ok', service: 'panel-bridge-api', time: new Date().toISOString() }; },
  async bootstrap() { throw new Error('cette recette appaire directement, sans bootstrap Panel.'); },
  async unpair() { return { unpaired: true }; },
  async heartbeat() { return { acknowledged: true, panelTime: new Date().toISOString() }; },
  async pushChanges({ changes = [] }) {
    return { results: changes.map((c) => ({ writeId: c.writeId, status: 'APPLIED' })) };
  },
  async pullChanges() { return { changes: [], cursor: null, hasMore: false }; },
  async introspectFederatedPrincipal() { return { active: true, principal: {} }; },
  /**
   * LA SURFACE `PanelClient` EST EXIGÉE EN ENTIER (contrat 1.11.0).
   *
   * `isPanelClient` vérifie TOUTE la liste : cinq méthodes de projection des
   * modèles d'e-mail ont été ajoutées au contrat sans être reportées dans les
   * doubles, et `new PanelBridge(...)` levait donc au premier appel. Les
   * recettes concernées échouaient sur le SYMPTÔME — un endpoint distant
   * absent, un cycle de worker manquant — jamais sur la cause.
   *
   * Elles ne servent à rien ici : ce double n'a pas de catalogue à rendre.
   * Elles doivent seulement EXISTER.
   */
  async listEmailTemplates() { return { templates: [] }; },
  async getEmailTemplate() { return { template: null }; },
  async previewEmailTemplate() { return { subject: '', html: '' }; },
  async emailTemplateReadiness() { return { ready: true, missing: [] }; },
  async sendEmailTemplateTest() { return { sent: true }; },
  async fetchWebhookVerificationSecret() {
    recuperationsSecret += 1;
    return { webhookSecret: 'whsec_double_de_recette_verification' };
  },
  async invokeCapability(code, input = {}) {
    if (code !== 'webhook.endpoint.ensure') {
      return { capability: code, outcome: 'SUCCEEDED', result: {} };
    }
    appelsEnsure += 1;
    if (panneDuPanel) throw panneDuPanel;
    const url = input.publicBackendUrl
      ? `${String(input.publicBackendUrl).replace(/\/+$/, '')}/api/webhooks/stripe`
      : URL_ATTENDUE;
    let endpoint = endpointsDistants.find((e) => e.url === url);
    let created = false;
    if (!endpoint) {
      endpoint = { id: `we_${endpointsDistants.length + 1}`, url };
      endpointsDistants.push(endpoint);
      created = true;
    }
    return {
      capability: code,
      outcome: 'SUCCEEDED',
      result: {
        endpointId: endpoint.id, url, events: ['*'],
        created, updated: false, secretAvailable: true,
      },
    };
  },
};

const CLE_STRIPE = webhookJobKey('STRIPE', 'payment', 'TEST');
const entree = (provider, capability) => describeBootstrapReport().entries.find(
  (e) => e.name === (capability ? `${provider}/${capability}` : provider),
);

{
  beginBootstrapReport();
  await bootstrap();

  const stripe = entree('STRIPE', 'payment');
  check('projet autonome : STRIPE/payment est DEFERRED, jamais « sauté » sans suite',
    stripe?.status === INTEGRATED_API_STARTUP.DEFERRED && stripe?.reason === 'PANEL_NOT_PAIRED');
  check('…et la ligne DIT que le geste repartira à l’appairage',
    /ARMÉE|armée/.test(stripe?.detail || ''));

  const arme = describeStartupReconciliation().find((j) => j.key === CLE_STRIPE);
  check('…parce qu’un travail nommé l’attend réellement',
    Boolean(arme) && arme.state === STARTUP_JOB_STATE.ARMED && arme.gated === true);
  check('…qui ne compte PAS comme une dette (un projet autonome n’est pas dégradé)',
    pendingStartupJobCount() === 0 && deferredStartupJobCount() === 1);

  check('AUCUN appel distant n’a été tenté sans Panel', appelsEnsure === 0 && endpointsDistants.length === 0);

  // Les autres fournisseurs sont classés, chacun pour SA raison.
  /**
   * L'ENTRÉE S'APPELLE `SIGNATURE`, ET C'EST TOUT LE SENS DE LA BASCULE.
   *
   * Elle s'appelait `YOUSIGN`. Le fournisseur a changé : l'amorçage aurait
   * annoncé « Yousign : administré par la plateforme » pour un service qui ne
   * l'utilise plus. Ce que ce projet a besoin de classer, c'est un DOMAINE —
   * il ne détient aucune credential de signature, et n'a jamais eu à savoir qui
   * l'exécute.
   */
  check('SIGNATURE : NOT_REQUIRED (administrée par la plateforme)',
    entree('SIGNATURE')?.status === INTEGRATED_API_STARTUP.NOT_REQUIRED
    && entree('SIGNATURE')?.reason === 'PANEL_AUTHORITY');
  check('…et plus aucune entrée ne porte le nom d’un fournisseur de signature',
    entree('YOUSIGN') === undefined && entree('OPENSIGN') === undefined);
  check('HOSTINGER : NOT_REQUIRED (administré par la plateforme)',
    entree('HOSTINGER')?.status === INTEGRATED_API_STARTUP.NOT_REQUIRED);
  /*
   * R11 — BREVO A CHANGE DE MOTIF, ET C'EST TOUT LE LOT EN UNE LIGNE.
   *
   * Hier : NOT_REQUIRED / CREDENTIALS_NOT_CONFIGURED, avec `apiKey` nomme —
   * « il te manque une cle ». Aujourd'hui : NOT_REQUIRED / PANEL_AUTHORITY —
   * « il ne te manque rien, ce n'est pas ton role ».
   *
   * Nommer une cle manquante serait devenu un mensonge couteux : aucune
   * ecriture n'est plus acceptee pour en remettre une, et l'exploitant serait
   * parti chercher un champ de saisie qui n'existe plus.
   */
  check('BREVO : NOT_REQUIRED — administré par la plateforme',
    entree('BREVO')?.status === INTEGRATED_API_STARTUP.NOT_REQUIRED
    && entree('BREVO')?.reason === 'PANEL_AUTHORITY');
  check('…et plus aucune clé locale n’est NOMMÉE au démarrage',
    !/apiKey/.test(entree('BREVO')?.detail || ''));

  const sansPreuve = describeBootstrapReport().entries.filter(
    (e) => e.outcome === BOOT_OUTCOME.OK && !e.proof,
  );
  check('AUCUN `[ ok ]` sans preuve sur tout le démarrage', sansPreuve.length === 0,
    sansPreuve.map((e) => e.name).join(', '));

  check('les invariants passent : un projet autonome démarre normalement',
    assertBootstrapInvariants() === true && bootstrapSummary().blockingErrors === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6. LE BUG HISTORIQUE — l’appairage arrive APRÈS, le geste part quand même');
{
  bridgeRuntime.configureBridgeRuntime({ clientFactory: () => fauxPanel });

  // L'ÉVÉNEMENT : l'appairage est établi. Personne n'appelle la réconciliation.
  await pairingStore.setPairing({
    panelUrl: 'https://panel.exemple.test',
    projectId: 'projet-recette',
    panelName: 'Panel L.Y Solution',
    bridgeToken: 'jeton-de-recette',
  });

  // L'observateur d'appairage travaille sans être attendu : on lui laisse le
  // temps, puis on constate — jamais un `sleep` fixe qui masquerait une course.
  const limite = Date.now() + 8_000;
  while (Date.now() < limite && describeStartupReconciliation().some((j) => j.key === CLE_STRIPE)) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }

  check('L’APPAIRAGE DÉCLENCHE LA RÉCONCILIATION — sans redémarrage, sans intervention',
    appelsEnsure === 1 && endpointsDistants.length === 1);
  check('…l’endpoint distant pointe bien vers CE projet',
    endpointsDistants[0]?.url === URL_ATTENDUE);
  check('…le secret de vérification a été rapatrié une fois', recuperationsSecret === 1);

  const stripe = entree('STRIPE', 'payment');
  check('…et le rapport d’amorçage est MIS À JOUR : READY_RECONCILED',
    stripe?.status === INTEGRATED_API_STARTUP.READY_RECONCILED);
  check('…avec une preuve qui décrit ce qui a été vérifié',
    /webhook distant/.test(stripe?.proof || ''));
  check('…et plus aucun travail en attente pour Stripe',
    describeStartupReconciliation().every((j) => j.key !== CLE_STRIPE)
    && pendingStartupJobCount() === 0 && deferredStartupJobCount() === 0);

  const doc = await IntegratedApi.findOne({ provider: 'STRIPE' }).lean();
  const webhook = doc?.modes?.TEST?.webhook;
  check('…l’état local porte l’identifiant distant et l’URL réellement enregistrée',
    webhook?.webhookId === endpointsDistants[0].id && webhook?.webhookUrl === URL_ATTENDUE);
  const creds = doc?.modes?.TEST?.credentials;
  const secret = creds instanceof Map ? creds.get('webhookSecret') : creds?.webhookSecret;
  check('…et le secret est stocké CHIFFRÉ, jamais en clair',
    Boolean(secret?.encryptedValue) && !String(secret.encryptedValue).includes('whsec_'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7. IDEMPOTENCE — rejouer ne crée jamais un second webhook');
{
  const { ensureProviderWebhooks } = await import('../services/webhooks/webhookOrchestrator.service.js');
  const rapport = await ensureProviderWebhooks('STRIPE', 'TEST');
  const resultat = rapport.results[0];

  check('une seconde réconciliation trouve l’endpoint DÉJÀ CONFORME',
    resultat.ok === true && resultat.created === false && resultat.updated === false);
  check('…aucun second endpoint distant', endpointsDistants.length === 1);
  check('…et aucun second rapatriement de secret (le Panel ne le relivre pas)',
    recuperationsSecret === 1);
  check('…l’état traduit devient READY, pas READY_RECONCILED (rien n’a été corrigé)',
    statusFromWebhookResult(resultat).status === INTEGRATED_API_STARTUP.READY);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('8. DOUBLE AMORÇAGE — aucun doublon de webhook, de fournisseur ni d’écouteur');
{
  const { hasSyncListener } = await import('../utils/syncNotifier.js');
  const avant = await IntegratedApi.countDocuments();

  beginBootstrapReport();
  await bootstrap();

  check('projet APPAIRÉ : Stripe est réconcilié DANS le démarrage, plus jamais différé',
    [INTEGRATED_API_STARTUP.READY, INTEGRATED_API_STARTUP.READY_RECONCILED]
      .includes(entree('STRIPE', 'payment')?.status));
  check('…et c’est READY « déjà conforme » : le démarrage n’a rien eu à corriger',
    entree('STRIPE', 'payment')?.status === INTEGRATED_API_STARTUP.READY);
  check('un second amorçage ne crée aucun endpoint distant', endpointsDistants.length === 1);
  check('…aucun fournisseur en double dans le registre',
    (await IntegratedApi.countDocuments()) === avant);
  check('…un seul écouteur de synchronisation (emplacement unique par construction)',
    hasSyncListener() === true);
  check('…et aucune reprise en attente', pendingStartupJobCount() === 0 && deferredStartupJobCount() === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('9. PANNE DISTANTE TEMPORAIRE — pas de faux OK, un état dégradé qui se répare');
{
  panneDuPanel = Object.assign(new Error('Panel momentanément indisponible'), { code: 'CAPABILITY_TIMEOUT' });

  beginBootstrapReport();
  await bootstrap();

  const stripe = entree('STRIPE', 'payment');
  check('une panne distante produit DEGRADED_RETRYING, jamais un succès',
    stripe?.status === INTEGRATED_API_STARTUP.DEGRADED_RETRYING);
  check('…le code de la panne est conservé tel quel', stripe?.reason === 'CAPABILITY_TIMEOUT');
  check('…aucune preuve n’est inventée', !stripe?.proof);
  check('…une reprise RÉELLE est due (elle compte, elle, comme une dette)',
    pendingStartupJobCount() === 1);
  const job = describeStartupReconciliation().find((j) => j.key === CLE_STRIPE);
  check('…programmée dans le temps, avec une échéance lisible',
    job?.state === STARTUP_JOB_STATE.RETRYING && Boolean(job.nextAttemptAt));
  check('…et le service ouvre quand même : une panne externe ne fait pas tomber le backend',
    assertBootstrapInvariants() === true);

  // Le fournisseur revient : la reprise aboutit, sans redémarrage.
  panneDuPanel = null;
  await runPendingStartupJobs({ trigger: 'test-retablissement' });
  check('LE RÉTABLISSEMENT RÉPARE : la reprise aboutit d’elle-même',
    pendingStartupJobCount() === 0
    && [INTEGRATED_API_STARTUP.READY, INTEGRATED_API_STARTUP.READY_RECONCILED]
      .includes(entree('STRIPE', 'payment')?.status));
  check('…et toujours aucun endpoint en double', endpointsDistants.length === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('10. FOURNISSEUR DÉSACTIVÉ — rien n’est dû, et rien n’est appelé');
{
  const avantAppels = appelsEnsure;
  await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { enabled: false } });

  beginBootstrapReport();
  await bootstrap();

  check('STRIPE désactivé : DISABLED, aucune reprise, aucun bruit',
    entree('STRIPE')?.status === INTEGRATED_API_STARTUP.DISABLED
    && pendingStartupJobCount() === 0 && deferredStartupJobCount() === 0);
  check('…et surtout : AUCUN appel distant (couper le fournisseur coupe vraiment)',
    appelsEnsure === avantAppels);

  await IntegratedApi.updateOne({ provider: 'STRIPE' }, { $set: { enabled: true } });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('10bis. RÉCONCILIATION QUI N’A PAS RÉPONDU — « ne rien savoir » ne s’écrit pas [ ok ]');
{
  resetStartupReconciliationForTests();
  beginBootstrapReport();

  const { auditIntegratedApiStartup } = await import(
    '../services/lifecycle/integratedApiStartup.service.js'
  );
  await auditIntegratedApiStartup({
    mode: 'TEST', webhookReport: null, reconciliationFailure: 'RECONCILIATION_TIMEOUT',
  });

  check('délai dépassé : le webhook réellement dû est DEGRADED_RETRYING, jamais silencieux',
    entree('STRIPE', 'payment')?.status === INTEGRATED_API_STARTUP.DEGRADED_RETRYING);
  check('…le motif nomme la cause réelle',
    entree('STRIPE', 'payment')?.reason === 'RECONCILIATION_TIMEOUT');
  /**
   * CE QUI EST CONNU LOCALEMENT NE DÉPEND PAS DU RAPPORT.
   *
   * Rien n'est dû à Brevo — la plateforme l'administre — et un délai dépassé
   * sur le webhook de Stripe ne doit pas transformer ce fait en « dégradé,
   * cinq reprises programmées » : on retenterait d'installer un webhook que
   * ce projet ne possède pas.
   */
  check('…un fournisseur sous autorité plateforme reste NOT_REQUIRED même sans rapport',
    entree('BREVO')?.status === INTEGRATED_API_STARTUP.NOT_REQUIRED
    && entree('BREVO')?.reason === 'PANEL_AUTHORITY');
  /**
   * LA CLÉ DE REPRISE EST LA MÊME QUEL QUE SOIT LE CHEMIN DE L'INCIDENT.
   *
   * Une capacité inventée (« webhook ») produirait une clé différente de celle
   * du chemin nominal (« payment ») : le même geste finirait inscrit deux fois,
   * et le décompte des reprises mentirait.
   */
  const cles = describeStartupReconciliation().map((j) => j.key);
  check('…et la clé vient du REGISTRE, pas d’un nom inventé',
    cles.join(',') === 'webhook:STRIPE:payment:TEST');
  check('…aucune preuve inventée pour un geste dont on ne sait rien',
    !entree('STRIPE', 'payment')?.proof);

  resetStartupReconciliationForTests();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('11. APTITUDE DE SERVICE — l’état dégradé est LISIBLE, l’état bloqué INTERDIT');
{
  const { describeReadiness, resetReadiness, markReady, isReady } = await import(
    '../services/lifecycle/readiness.service.js'
  );
  resetReadiness();
  check('avant READY : les routes métier refusent (503 SERVICE_STARTING)', isReady() === false);

  beginBootstrapReport();
  await bootstrap();
  markReady();

  const etat = describeReadiness();
  check('/readyz porte le résumé d’amorçage, sections comprises',
    etat.bootstrap && etat.bootstrap.core.ok > 0 && typeof etat.bootstrap.integratedApi.ready === 'number');
  check('…il énumère NOMMÉMENT ce qui reste dû (jamais un compteur nu)',
    Array.isArray(etat.bootstrap.retries)
    && etat.bootstrap.pendingRetries === pendingStartupJobCount());
  check('…et il ne transporte aucun secret',
    !/whsec_|xkeysib|encryptedValue/.test(JSON.stringify(etat)));

  // Un prérequis bloquant ferme la porte, même après un amorçage par ailleurs sain.
  recordCheck({
    section: BOOT_SECTION.CORE, name: 'prérequis bloquant simulé', outcome: BOOT_OUTCOME.FAILED,
    blocking: true, reason: 'SINGLETON_UNAVAILABLE',
  });
  let refuse = false;
  try { assertBootstrapInvariants(); } catch { refuse = true; }
  check('un prérequis bloquant INTERDIT le passage à READY', refuse);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('12. ARRÊT — aucune minuterie de reprise ne survit au drainage');
{
  resetStartupReconciliationForTests();
  registerStartupJob({
    key: 'demo:drain', label: 'travail en reprise',
    run: async () => ({ ok: false, reason: 'HTTP_503' }),
  });
  await runStartupJob('demo:drain');
  check('avant l’arrêt : une échéance est bien armée',
    Boolean(describeStartupReconciliation()[0]?.nextAttemptAt));

  const { beginDraining } = await import('../services/lifecycle/runtimeLifecycle.js');
  await beginDraining({ reason: 'recette' });

  check('après DRAINING : plus aucune échéance (pas de job fantôme au redémarrage)',
    describeStartupReconciliation().every((j) => j.nextAttemptAt === null));
  const apresArret = await runStartupJob('demo:drain');
  check('…et plus rien ne se déclenche pendant l’arrêt',
    apresArret.ran === false && apresArret.reason === 'SHUTTING_DOWN');

  resetStartupReconciliationForTests();
}

await disconnectDatabase().catch(() => {});
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
