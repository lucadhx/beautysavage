/**
 * POUSSÉE IMMÉDIATE — invariant `IMMEDIATE_PUSH_IS_NEVER_STARVED`.
 *
 * ══ LE DÉFAUT QUE CE FICHIER VERROUILLE ═════════════════════════════════════
 *
 * Enregistrer dans le Manager déclenche une poussée vers le Panel. Cette
 * poussée passait par `runSyncCycle()`, un cycle GARDÉ contre le
 * chevauchement : quand le tic périodique tournait — c'est-à-dire pendant tout
 * le temps d'un aller-retour réseau, à chaque intervalle — la poussée était
 * SAUTÉE, sans un mot. La modification n'était pas perdue (l'outbox est
 * durable), mais elle attendait le tic suivant.
 *
 * C'est la cause du symptôme « le Panel reste sur l'ancien nom » : intermittent
 * par nature, donc irreproductible à la demande, donc impossible à voir dans un
 * test qui ne fait pas se chevaucher deux cycles.
 *
 * ══ CE QUI EST ÉPROUVÉ ICI ══════════════════════════════════════════════════
 *
 * Une demande de poussée arrivée PENDANT une poussée en vol n'est pas perdue :
 * la poussée en cours revisite la file avant de se terminer. Aucun minuteur,
 * aucun second geste, aucune attente d'intervalle.
 *
 * Runner autonome : aucune base, aucun réseau. La file et le client sont des
 * doublures, mais l'ordonnanceur, lui, est le vrai.
 */
let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const { setPairing, clearPairing } = await import('../services/panelBridge/pairingStore.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const {
  runPushCycle, runSyncCycle, resetSchedulerForTests,
} = await import('../services/panelBridge/bridgeScheduler.js');
const { ACK_STATUS } = await import('../services/panelBridge/bridgeContract.js');

/* ══════════════════════════════════════════════════════════════════════════
   UNE FILE EN MÉMOIRE — même surface que l'adaptateur Mongo, six verbes.
   ══════════════════════════════════════════════════════════════════════════ */
function fileMemoire() {
  const entrees = [];
  return {
    enqueue: async (change) => { entrees.push({ ...change, status: 'PENDING' }); return { queued: true }; },
    claim: async (limit) => {
      const dus = entrees.filter((e) => e.status === 'PENDING').slice(0, limit);
      for (const e of dus) e.status = 'SENDING';
      return dus;
    },
    toChange: (entry) => ({
      writeId: entry.writeId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      deleted: entry.deleted ?? false,
      payload: entry.payload ?? null,
      modifiedAt: entry.modifiedAt,
      emitter: 'PROJECT',
    }),
    acknowledge: async (writeId) => {
      const e = entrees.find((x) => x.writeId === writeId);
      if (e) e.status = 'ACKNOWLEDGED';
    },
    defer: async (writeIds) => {
      for (const id of writeIds) {
        const e = entrees.find((x) => x.writeId === id);
        if (e) e.status = 'PENDING';
      }
    },
    releaseOrphans: async () => 0,
    pending: async () => entrees.filter((e) => e.status !== 'ACKNOWLEDGED').length,
    clear: async () => { entrees.length = 0; },
    /** Observabilité du test — jamais utilisée par le pont. */
    _entrees: entrees,
  };
}

/** Un client dont chaque `pushChanges` peut être retenu par le test. */
function clientRetenu() {
  const relacheurs = [];
  let appels = 0;
  const lots = [];
  return {
    baseUrl: 'http://panel.invalid',
    appels: () => appels,
    lots,
    relacher: () => { const r = relacheurs.shift(); if (r) r(); },
    enAttente: () => relacheurs.length,
    async ping() { return { time: new Date().toISOString() }; },
    async bootstrap() { throw new Error('non utilisé'); },
    async unpair() { return {}; },
    async heartbeat() { return {}; },
    async pushChanges({ changes }) {
      appels += 1;
      lots.push(changes.map((c) => c.entityId));
      await new Promise((resolve) => { relacheurs.push(resolve); });
      return { results: changes.map((c) => ({ writeId: c.writeId, status: ACK_STATUS.APPLIED, code: null, message: null })) };
    },
    async pullChanges() { return { changes: [], cursor: 'MA==', hasMore: false }; },
    /**
     * Contrat 1.5.0 — la passerelle de capacités.
     *
     * Ce test n'éprouve QUE la vivacité de la file de poussée ; la méthode est
     * là parce que `isPanelClient()` exige l'interface COMPLÈTE, et c'est
     * voulu : un double partiel accepté aujourd'hui deviendrait, à la première
     * évolution du contrat, un test vert devant un client incapable.
     */
    async invokeCapability() { throw new Error('non utilisé'); },
    // L6.3A — le canal étroit du secret de vérification fait partie de
    // l'interface : un double partiel serait accepté aujourd'hui et deviendrait
    // un test vert devant un client incapable au premier usage réel.
    async fetchWebhookVerificationSecret() { throw new Error('non utilisé'); },
    /**
     * L12.B — l'introspection d'identité fédérée fait partie de l'interface
     * depuis qu'elle a rejoint `PANEL_CLIENT_METHODS`. Ce double ne l'avait pas
     * suivie : `isPanelClient()` le refusait, et le fichier échouait à la
     * construction du pont — exactement le scénario que le commentaire
     * ci-dessus annonce, et pour lequel l'interface complète est exigée.
     */
    async introspectFederatedPrincipal() { throw new Error('non utilisé'); },
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
  };
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ecriture = (n) => ({
  writeId: uuid(n),
  entityType: 'PROJECT_PRESENTATION',
  entityId: uuid(900 + n),
  deleted: false,
  payload: { companyName: `SB Auto 0${n}` },
  modifiedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
});

/** Laisse le micro-ordonnanceur dérouler ce qui est prêt. */
const respirer = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\nIMMEDIATE_PUSH_IS_NEVER_STARVED — une demande en vol n’est jamais perdue');
{
  resetSchedulerForTests();
  bridgeRuntime.resetBridgeRuntimeForTests();
  await clearPairing();

  const outbox = fileMemoire();
  const client = clientRetenu();
  bridgeRuntime.configureOutboxAdapter(outbox);
  bridgeRuntime.configureBridgeRuntime({
    identityProvider: async () => ({ softwareVersion: 'test', environment: 'TEST' }),
    clientFactory: () => client,
  });
  await setPairing({
    panelUrl: 'http://panel.invalid', projectId: uuid(1), panelName: 'Panel', bridgeToken: 'jeton',
  });

  // La première modification part : la poussée est EN VOL, retenue par le client.
  await outbox.enqueue(ecriture(1));
  const p1 = runPushCycle();
  await respirer();
  check('la première poussée est en vol', client.enAttente() === 1);

  // La seconde modification arrive PENDANT le vol — exactement la situation qui
  // faisait sauter la poussée immédiate.
  await outbox.enqueue(ecriture(2));
  const p2 = await runPushCycle();
  check('la seconde demande est refusée…', p2.skipped === true && p2.reason === 'ALREADY_RUNNING');
  check('…mais elle est MÉMORISÉE, pas jetée', p2.queuedAgain === true);

  // Le premier envoi aboutit. Rien d'autre n'est déclenché par le test.
  client.relacher();
  await respirer();
  check('la poussée en cours revisite la file d’elle-même', client.enAttente() === 1);

  client.relacher();
  const resultat = await p1;
  check('DEUX lots sont partis, sans second geste', client.appels() === 2);
  check('le second lot portait bien la seconde écriture',
    client.lots[1].length === 1 && client.lots[1][0] === ecriture(2).entityId);
  check('la file est vide', (await outbox.pending()) === 0);
  // Le compte est CUMULÉ sur toutes les passes : une poussée qui revisite la
  // file ne doit pas rendre « 0 livrée » après en avoir livré deux.
  check('la poussée rend le compte CUMULÉ de ce qu’elle a livré', resultat?.delivered === 2);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\nLes deux portes mènent à la même file — aucune vidange concurrente');
{
  resetSchedulerForTests();
  bridgeRuntime.resetBridgeRuntimeForTests();

  const outbox = fileMemoire();
  const client = clientRetenu();
  bridgeRuntime.configureOutboxAdapter(outbox);
  bridgeRuntime.configureBridgeRuntime({
    identityProvider: async () => ({ softwareVersion: 'test', environment: 'TEST' }),
    clientFactory: () => client,
  });

  await outbox.enqueue(ecriture(3));
  const pousse = runPushCycle();
  await respirer();
  check('une poussée est en vol', client.enAttente() === 1);

  // Le cycle périodique tombe au même instant : il ne doit pas réclamer le
  // même lot une seconde fois.
  const cycle = runSyncCycle();
  await respirer();
  check('le cycle périodique n’ouvre PAS une seconde vidange', client.enAttente() === 1);

  client.relacher();
  await pousse;
  await cycle;
  check('une seule livraison a eu lieu', client.appels() === 1);
  check('la file est vide', (await outbox.pending()) === 0);

  await clearPairing();
  resetSchedulerForTests();
  bridgeRuntime.resetBridgeRuntimeForTests();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
