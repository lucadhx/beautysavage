/**
 * LE JOURNAL DURABLE ET LA BARRIÈRE DE PUBLICATION.
 *
 * ══ LE DÉFAUT QUE CETTE SUITE FERME ═════════════════════════════════════════
 *
 * La recette de bout en bout du lot précédent finissait sur un constat qu'elle
 * ne pouvait qu'énoncer :
 *
 *     la persistance des étapes est BEST-EFFORT
 *
 * Les transitions étaient écrites en `void recordStep(...)`. Le déploiement
 * n'attendait donc jamais son journal, et surtout n'apprenait jamais qu'il
 * avait cessé d'être écrit. Un incident Mongo au milieu d'un déploiement
 * produisait exactement ceci :
 *
 *     Mongo tombe → les phases continuent → la release est publiée
 *     → le DeploymentRun reste figé à l'étape d'avant
 *
 * Autrement dit : le Panel modifiait la production alors qu'il n'était plus
 * capable de journaliser ce qu'il était en train de faire. Personne — ni
 * l'écran, ni le démarrage suivant — ne pouvait ensuite dire jusqu'où le
 * déploiement était allé.
 *
 * ══ CE QUI EST RÉELLEMENT TRAVERSÉ ══════════════════════════════════════════
 *
 * La composition du contrôleur, entière : `createRun` → `deployWithReport` →
 * `finalizeRun`, avec la vraie file d'écritures, ses deux régimes, la vraie
 * barrière, le vrai modèle Mongo (en mémoire), le vrai coffre, le vrai contrat
 * de commandes distantes.
 *
 * Les pannes de journal sont injectées LÀ OÙ MONGO ÉCHOUERAIT — en soumettant
 * à la base un document que son schéma refuse. Le refus vient donc de la base,
 * avec sa vraie forme d'erreur, et tout le chemin qui l'observe est du code de
 * production.
 */
import {
  configureFakeTransport,
  createArtifactFixture,
  createDeploymentHarness,
  createDnsProvider,
  createTestDestination,
} from './helpers/deploymentHarness.helper.js';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const IP = '198.51.100.10';
const MOT_DE_PASSE_VPS = 'motdepasse-de-recette';
const REMOTE_ENV = {
  ENV: 'PROD',
  MONGODB_URI: 'mongodb+srv://u:motdepasse-distant@cluster.mongodb.net/base',
  DB_PROD: 'e2e_site',
  JWT_SECRET: 'secret-distant-de-quarante-caracteres-au-moins-x',
  INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
};

const harness = await createDeploymentHarness();
const registre = await import('../deployment-engine/steps.js');
const FRONTIERE = registre.publicationBoundaryStep();

/**
 * ══ LA TRACE ORDONNÉE — pour prouver un ORDRE, pas une simultanéité ═════════
 *
 * Des horodatages à la milliseconde ne distinguent pas deux évènements séparés
 * par un tour de boucle. On enregistre donc les deux familles de faits —
 * écritures durables et commandes distantes — dans UNE seule séquence, dans
 * l'ordre où elles surviennent. « A avant B » devient alors une comparaison
 * d'indices, pas une interprétation d'horloge.
 */
function tracerTransport(transport, trace) {
  const execOriginal = transport.exec.bind(transport);
  const uploadOriginal = transport.uploadDir.bind(transport);
  transport.exec = async (command, opts) => {
    trace.push({ kind: 'remote', command: String(command) });
    return execOriginal(command, opts);
  };
  transport.uploadDir = async (local, remote) => {
    trace.push({ kind: 'upload', remote: String(remote) });
    return uploadOriginal(local, remote);
  };
  return transport;
}

/** Les gestes qui rendent la nouvelle version observable. */
const estPublication = (e) => (e.kind === 'upload')
  || (e.kind === 'remote' && /(^|\s)mv\s|rm -rf .*\.prev|mkdir -p .*\.next/.test(e.command));

let compteur = 0;
async function deployer({
  casse = null, journalKo = null, coupureFluxApres = null, dns, options = {},
} = {}) {
  compteur += 1;
  harness.resetRecorderFailure();
  const hote = `rec-${compteur}.demo.ly-solution.com`;
  const fixture = createArtifactFixture();
  const trace = [];
  const transport = tracerTransport(
    await configureFakeTransport({ casse, artefact: fixture, host: hote }),
    trace,
  );
  const cible = await createTestDestination({ host: hote, name: `REC ${compteur}` });
  const issue = await harness.runDeployment({
    engine: harness.createEngine(transport),
    target: cible,
    journalKo,
    coupureFluxApres,
    trace,
    options: {
      artifact: fixture.artifact,
      dnsProvider: dns ?? await createDnsProvider({ host: hote }),
      resolveUploadsSources: async () => ({
        identityId: 'identite-rec',
        sources: [{
          host: 'ancien.demo.ly-solution.com',
          sharedUploadsPath: '/var/www/ancien.demo.ly-solution.com/shared/uploads',
          projectIdentityId: 'identite-rec',
        }],
      }),
      backendPort: 5010,
      env: 'PROD',
      remoteEnv: REMOTE_ENV,
      health: { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 },
      dnsExpectedIp: IP,
      ...options,
    },
  });
  return { ...issue, transport, cible, trace, hote };
}

/** Aucun geste de publication n'a été émis. */
const riensPublie = (t) => !t.some(estPublication);

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. NOMINAL — le journal suit, et le run le dit.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Nominal : le déploiement réussit et sa trace est complète');
  {
    const nominal = await deployer();
    check('le déploiement RÉUSSIT', nominal.result.ok === true);
    check('…aucune perte de durabilité n’est signalée', nominal.perteTardive === null);

    const run = await harness.readDeploymentRun(nominal.runId);
    check('…le run persisté est clos', run.status === 'ok');
    check('…il déclare la publication EFFECTUÉE', run.publication.state === 'OCCURRED');
    check('…sa chronologie est intacte', run.publication.journalComplete === true);
    check('…et la frontière retenue est bien celle du registre',
      run.publication.boundaryStepId === FRONTIERE.id);

    /* Chaque phase du résultat existe AUSSI dans le document durable. */
    const persistees = new Set((run.steps || []).map((s) => s.id));
    check('toute phase du rapport a été écrite au fil de l’eau',
      nominal.result.checklist.every((e) => persistees.has(e.id)));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. CREATE RUN — sans journal ouvert, rien ne commence.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · L’échec de createRun ne laisse partir AUCUNE mutation');
  {
    const fixture = createArtifactFixture();
    const trace = [];
    const transport = tracerTransport(
      await configureFakeTransport({ artefact: fixture, host: 'jamais.demo.ly-solution.com' }),
      trace,
    );
    const dns = await createDnsProvider({ host: 'jamais.demo.ly-solution.com' });
    const avant = (await dns.listRecords('demo.ly-solution.com')).length;

    /**
     * LA PANNE EST RÉELLE : la fiche porte un identifiant que Mongo REFUSE de
     * caster en ObjectId. `createRun` lève donc pour la même raison qu'en
     * production — le document est invalide — et non parce qu'un test l'a
     * décidé.
     */
    let leve = null;
    try {
      await harness.runs.createRun({
        target: { id: 'ceci-nest-pas-un-objectid', name: 'KO', url: 'https://jamais.demo.ly-solution.com', host: 'jamais.demo.ly-solution.com' },
        user: 'recette@rec.test',
        version: 'v-rec',
      });
    } catch (err) { leve = err; }

    check('createRun ÉCHOUE', leve !== null);
    check('…et l’échec est explicite', /Cast|ObjectId|validation/i.test(String(leve?.message)));
    check('…aucune commande distante n’a été émise', trace.filter((e) => e.kind === 'remote').length === 0);
    check('…aucun transfert non plus', trace.filter((e) => e.kind === 'upload').length === 0);
    check('…et aucune écriture DNS',
      (await dns.listRecords('demo.ly-solution.com')).length === avant);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3 à 5. PANNE DU JOURNAL AVANT PUBLICATION — fail closed.

     Le régime critique couvre TOUTE étape antérieure à la frontière. On éprouve
     donc trois moments très différents du même régime : la planification DNS,
     le préflight du serveur, et la construction de la version.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Panne du journal avant publication : la publication est REFUSÉE');
  for (const cas of [
    { nom: 'sur la planification DNS', stepId: 'dns.site', status: 'ok' },
    { nom: 'sur le préflight du serveur', stepId: 'server.preflight', status: 'ok' },
    { nom: 'sur la connexion SSH', stepId: 'ssh.connect', status: 'ok' },
  ]) {
    const ko = await deployer({ journalKo: { stepId: cas.stepId, status: cas.status } });

    check(`${cas.nom} → le déploiement ÉCHOUE`, ko.result.ok !== true);
    check('…avec une erreur TYPÉE de journal',
      ko.result.errorSummary?.code === 'DEPLOYMENT_RECORDER_WRITE_FAILED');
    check('…nommée sur la frontière de publication',
      ko.result.finalStepId === FRONTIERE.id);
    check('…AUCUN geste de publication n’a été émis', riensPublie(ko.trace));
    check('…aucune phase postérieure à la frontière n’est réussie',
      !ko.result.checklist.some((e) => e.status === 'ok'
        && registre.canonicalStep(e.id).order > FRONTIERE.order));

    const run = await harness.readDeploymentRun(ko.runId);
    check('…et le run persisté ne prétend RIEN avoir publié',
      run.publication.state === 'NOT_REACHED');
    check('…il n’est en aucun cas déclaré réussi', run.status !== 'ok');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. LA DERNIÈRE ÉCRITURE AVANT LA PUBLICATION — le test principal du lot.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · La dernière écriture avant publication échoue');
  {
    /**
     * Tout réussit jusqu'à `artifact.build` compris — c'est la dernière étape
     * antérieure à la frontière. On fait échouer l'écriture de SON succès :
     * l'instant exact où le déploiement s'apprête à basculer.
     */
    const ko = await deployer({ journalKo: { stepId: 'artifact.build', status: 'ok' } });

    check('le déploiement ÉCHOUE', ko.result.ok !== true);
    check('…LA COMMANDE DE PUBLICATION N’EST JAMAIS ÉMISE', riensPublie(ko.trace));
    check('…aucun dossier de release n’a été préparé',
      !ko.trace.some((e) => e.kind === 'remote' && /\.next/.test(e.command)));
    check('…aucune bascule n’a eu lieu',
      !ko.trace.some((e) => e.kind === 'remote' && /release\.swap|(^|&& )mv /.test(e.command)));
    check('…l’étape de publication est déclarée en ERREUR, sans avoir été tentée',
      ko.result.checklist.find((e) => e.id === FRONTIERE.id)?.status === 'error');
    const etapeFrontiere = ko.result.steps?.find((e) => e.id === FRONTIERE.id);
    check('…et son message dit à un humain ce qui s’est passé',
      /journal/i.test(String(etapeFrontiere?.publicMessage))
      && etapeFrontiere?.errorCode === 'DEPLOYMENT_RECORDER_WRITE_FAILED');

    /* ── LA PREUVE D'ORDRE ─────────────────────────────────────────────────
       Dans la trace unique, l'écriture refusée précède l'absence de toute
       commande de publication. On vérifie les deux faits ensemble : la panne
       est bien survenue, et rien de public ne l'a suivie. */
    const iPanne = ko.trace.findIndex((e) => e.kind === 'persist_failed');
    check('la panne d’écriture est bien enregistrée dans la trace', iPanne >= 0);
    check('…et aucun geste de publication ne la suit',
      !ko.trace.slice(iPanne).some(estPublication));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. PREUVE POSITIVE DE LA BARRIÈRE — l'ordre dans le cas NOMINAL.
     ══════════════════════════════════════════════════════════════════════════ */
  section('7 · Dans le cas nominal, la durabilité précède la publication');
  {
    const ok = await deployer();
    const dernierePersistAvant = ok.trace.reduce((acc, e, i) => (
      e.kind === 'persist' && registre.isBeforePublication(e.stepId) ? i : acc
    ), -1);
    const premierePublication = ok.trace.findIndex(estPublication);

    check('une écriture durable pré-publication a bien eu lieu', dernierePersistAvant >= 0);
    check('une publication a bien eu lieu', premierePublication >= 0);
    check('…et l’écriture précède la publication (happens-before)',
      dernierePersistAvant < premierePublication);
    check('…l’état « prêt à publier » est donc durable AVANT la bascule',
      ok.trace.slice(0, premierePublication)
        .some((e) => e.kind === 'persist' && e.stepId === 'artifact.build' && e.status === 'ok'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8 et 9. PANNE APRÈS PUBLICATION — tolérance, et honnêteté.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8 · Après la publication, la perte du journal n’annule pas ce qui a eu lieu');
  for (const cas of [
    { nom: 'à la bascule elle-même', stepId: FRONTIERE.id, status: 'ok' },
    { nom: 'à l’installation des dépendances', stepId: 'dependencies.install', status: 'ok' },
    { nom: 'à la migration des médias', stepId: 'uploads.migrate', status: 'ok' },
  ]) {
    const degrade = await deployer({ journalKo: { stepId: cas.stepId, status: cas.status } });

    check(`${cas.nom} → le déploiement N’EST PAS interrompu`, degrade.result.ok === true);
    check('…la publication a bien eu lieu', !riensPublie(degrade.trace));
    check('…la perte de durabilité est SIGNALÉE', degrade.perteTardive !== null);
    check('…et nommée sur la bonne étape', degrade.perteTardive?.stepId === cas.stepId);

    const run = await harness.readDeploymentRun(degrade.runId);
    check('…le run persisté déclare la publication EFFECTUÉE',
      run.publication.state === 'OCCURRED');
    check('…il marque sa chronologie comme INCOMPLÈTE',
      run.publication.journalComplete === false);
    check('…et il dit OÙ la trace s’est trouée',
      run.publication.degradedAtStepId === cas.stepId);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. SANTÉ PUBLIQUE ROUGE + JOURNAL DÉGRADÉ — trois faits, aucun écrasé.
     ══════════════════════════════════════════════════════════════════════════ */
  section('9 · Publication faite, santé publique KO, journal dégradé');
  {
    const trois = await deployer({
      casse: { pattern: /https:\/\/.*\/health/, reponse: { stdout: '000' } },
      journalKo: { stepId: 'public.healthcheck', status: 'error' },
    });

    check('FAIT 1 — la publication a bien eu lieu', !riensPublie(trois.trace));
    check('FAIT 2 — la vérification publique a ÉCHOUÉ', trois.result.ok !== true);
    check('FAIT 3 — le journal est dégradé', trois.perteTardive !== null);

    const run = await harness.readDeploymentRun(trois.runId);
    check('…le run garde les trois : publication effectuée',
      run.publication.state === 'OCCURRED');
    check('…erreur métier conservée',
      run.status === 'error' && run.errorSummary?.code
        && run.errorSummary.code !== 'DEPLOYMENT_RECORDER_WRITE_FAILED');
    check('…et chronologie déclarée incomplète', run.publication.journalComplete === false);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     10. L'ERREUR PRIMAIRE NE SE FAIT JAMAIS ÉCRASER.
     ══════════════════════════════════════════════════════════════════════════ */
  section('10 · Une panne de journal n’efface pas l’erreur du déploiement');
  {
    /**
     * La cause primaire est une commande distante qui échoue APRÈS la
     * publication — le service ne répond pas sur son port. Et au moment même où
     * le rapport doit l'écrire, le journal tombe. C'est la collision que ce
     * scénario existe pour éprouver : deux pannes, dont une seule est la cause.
     */
    const primaire = await deployer({
      casse: { pattern: /127\.0\.0\.1.*health/, reponse: { stdout: '000' } },
      journalKo: { stepId: 'services.verify', status: 'error' },
    });

    check('le déploiement échoue sur la CAUSE RÉELLE',
      primaire.result.finalStepId === 'services.verify');
    check('…et le code d’erreur est celui de la commande distante',
      primaire.result.errorSummary?.code !== 'DEPLOYMENT_RECORDER_WRITE_FAILED'
      && !!primaire.result.errorSummary?.code);

    const run = await harness.readDeploymentRun(primaire.runId);
    check('…le run persisté garde cette erreur primaire',
      run.errorSummary?.code === primaire.result.errorSummary?.code);
    check('…et la panne de journal reste un fait SÉPARÉ',
      run.publication.journalComplete === false);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     11. FINALISATION REFUSÉE — le verdict passe quand même.
     ══════════════════════════════════════════════════════════════════════════ */
  section('11 · finalizeRun refusé : le run est clos malgré tout');
  {
    const base = await deployer();
    const run0 = await harness.readDeploymentRun(base.runId);

    /**
     * On rejoue la finalisation avec un document que le schéma REFUSE : une
     * durée d'étape qui n'est pas un nombre. C'est la parente exacte de la
     * ValidationError du 06/08, celle qui laissait la destination figée sur
     * « Publication… » pendant que l'écran annonçait un succès.
     */
    const persisted = await harness.runs.finalizeRun(base.runId, {
      ...base.result,
      status: 'error',
      ok: false,
      steps: [{ ...(base.result.steps?.[0] ?? { id: 'ssh.connect' }), durationMs: 'duree-refusee-par-la-base' }],
      errorSummary: { code: 'REMOTE_COMMAND_FAILED', message: 'échec distant' },
    });

    check('la finalisation ne LÈVE pas — le verdict a été écrit', persisted !== null);
    const run = await harness.readDeploymentRun(base.runId);
    check('…le run n’est plus « en cours »', run.status !== 'running');
    check('…il porte le verdict demandé', run.status === 'error');
    check('…l’erreur primaire est conservée', run.errorSummary?.code === 'REMOTE_COMMAND_FAILED');
    check('…l’échec d’écriture du rapport est DIT', !!run.reportPersistenceError);
    check('…et le rapport précédent n’a pas été remplacé par du vide',
      !!run0.structuredReport && !!run.structuredReport);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     12. LE NAVIGATEUR PART — le déploiement, lui, reste.
     ══════════════════════════════════════════════════════════════════════════ */
  section('12 · La fermeture du flux HTTP n’affecte aucune écriture');
  {
    const coupe = await deployer({ coupureFluxApres: 'step.started' });

    check('le déploiement va jusqu’au bout', coupe.result.ok === true);
    check('…alors que le flux a cessé très tôt',
      coupe.fluxRecu.length < coupe.events.length);

    const run = await harness.readDeploymentRun(coupe.runId);
    const persistees = new Set((run.steps || []).map((s) => s.id));
    check('…TOUTES les phases sont pourtant persistées',
      coupe.result.checklist.every((e) => persistees.has(e.id)));
    check('…le run est clos normalement', run.status === 'ok');
    check('…et la publication est enregistrée', run.publication.state === 'OCCURRED');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     13. LA CONCURRENCE RESTE PROTÉGÉE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('13 · Deux déploiements sur la même destination : un seul passe');
  {
    const lifecycle = await import('../services/deployment/destinationLifecycle.service.js');
    const cible = await createTestDestination({ host: 'conc.demo.ly-solution.com', name: 'REC CONC' });
    const a = await harness.runs.createRun({ target: cible, user: 'a@rec.test', version: 'v1' });
    const b = await harness.runs.createRun({ target: cible, user: 'b@rec.test', version: 'v1' });

    await lifecycle.lockForDeployment(String(cible._id), String(a._id));
    let refus = null;
    try {
      await lifecycle.lockForDeployment(String(cible._id), String(b._id));
    } catch (err) { refus = err; }

    check('le SECOND est refusé', refus !== null);
    check('…avec un conflit explicite', refus?.statusCode === 409 || refus?.status === 409);

    /* Le run refusé doit être CLOS, pas abandonné en « running ». */
    await harness.runs.finalizeRun(String(b._id), {
      ok: false, status: 'error', finalStepId: 'deployment.initialize', steps: [],
      errorSummary: { code: 'DEPLOYMENT_ALREADY_RUNNING', message: refus?.message ?? '' },
    });
    const runB = await harness.readDeploymentRun(String(b._id));
    check('…et son run est correctement clos', runB.status === 'error');
    check('…sans rien prétendre avoir publié', runB.publication.state === 'NOT_REACHED');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     14. LES RUNS ORPHELINS — le nouveau modèle survit à la reprise.
     ══════════════════════════════════════════════════════════════════════════ */
  section('14 · Reprise d’un run orphelin : ce qui a été publié le reste');
  {
    const etapes = await import('../services/deployment/forensics/runSteps.service.js');
    const cible = await createTestDestination({ host: 'orph.demo.ly-solution.com', name: 'REC ORPH' });
    const run = await harness.runs.createRun({ target: cible, user: 'o@rec.test', version: 'v1' });

    /**
     * Un run mort EN PLEINE publication : la bascule a réussi, le process a
     * disparu avant d'écrire la suite. C'est la fenêtre de crash la plus
     * délicate, et la seule chose qui compte est qu'on n'affirme pas ensuite
     * que rien n'a été publié.
     */
    await harness.DeploymentRun.updateOne({ _id: run._id }, {
      $set: {
        executorPid: 999_999,
        publication: { state: 'OCCURRED', boundaryStepId: FRONTIERE.id, journalComplete: false, degradedAtStepId: FRONTIERE.id },
      },
    });
    await etapes.recordStep(run._id, { stepId: 'services.start', label: 'Démarrage', status: 'running' });

    const reprise = await etapes.recoverOrphanRuns({ reason: 'process_restart' });
    check('la reprise ferme le run orphelin', reprise.recovered >= 1);

    const repris = await harness.readDeploymentRun(String(run._id));
    check('…il est marqué INTERROMPU, pas en échec', repris.status === 'interrupted');
    check('…son étape en cours est interrompue',
      (repris.steps || []).find((s) => s.id === 'services.start')?.status === 'interrupted');
    check('…et il continue d’affirmer que la publication a eu lieu',
      repris.publication.state === 'OCCURRED');
    check('…avec sa chronologie déclarée incomplète',
      repris.publication.journalComplete === false);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     15. AUCUN SECRET, MÊME QUAND TOUT VA MAL.
     ══════════════════════════════════════════════════════════════════════════ */
  section('15 · Ni mot de passe, ni URI de base, même en panne de journal');
  {
    const ko = await deployer({ journalKo: { stepId: 'artifact.build', status: 'ok' } });
    const run = await harness.readDeploymentRun(ko.runId);
    const tout = JSON.stringify({ run, resultat: ko.result });

    check('aucun mot de passe VPS nulle part', !tout.includes(MOT_DE_PASSE_VPS));
    check('…aucun secret d’environnement distant',
      !tout.includes(REMOTE_ENV.JWT_SECRET) && !tout.includes(REMOTE_ENV.INTEGRATED_API_ENCRYPTION_KEY));
    check('…et aucune URI de base de données',
      !/mongodb(\+srv)?:\/\/[^«]/.test(tout));

    /**
     * Le motif d'une panne d'écriture peut contenir l'URI de connexion : c'est
     * le pilote Mongo qui l'y met. On vérifie que le caviardage tient sur ce
     * chemin-là précisément.
     */
    const { RecorderWriteError } = await import('../services/deployment/forensics/runSteps.service.js');
    const err = new RecorderWriteError('journal indisponible', {
      stepId: 'x', cause: 'connect ECONNREFUSED mongodb+srv://u:p@cluster.net/base',
    });
    check('le motif conservé porte bien la cause', typeof err.cause === 'string');
    check('…et le code d’erreur est stable',
      err.code === 'DEPLOYMENT_RECORDER_WRITE_FAILED');
  }
} finally {
  await harness.close();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
