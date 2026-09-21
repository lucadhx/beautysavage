import crypto from 'node:crypto';

/**
 * LE HARNAIS DE RECETTE DU MOTEUR DE DÉPLOIEMENT.
 *
 * ══ CE QU'IL EXISTE POUR PROUVER ════════════════════════════════════════════
 *
 * Les lots précédents ont éprouvé le pipeline distant, le registre de phases et
 * le contrat des commandes — chacun séparément. L'ORCHESTRATEUR, lui, n'était
 * exercé par aucune recette : personne ne vérifiait que ces pièces, assemblées,
 * racontent la même histoire.
 *
 * Ce harnais appelle la vraie entrée publique du moteur, avec la vraie base, le
 * vrai coffre de sessions, le vrai traceur, le vrai contrat de commandes. Rien
 * n'est simulé qui ne le soit déjà en production par une abstraction déclarée.
 *
 * ══ CE QU'IL NE FAIT PAS ════════════════════════════════════════════════════
 *
 * Il n'ajoute AUCUNE porte de test au moteur. Chaque point d'entrée qu'il
 * emprunte est un point d'injection ARCHITECTURAL, utilisé en production par
 * quelqu'un d'autre :
 *
 *   · `transportFactory`   — le constructeur du moteur l'accepte depuis
 *                            toujours (dry-run, CLI future) ;
 *   · `options.artifact`   — un artefact déjà construit, cas réel du
 *                            redéploiement sans rebuild ;
 *   · `options.dnsProvider`— l'interface `DnsProvider`, dont Hostinger n'est
 *                            qu'une implémentation parmi d'autres ;
 *   · `passwordVault.openSession` — l'API publique du coffre, celle
 *                            qu'utilise la route de connexion au serveur.
 *
 * S'il avait fallu un `if (test)` dans le moteur, ce serait la preuve qu'une
 * abstraction manque — pas qu'un test est difficile.
 */

/* ══════════════════════════════════════════════════════════════════════════
   L'ARTEFACT — minimal, mais STRUCTURELLEMENT valide.
   ══════════════════════════════════════════════════════════════════════════ */

const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-E2E1234.js"></script></head><body></body></html>';
const APP_JS = 'console.log("app e2e")';
const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

/**
 * Un artefact tel que `buildArtifact` en produit un.
 *
 * Les empreintes web ne sont pas décoratives : depuis le durcissement
 * fail-closed, un déploiement PROD sans empreinte est REFUSÉ à la validation.
 * Un artefact de test sans elles éprouverait un chemin que la production
 * n'emprunte jamais.
 */
export function createArtifactFixture({ commitHash = 'e2e0123456789abcdef', shortCommit = 'e2e0123' } = {}) {
  const empreinte = { indexHash: sha256(INDEX_HTML), mainJs: { name: 'app-E2E1234.js', hash: sha256(APP_JS) } };
  return {
    artifact: {
      dists: { vitrine: '/local/vitrine/dist', manager: '/local/manager/dist' },
      backendDir: '/local/backend',
      web: { vitrine: empreinte, manager: empreinte },
      manifest: { commitHash, shortCommit },
    },
    indexHtml: INDEX_HTML,
    appJs: APP_JS,
    manifest: { commitHash, shortCommit },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LE SERVEUR SIMULÉ — un VPS en bonne santé, et de quoi le casser.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} opts
 * @param {{pattern: string|RegExp, reponse: object}} [opts.casse]
 *        La panne à injecter. Elle porte sur une COMMANDE RÉELLE : on ne
 *        simule pas « l'étape X échoue », on casse ce qu'elle exécute. C'est la
 *        seule façon de prouver que l'étape réellement en cours au moment de la
 *        panne est celle que le rapport nommera.
 */
export async function configureFakeTransport({ casse = null, host = 'e2e.demo.ly-solution.com', artefact } = {}) {
  const { FakeTransport } = await import('../../deployment-engine/transport/FakeTransport.js');
  const fixture = artefact || createArtifactFixture();
  const t = new FakeTransport()
    .on('id -un', { stdout: 'deploy' })
    .on('command -v nginx', { stdout: 'OK' })
    .on('command -v node', { stdout: 'OK' })
    .on('command -v pm2', { stdout: 'OK' })
    .on('command -v certbot', { stdout: 'OK' })
    .on('command -v mongod', { stdout: 'OK' })
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('test -w /var/www', { stdout: 'WRITABLE' })
    .on(/df -Pk/, { stdout: '4000000' })
    .on('fullchain.pem', { stdout: 'OK' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' })
    .on(/-m 10 'https:\/\/[^']+\/'/, { stdout: fixture.indexHtml })
    .on(/\/assets\/app-E2E1234\.js'/, { stdout: fixture.appJs })
    .on(/\/version\.json'/, { stdout: JSON.stringify({ commitHash: fixture.manifest.commitHash }) });

  // Le manifeste relu à l'étape d'installation : `uploadDir` simulé ne peuple
  // pas le système de fichiers virtuel, on le préseme donc.
  for (const site of [host, `manager.${host}`]) {
    t.files.set(`/var/www/${site}/backend/build-manifest.json`, JSON.stringify({ commitHash: fixture.manifest.commitHash }));
  }
  if (casse) t.on(casse.pattern, casse.reponse);
  return t;
}

/* ══════════════════════════════════════════════════════════════════════════
   LE DNS — l'interface réelle, une implémentation en mémoire.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * La phase DNS est TRAVERSÉE, jamais sautée : elle doit passer RUNNING → OK
 * dans le traceur comme n'importe quelle autre. Sauter la phase reviendrait à
 * ne pas tester l'ordre réel, qui place la planification AVANT le SSH et les
 * mutations APRÈS.
 */
export async function createDnsProvider({
  zones = ['demo.ly-solution.com'],
  credentialsOk = true,
  echoueSur = null,
  host = 'e2e.demo.ly-solution.com',
  ip = '198.51.100.10',
  resout = true,
} = {}) {
  const { MockDnsProvider } = await import('../../deployment-engine/dns/MockDnsProvider.js');
  /**
   * LA RÉSOLUTION EST FOURNIE, ET C'EST NÉCESSAIRE.
   *
   * Après ses écritures, la phase DNS ATTEND que les adresses pointent
   * réellement vers le serveur — jusqu'à deux minutes par hôte. Un fournisseur
   * simulé qui ne résout rien ne « rate » pas le test : il le fait durer deux
   * minutes puis conclut à une propagation incomplète. On déclare donc l'état
   * du monde qu'on veut éprouver, plutôt que de subir une attente.
   */
  const resolution = resout
    ? { [host]: ip, [`manager.${host}`]: ip, [`api.${host}`]: ip, [`www.${host}`]: ip }
    : {};
  const provider = new MockDnsProvider({
    zones,
    records: { 'demo.ly-solution.com': [] },
    credentialsOk,
    resolution,
  });
  if (echoueSur) {
    const original = provider[echoueSur].bind(provider);
    provider[echoueSur] = async (...args) => {
      void original;
      throw Object.assign(new Error(`Fournisseur DNS indisponible (${echoueSur}).`), { code: 'DNS_PROVIDER_ERROR' });
    };
  }
  return provider;
}

/* ══════════════════════════════════════════════════════════════════════════
   LA DESTINATION — une fiche réelle, en base réelle.
   ══════════════════════════════════════════════════════════════════════════ */

export async function createTestDestination({
  name = 'E2E', host = 'e2e.demo.ly-solution.com', sshHost = '198.51.100.10',
  environment = 'PROD', lifecycleStatus = 'ACTIVE',
} = {}) {
  const { DeploymentTarget } = await import('../../models/DeploymentTarget.model.js');
  /**
   * UNE SEULE DESTINATION ACTIVE PAR ENVIRONNEMENT — c'est un index UNIQUE.
   *
   * Le modèle interdit deux destinations ACTIVE dans le même environnement :
   * deux adresses concurrentes feraient de la publication des médias une
   * loterie. Un scénario de recette qui crée une nouvelle destination RETIRE
   * donc la précédente, exactement comme le fait un changement de domaine.
   */
  await DeploymentTarget.updateMany(
    { environment, lifecycleStatus: 'ACTIVE' },
    { $set: { lifecycleStatus: 'RETIRED', retiredAt: new Date() } },
  );
  return DeploymentTarget.create({
    lifecycleStatus,
    environment,
    name,
    url: `https://${host}`,
    host,
    type: 'subdomain',
    registrableDomain: 'ly-solution.com',
    subdomain: host.split('.')[0],
    wildcardBase: 'demo.ly-solution.com',
    backendPort: 5010,
    dbName: 'e2e_site',
    sshHost,
    sshUser: 'deploy',
    state: 'NEW',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   LE HARNAIS.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Monte une base en mémoire, ouvre une VRAIE session de coffre, et rend de quoi
 * lancer des déploiements par l'entrée publique du moteur.
 *
 * @returns {Promise<object>} helpers de recette
 */
export async function createDeploymentHarness({ wildcardBases = ['demo.ly-solution.com'] } = {}) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();

  process.env.ENV = process.env.ENV || 'TEST';
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DB_TEST = process.env.DB_TEST || 'e2e_deploiement';
  process.env.DB_PROD = process.env.DB_PROD || 'e2e_deploiement_prod';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-recette-e2e';
  process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY
    || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const { connectDatabase, disconnectDatabase } = await import('../../config/db.js');
  await connectDatabase();

  const vault = await import('../../deployment-engine/passwordVault.js');
  const { DeploymentEngine } = await import('../../deployment-engine/DeploymentEngine.js');
  const runs = await import('../../services/deploymentRun.service.js');
  const { DeploymentRun } = await import('../../models/DeploymentRun.model.js');
  const {
    createStepJournal, recordStep, recordStepCritical, resetRecorderFailure,
  } = await import('../../services/deployment/forensics/runSteps.service.js');

  /**
   * UNE VRAIE SESSION DE COFFRE — pas un objet posé à la main.
   *
   * Le moteur reçoit un `sessionId` opaque et demande au coffre de fabriquer le
   * transport au dernier moment. Contourner ce chemin ne prouverait rien de la
   * gestion des sessions expirées ou absentes, que la recette éprouve aussi.
   */
  // `openSession` rend { sessionId, expiresAt } — c'est l'identifiant OPAQUE
  // que la production transporte, jamais l'entrée du coffre.
  const { sessionId } = vault.openSession({
    host: '198.51.100.10', username: 'deploy', password: 'motdepasse-de-recette',
  });

  return {
    mongod,
    vault,
    sessionId,
    runs,
    DeploymentRun,
    // La défaillance best-effort est un état de module : chaque scénario part
    // d'une ardoise propre, sinon le précédent lui prête sa panne.
    resetRecorderFailure,

    /**
     * Fabrique un moteur dont le transport vient du harnais.
     *
     * `transportFactory` est le point d'injection du CONSTRUCTEUR — celui-là
     * même que la production utilise pour fabriquer un `SshTransport` depuis
     * la session. On y branche le double : le moteur, lui, ne sait pas la
     * différence, et c'est exactement ce qu'on veut éprouver.
     */
    createEngine(transport) {
      return new DeploymentEngine({
        transportFactory: () => transport,
        mongoUri: process.env.MONGODB_URI,
        wildcardBases,
      });
    },

    /**
     * LA COMPOSITION RÉELLE — celle du contrôleur, sans HTTP.
     *
     * Le moteur ne persiste RIEN : il est agnostique de la base, c'est sa
     * règle. La création et la finalisation du `DeploymentRun` appartiennent à
     * la couche applicative. Une recette qui n'appellerait que le moteur ne
     * pourrait donc rien dire de la vérité persistée — et c'est précisément
     * l'écart que ce lot doit fermer.
     */
    async runDeployment({
      engine, target, options = {}, user = 'recette@e2e.test', operationType = 'DEPLOYMENT',
      /**
       * ══ LA PANNE DU JOURNAL DURABLE — INJECTÉE OÙ MONGO ÉCHOUERAIT ════════
       *
       * `createStepJournal` accepte ses écrivains : c'est un port applicatif,
       * pas une porte de test. On y branche un écrivain qui refuse à une étape
       * nommée et délègue au vrai partout ailleurs. La panne se produit donc
       * exactement là où le pilote Mongo lèverait, et tout le reste du chemin —
       * file, régimes, barrière, rapport — est le code de production.
       *
       * @param {{stepId: string, status?: string, motif?: string}} [journalKo]
       */
      journalKo = null,
      /** Le client HTTP a fermé son onglet à cet évènement-là. */
      coupureFluxApres = null,
      /** Trace ordonnée partagée avec le transport, pour prouver un ordre. */
      trace = null,
    }) {
      const evenements = [];
      const fluxRecu = [];
      const run = await runs.createRun({ target, user, version: options.version || 'v-e2e', operationType });
      const runId = String(run._id);

      /**
       * LA COMPOSITION DU CONTRÔLEUR, PIÈCE POUR PIÈCE : la file d'écritures,
       * les deux régimes, la barrière, la vidange, puis la finalisation. Tester
       * `recordStep` isolément ne dirait rien de cet assemblage — et c'est
       * l'assemblage qui décide si une publication a lieu.
       */
      const doit = (patch) => (journalKo
        && patch?.stepId === journalKo.stepId
        && (!journalKo.status || patch?.status === journalKo.status));

      const journalEtapes = createStepJournal(runId, {
        record: async (id, patch) => {
          if (doit(patch)) {
            trace?.push({ kind: 'persist_failed', stepId: patch.stepId, status: patch.status });
            return recordStep(id, { ...patch, durationMs: 'ecriture-refusee-par-la-base' });
          }
          trace?.push({ kind: 'persist', stepId: patch?.stepId, status: patch?.status });
          return recordStep(id, patch);
        },
        recordCritical: async (id, patch) => {
          if (doit(patch)) {
            trace?.push({ kind: 'persist_failed', stepId: patch.stepId, status: patch.status });
            /**
             * ══ ON NE LÈVE PAS UNE ERREUR INVENTÉE ═══════════════════════
             *
             * On soumet à la base un document qu'elle REFUSE : une durée qui
             * n'est pas un nombre. Mongoose lève alors sa vraie `CastError`,
             * depuis `updateOne`, exactement là où un incident réel se
             * produirait — et c'est le code de production qui l'observe,
             * l'interprète et en tire une conséquence.
             */
            return recordStepCritical(id, { ...patch, durationMs: 'ecriture-refusee-par-la-base' });
          }
          trace?.push({ kind: 'persist', stepId: patch?.stepId, status: patch?.status });
          return recordStepCritical(id, patch);
        },
      });

      let clientParti = false;
      const result = await engine.deployWithReport({
        url: target.url,
        sessionId: options.sessionId ?? sessionId,
        user,
        deploymentRunId: runId,
        onEvent: (evt) => {
          evenements.push(evt);
          // Le flux HTTP, lui, peut mourir — l'écriture durable, non.
          if (coupureFluxApres && evt.type === coupureFluxApres) clientParti = true;
          if (!clientParti) fluxRecu.push(evt);

          const statut = {
            'step.started': 'running', 'step.succeeded': 'ok', 'step.warning': 'warning',
            'step.failed': 'error', 'step.skipped': 'skipped',
          }[evt.type];
          if (statut && evt.stepId) {
            journalEtapes.enqueue({
              stepId: evt.stepId,
              label: evt.label ?? null,
              status: statut,
              publicMessage: evt.publicMessage ?? null,
              technicalMessage: evt.technicalMessage ?? null,
              errorCode: evt.errorCode ?? evt.error?.code ?? null,
              durationMs: evt.durationMs ?? null,
              details: evt.details ?? evt.error?.details ?? null,
            });
          }
        },
        options: {
          assertDurable: () => journalEtapes.assertDurable(),
          /**
           * LA PROPAGATION EST BORNÉE — jamais désactivée.
           *
           * La phase attend réellement que les adresses répondent ; on lui donne
           * simplement des délais de recette. Sauter l'attente reviendrait à ne
           * pas éprouver l'ordre réel, qui vérifie AVANT de déployer.
           */
          dnsResolutionOpts: { timeoutMs: 3_000, minIntervalMs: 50, maxIntervalMs: 200 },
          ...options,
        },
      });
      // La file est vidée AVANT la finalisation : sans cela, une écriture
      // d'étape arriverait après la clôture du run.
      await journalEtapes.drain().catch(() => {});
      const perteTardive = journalEtapes.lateFailure();

      let persisted = null;
      let erreurFinalisation = null;
      try {
        persisted = await runs.finalizeRun(runId, {
          ...result,
          journalComplete: !perteTardive,
          journalDegradedAtStepId: perteTardive?.stepId ?? null,
        });
      } catch (err) {
        erreurFinalisation = err;
      }

      return {
        runId,
        result,
        events: evenements,
        fluxRecu,
        persisted,
        erreurFinalisation,
        journal: journalEtapes,
        perteTardive,
      };
    },

    /** Relit le run depuis Mongo — la vérité durable, pas celle en mémoire. */
    async readDeploymentRun(runId) {
      return DeploymentRun.findById(runId).lean();
    },

    async close() {
      vault.closeAll();
      await disconnectDatabase().catch(() => {});
      await mongod.stop();
    },
  };
}

export default createDeploymentHarness;
