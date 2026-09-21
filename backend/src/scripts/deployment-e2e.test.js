/**
 * LE MOTEUR DE DÉPLOIEMENT, DE BOUT EN BOUT — par son entrée publique réelle.
 *
 * ══ LE TROU QUE CETTE SUITE FERME ═══════════════════════════════════════════
 *
 * Les lots précédents ont éprouvé le pipeline distant, le registre de phases, le
 * traceur et le contrat des commandes — chacun séparément, chacun solidement.
 * L'ORCHESTRATEUR, lui, n'était exercé par aucune recette. Personne ne
 * vérifiait que ces pièces, assemblées, racontent la même histoire : ni que
 * l'ordre réel des phases correspond au registre, ni que le `DeploymentRun`
 * persisté dit la même chose que le résultat rendu, ni qu'un échec de commande
 * remonte jusqu'à l'écran.
 *
 * ══ CE QUI EST RÉELLEMENT TRAVERSÉ ══════════════════════════════════════════
 *
 *   · `DeploymentEngine.deployWithReport()` — l'entrée publique instrumentée,
 *     appelée telle quelle. Ni `runPipeline`, ni le traceur, ni `emitStep` ne
 *     sont appelés à sa place ;
 *   · une base Mongo RÉELLE en mémoire, et le vrai modèle `DeploymentRun` ;
 *   · le VRAI coffre de sessions (`openSession` / `getSession`) ;
 *   · le VRAI contrat de commandes distantes — `runRemoteCommand` n'est pas
 *     doublé, les commandes sont réellement émises et leurs codes lus ;
 *   · la VRAIE phase DNS, sur l'interface `DnsProvider` ;
 *   · le VRAI traceur de phases, avec ses transitions et ses violations.
 *
 * Seuls le TRANSPORT et le FOURNISSEUR DNS sont simulés — par les deux points
 * d'injection que le moteur déclare depuis toujours, et qu'aucune ligne de test
 * n'a eu besoin d'ajouter.
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
const REMOTE_ENV = {
  ENV: 'PROD',
  MONGODB_URI: 'mongodb+srv://u:motdepasse-distant@cluster.mongodb.net/base',
  DB_PROD: 'e2e_site',
  JWT_SECRET: 'secret-distant-de-quarante-caracteres-au-moins-x',
  INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
};

const harness = await createDeploymentHarness();

/**
 * Un déploiement complet, avec la panne éventuellement injectée.
 *
 * CHAQUE SCÉNARIO A SA PROPRE DESTINATION. L'hôte est unique par appel : la
 * base impose l'unicité de l'hôte parmi les destinations vivantes — comme en
 * production, où deux fiches ne peuvent pas revendiquer le même domaine.
 */
let compteurScenario = 0;
async function deployer({ casse = null, dns, target, options = {}, host } = {}) {
  compteurScenario += 1;
  const hote = host || `e2e-${compteurScenario}.demo.ly-solution.com`;
  const fixture = createArtifactFixture();
  const transport = await configureFakeTransport({ casse, artefact: fixture, host: hote });
  const engine = harness.createEngine(transport);
  const cible = target || await createTestDestination({ host: hote, name: `E2E ${compteurScenario}` });
  const issue = await harness.runDeployment({
    engine,
    target: cible,
    options: {
      artifact: fixture.artifact,
      dnsProvider: dns ?? await createDnsProvider({ host: cible.host }),
      /**
       * LES MÉDIAS PERSISTANTS SONT RÉELLEMENT MIGRÉS.
       *
       * Sans cette résolution, l'étape se déclare « non configurée » et se
       * saute : on n'éprouverait ni l'inventaire, ni le contrat critique qui le
       * gouverne. On déclare donc un emplacement antérieur, comme le fait le
       * contrôleur à partir de l'historique du projet.
       */
      resolveUploadsSources: async () => ({
        identityId: 'identite-e2e',
        sources: [{
          host: 'ancien.demo.ly-solution.com',
          sharedUploadsPath: '/var/www/ancien.demo.ly-solution.com/shared/uploads',
          projectIdentityId: 'identite-e2e',
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
  return { ...issue, transport, cible };
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LE SCÉNARIO NOMINAL — de l'entrée publique au run persisté.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Un déploiement complet, par l’entrée publique du moteur');
  const nominal = await deployer();

  check('le déploiement RÉUSSIT', nominal.result.ok === true && nominal.result.status === 'ok');
  check('…et se termine à la finalisation', nominal.result.finalStepId === 'deployment.finalize');
  check('…sans aucune erreur', nominal.result.errorSummary === null);
  check('…et SANS violation de protocole', nominal.result.protocolViolations.length === 0);

  /**
   * AUCUNE ÉTAPE LAISSÉE EN COURS.
   * Une étape ouverte et jamais refermée, c'est un écran figé sur « en cours » :
   * ni succès, ni erreur, ni rapport, et rien à relancer.
   */
  const enCours = nominal.result.checklist.filter((e) => e.status === 'running' || e.status === 'pending');
  check('aucune étape ne reste en cours ou en attente', enCours.length === 0);

  /* ── L'ORDRE OBSERVÉ EST COMPARÉ AU REGISTRE, PAS À UNE SECONDE LISTE ──── */
  const registre = await import('../deployment-engine/steps.js');
  const applicables = registre.stepsForMode(registre.RUN_MODES.DEPLOYMENT);
  const observees = nominal.result.checklist.map((e) => e.id);

  check('toute phase observée appartient au REGISTRE',
    observees.every((id) => registre.isKnownStep(id)));
  check('…et toutes les phases applicables sont observées',
    applicables.every((s) => observees.includes(s.id)));
  const ordres = observees.map((id) => registre.canonicalStep(id).order);
  check('…dans l’ORDRE CANONIQUE', ordres.every((o, i) => i === 0 || o > ordres[i - 1]));
  check('…toutes abouties', nominal.result.checklist.every((e) => ['ok', 'warning', 'skipped'].includes(e.status)));

  console.log('\n  ── PHASES OBSERVÉES ──');
  nominal.result.checklist.forEach((e, i) => console.log(
    `  ${String(i + 1).padStart(2, '0')} ${e.status.toUpperCase().padEnd(8)} ${e.id}`
  ));
  console.log('');

  /* ── LA TRACE DE COMMANDES — par leur INTENTION, pas leur orthographe ──── */
  const commandes = nominal.transport.commands.map((c) => (typeof c === 'string' ? c : c.command));
  const aExecute = (motif) => commandes.some((c) => motif.test(c));
  section('2 · Les commandes du contrat sont réellement passées');
  check('la préparation des dossiers de release a eu lieu', aExecute(/mkdir -p .*certbot/));
  check('la bascule de release a eu lieu', aExecute(/mv .*\.next /));
  check('l’installation des dépendances a eu lieu', aExecute(/npm ci --omit=dev/));
  check('l’inventaire des médias a eu lieu', aExecute(/find \. -type f -exec sha256sum/));
  check('la configuration Nginx a été installée', aExecute(/sudo mv .*nginx\.conf/));
  check('…puis validée', aExecute(/nginx -t/));
  check('…puis rechargée', aExecute(/reload nginx/));
  check('le service a été (re)démarré', aExecute(/pm2 (start|restart|reload|delete)/));
  check('la santé locale a été vérifiée', aExecute(/127\.0\.0\.1.*health/));
  check('la santé publique a été vérifiée', aExecute(/https:\/\/.*\/health/));

  /**
   * LES COMMANDES CRITIQUES SONT SOUS SHELL STRICT.
   * On ne teste pas l'orthographe : on vérifie que le préambule qui arrête la
   * chaîne à la première erreur est bien là où le contrat l'exige.
   */
  check('les commandes composées critiques portent le shell strict',
    commandes.filter((c) => /npm ci --omit=dev|mv .*\.next /.test(c)).every((c) => /set -euo pipefail/.test(c)));

  /* ══════════════════════════════════════════════════════════════════════════
     3. LA VÉRITÉ PERSISTÉE — la base et la mémoire racontent la même histoire.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Le run persisté dit exactement ce que le moteur a rendu');
  const persiste = await harness.readDeploymentRun(nominal.runId);
  check('le run existe en base', persiste !== null);
  check('…avec le même statut', persiste.status === nominal.result.status);
  check('…la même étape finale', persiste.finalStepId === nominal.result.finalStepId);
  check('…la même destination', persiste.siteHost === nominal.cible.host);
  check('…le même environnement', persiste.env === 'PROD');
  check('…la même version', persiste.version === nominal.result.version);
  check('…et la même absence d’erreur', persiste.errorSummary === null || persiste.errorSummary === undefined);
  check('il porte ses étapes', persiste.steps.length === nominal.result.steps.length);
  check('…dans le même ordre', persiste.steps.map((s) => s.id).join('|') === nominal.result.steps.map((s) => s.id).join('|'));
  check('…avec les mêmes statuts', persiste.steps.map((s) => s.status).join('|') === nominal.result.steps.map((s) => s.status).join('|'));
  check('il est daté de bout en bout',
    Boolean(persiste.startedAt) && Boolean(persiste.finishedAt) && persiste.durationMs >= 0);
  check('et son résumé annonce la publication', /Publié/.test(persiste.summary || ''));

  /**
   * AUCUN SECRET N'A SURVÉCU AU RAPPORT.
   * Le `.env` distant porte une URI Mongo et un secret JWT : ils traversent le
   * moteur, sont écrits sur la destination, et ne doivent apparaître ni dans le
   * rapport lisible, ni dans la trace persistée.
   */
  const toutLeRun = JSON.stringify(persiste);
  check('aucune URI Mongo distante dans le run persisté', !toutLeRun.includes('motdepasse-distant'));
  check('aucun secret JWT distant', !toutLeRun.includes(REMOTE_ENV.JWT_SECRET));
  check('aucune clé de chiffrement', !toutLeRun.includes(REMOTE_ENV.INTEGRATED_API_ENCRYPTION_KEY));
  check('aucun mot de passe de session VPS', !toutLeRun.includes('motdepasse-de-recette'));

  /* ══════════════════════════════════════════════════════════════════════════
     4. ÉCHEC DE COMMANDE CRITIQUE — depuis l'ORCHESTRATEUR.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · npm ci en échec : prouvé depuis l’orchestrateur, pas le pipeline');
  {
    const ko = await deployer({ casse: { pattern: /npm ci --omit=dev/, reponse: { code: 1, stderr: 'ERR! registre injoignable' } } });
    check('le déploiement ÉCHOUE', ko.result.ok === false && ko.result.status === 'error');
    check('…à l’étape d’installation', ko.result.finalStepId === 'dependencies.install');
    check('…avec une erreur typée', ko.result.errorSummary?.code === 'REMOTE_COMMAND_FAILED');

    const parEtape = new Map(ko.result.checklist.map((e) => [e.id, e.status]));
    check('l’étape fautive est en ERREUR', parEtape.get('dependencies.install') === 'error');
    check('…les étapes antérieures restent OK', parEtape.get('artifact.upload') === 'ok');
    check('…et AUCUNE étape suivante n’est réussie',
      ['nginx.configure', 'https.configure', 'services.start', 'public.healthcheck']
        .every((id) => parEtape.get(id) !== 'ok'));
    check('la frontière de publication n’est JAMAIS franchie',
      parEtape.get('https.configure') === 'pending' || parEtape.get('https.configure') === undefined);

    const run = await harness.readDeploymentRun(ko.runId);
    check('le run persisté est en ERREUR', run.status === 'error');
    check('…et nomme la même étape', run.finalStepId === 'dependencies.install');
    check('…et porte l’erreur', run.errorSummary?.code === 'REMOTE_COMMAND_FAILED');
    check('son résumé annonce un échec', /Échec/.test(run.summary || ''));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. COUPURE SSH — jamais une continuation silencieuse.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · Connexion perdue pendant l’installation');
  {
    const coupe = await deployer({ casse: { pattern: /npm ci --omit=dev/, reponse: { code: null } } });
    check('le déploiement ÉCHOUE', coupe.result.ok === false);
    check('…avec le code de connexion perdue',
      coupe.result.errorSummary?.code === 'REMOTE_COMMAND_CONNECTION_LOST');
    check('…sur l’étape d’installation', coupe.result.finalStepId === 'dependencies.install');
    const run = await harness.readDeploymentRun(coupe.runId);
    check('…et le run persisté le dit aussi',
      run.status === 'error' && run.errorSummary?.code === 'REMOTE_COMMAND_CONNECTION_LOST');

    const tue = await deployer({ casse: { pattern: /npm ci --omit=dev/, reponse: { code: null, signal: 'SIGKILL' } } });
    check('un process TUÉ est distingué d’une coupure',
      tue.result.errorSummary?.code === 'REMOTE_COMMAND_SIGNALLED');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. ÉCHEC APRÈS LA FRONTIÈRE DE PUBLICATION.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · Après publication, le rapport ne réécrit pas l’histoire');
  {
    const apres = await deployer({ casse: { pattern: /https:\/\/.*\/health/, reponse: { stdout: '000' } } });
    check('le déploiement ÉCHOUE', apres.result.ok === false);
    const parEtape = new Map(apres.result.checklist.map((e) => [e.id, e.status]));
    check('…à la vérification publique', apres.result.finalStepId === 'public.healthcheck');

    /**
     * CE QUI PRÉCÈDE RESTE VRAI, ET C'EST LE POINT.
     * La nouvelle version EST publiée. Remettre l'activation sur « en attente »
     * ferait disparaître du rapport le fait qu'une version non vérifiée est en
     * ligne — c'est-à-dire exactement ce qu'il faut savoir pour décider d'un
     * retour arrière.
     */
    check('l’activation HTTPS reste OK', parEtape.get('https.configure') === 'ok');
    check('…les services démarrés restent démarrés', parEtape.get('services.start') === 'ok');
    check('…et l’étape fautive est la seule en erreur',
      apres.result.checklist.filter((e) => e.status === 'error').length === 1);

    const run = await harness.readDeploymentRun(apres.runId);
    const etapesPersistees = new Map(run.steps.map((s) => [s.id, s.status]));
    check('le run persisté conserve la publication', etapesPersistees.get('https.configure') === 'ok');
    check('…et l’échec postérieur', etapesPersistees.get('public.healthcheck') === 'error');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. ÉCHEC DU FOURNISSEUR DNS — avant toute mutation distante.
     ══════════════════════════════════════════════════════════════════════════ */
  section('7 · Le DNS échoue avant que le serveur ne soit touché');
  {
    /**
     * ON CASSE CE QUE LA PHASE APPELLE VRAIMENT.
     *
     * La planification interroge `findBestZone`, `verifyCredentials` puis
     * `listRecords` — pas `listZones`. Injecter la panne ailleurs prouverait
     * seulement que le test s'est trompé de cible.
     */
    const dnsKo = await createDnsProvider({ echoueSur: 'verifyCredentials' });
    const ko = await deployer({ dns: dnsKo });
    check('le déploiement ÉCHOUE', ko.result.ok === false);
    const parEtape = new Map(ko.result.checklist.map((e) => [e.id, e.status]));
    check('…sur une étape du domaine',
      ['dns.zone', 'dns.provider', 'dns.read'].includes(ko.result.finalStepId));
    check('…la connexion SSH n’a jamais eu lieu', parEtape.get('ssh.connect') === 'pending');

    /**
     * AUCUNE COMMANDE DISTANTE INUTILE.
     * La planification DNS précède le SSH : si elle échoue, rien ne doit avoir
     * été exécuté sur le serveur — pas même une sonde de préflight.
     */
    check('AUCUNE commande distante n’a été exécutée', ko.transport.commands.length === 0);
    const run = await harness.readDeploymentRun(ko.runId);
    check('le run persisté est en erreur', run.status === 'error');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8. SESSION DE COFFRE INVALIDE — fail closed.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8 · Sans session valide, rien n’est touché');
  {
    const sansSession = await deployer({ options: { sessionId: 'session-qui-n-existe-pas' } });
    check('le déploiement ÉCHOUE', sansSession.result.ok === false);
    check('…avec NO_VPS_SESSION', sansSession.result.errorSummary?.code === 'NO_VPS_SESSION');
    check('…dès l’initialisation', sansSession.result.finalStepId === 'deployment.initialize');
    check('AUCUNE commande distante', sansSession.transport.commands.length === 0);

    const parEtape = new Map(sansSession.result.checklist.map((e) => [e.id, e.status]));
    check('…aucune étape DNS n’a été tentée', parEtape.get('dns.zone') === 'pending');

    /**
     * LE RUN EXISTE QUAND MÊME, ET C'EST LA BONNE DOCTRINE.
     * Une tentative refusée est un fait : la tracer permet de distinguer « rien
     * n'a été tenté » de « quelqu'un a essayé sans session ». Le contrat actuel
     * est constaté, pas modifié.
     */
    const run = await harness.readDeploymentRun(sansSession.runId);
    check('un run est tout de même enregistré, en erreur', run.status === 'error');
    check('…nommant la session absente', run.errorSummary?.code === 'NO_VPS_SESSION');

    /* Une session FERMÉE se comporte comme une session absente. */
    const { sessionId } = harness.vault.openSession({ host: IP, username: 'deploy', password: 'x' });
    harness.vault.closeSession(sessionId);
    const fermee = await deployer({ options: { sessionId } });
    check('une session FERMÉE est refusée de la même façon',
      fermee.result.errorSummary?.code === 'NO_VPS_SESSION');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. CONCURRENCE — une seule publication par destination.
     ══════════════════════════════════════════════════════════════════════════ */
  section('9 · Deux déploiements sur la même destination : un seul passe');
  {
    const targets = await import('../services/deploymentTarget.service.js');
    const cible = await createTestDestination({ host: 'concurrence.demo.ly-solution.com', name: 'Concurrence' });

    /**
     * LE VERROU EST ÉPROUVÉ AVEC UN RUN RÉELLEMENT EN COURS.
     *
     * C'est la condition qui compte : un verrou détenu par un run terminé est
     * orphelin et doit pouvoir être repris, sinon un redémarrage du Panel
     * condamnerait la destination.
     */
    const runEnCours = await harness.runs.createRun({ target: cible, user: 'e2e', version: 'v1' });
    const premier = await targets.markDeploying(String(cible._id), String(runEnCours._id))
      .then(() => 'ok').catch((e) => e.code || e.message);
    const second = await targets.markDeploying(String(cible._id), 'un-autre-run')
      .then(() => 'ok').catch((e) => e.code || e.message);
    check('le premier obtient le verrou', premier === 'ok');
    check('le second est REFUSÉ', second !== 'ok');
    check('…proprement, avec un message actionnable',
      typeof second === 'string' && /déjà en cours/.test(second));

    /**
     * UN VERROU ORPHELIN SE REPREND.
     * Son run n'est plus `running` : le process qui le détenait a disparu, et
     * refuser indéfiniment transformerait une panne passagère en destination
     * définitivement bloquée.
     */
    await harness.DeploymentRun.updateOne({ _id: runEnCours._id }, { $set: { status: 'error' } });
    const reprise = await targets.markDeploying(String(cible._id), 'run-de-reprise')
      .then(() => 'ok').catch((e) => e.code || e.message);
    check('un verrou ORPHELIN est repris, pas subi', reprise === 'ok');

    /**
     * DEUX DESTINATIONS DIFFÉRENTES RESTENT INDÉPENDANTES.
     * Un verrou global accidentel se verrait ici : il refuserait un
     * déploiement qui n'a rien à voir avec celui en cours.
     */
    const autre = await createTestDestination({ host: 'autre.demo.ly-solution.com', name: 'Autre' });
    const surAutre = await targets.markDeploying(String(autre._id)).then(() => 'ok').catch((e) => e.code || e.message);
    check('une AUTRE destination n’est pas bloquée', surAutre === 'ok');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     10. LE MOTEUR NE CONTIENT AUCUNE PORTE DE TEST.
     ══════════════════════════════════════════════════════════════════════════ */
  section('10 · Aucune branche de test dans le moteur');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'deployment-engine');

    const fautifs = [];
    (function parcourir(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const complet = path.join(dir, e.name);
        if (e.isDirectory()) { parcourir(complet); continue; }
        if (!/\.js$/.test(e.name)) continue;
        const src = fs.readFileSync(complet, 'utf8')
          .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        if (/NODE_ENV\s*===\s*['"]test|options\.fakeE2E|bypassDns|skipRecorder|skipValidation/.test(src)) {
          fautifs.push(e.name);
        }
      }
    }(racine));
    check('le moteur ne connaît pas l’environnement de test', fautifs.length === 0);
    if (fautifs.length) console.error(`    → portes de test : ${fautifs.join(', ')}`);

    /**
     * LES POINTS D'INJECTION EMPRUNTÉS SONT ARCHITECTURAUX.
     * Chacun sert à quelqu'un d'autre qu'au test : le constructeur accepte une
     * fabrique de transport, l'artefact préconstruit est le cas du
     * redéploiement, et le fournisseur DNS est une interface dont Hostinger
     * n'est qu'une implémentation.
     */
    const moteur = fs.readFileSync(path.join(racine, 'DeploymentEngine.js'), 'utf8');
    check('la fabrique de transport est un paramètre du CONSTRUCTEUR',
      /this\.transportFactory = deps\.transportFactory/.test(moteur));
    check('l’artefact préconstruit est une option DOCUMENTÉE',
      /let artifact = options\.artifact/.test(moteur));
    check('le fournisseur DNS est une option du moteur',
      /options\.dnsProvider/.test(moteur));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     11. CE QUE LA RECETTE CONSTATE SANS LE CORRIGER.

     ══ POURQUOI CES CONTRÔLES EXISTENT ══════════════════════════════════════

     Deux comportements du moteur ont été audités et NON modifiés dans ce lot :
     les changer demanderait leur propre travail, et les changer en silence
     serait pire que les laisser. Les inscrire ici transforme un paragraphe de
     rapport — qu'on ne relit jamais — en fait vérifié à chaque exécution.

     Le jour où l'un d'eux évolue, ce contrôle rougira, et quelqu'un devra dire
     si c'était voulu.
     ══════════════════════════════════════════════════════════════════════════ */
  section('11 · Constats audités, délibérément non modifiés');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const ici = path.dirname(fileURLToPath(import.meta.url));

    /**
     * AUCUN ROLLBACK AUTOMATIQUE. Un déploiement qui échoue APRÈS la frontière
     * de publication laisse la nouvelle version en ligne : le retour arrière
     * est une décision d'opérateur (`engine.rollback()`), jamais un réflexe du
     * moteur. C'est défendable — revenir en arrière tout seul sur une santé
     * publique momentanément rouge ferait deux bascules au lieu d'une — mais
     * cela doit être SU.
     */
    const moteur = fs.readFileSync(path.join(ici, '..', 'deployment-engine', 'DeploymentEngine.js'), 'utf8');
    /**
     * Le SEUL appel à `rollbackToPrevious` vit dans la méthode `rollback()` —
     * l'opération explicite. Aucun chemin de `deployWithReport` ne l'emprunte :
     * c'est ce que compte ce contrôle.
     */
    const appelsRollback = (moteur.match(/rollbackToPrevious\(/g) || []).length;
    check('le moteur ne déclenche AUCUN rollback automatique',
      /rollbackPerformed: false/.test(moteur) && appelsRollback === 1);
    check('…le retour arrière reste une opération explicite', /async rollback\(\{/.test(moteur));

    /**
     * ══ LE CONSTAT P0 DE CE HARNAIS A ÉTÉ CORRIGÉ — ON LE VÉRIFIE ICI ════════
     *
     * Cette ligne affirmait : « la persistance des étapes est BEST-EFFORT
     * (constat) », et elle cherchait littéralement `void recordStep(runId`.
     * C'était le défaut que la recette de bout en bout avait mis au jour : le
     * déploiement pouvait franchir la publication alors que son journal durable
     * était tombé.
     *
     * Le lot DURABLE RECORDER l'a fermé. Le constat devient donc une GARANTIE,
     * et l'assertion s'inverse : plus aucune écriture d'étape n'est lancée sans
     * régime, et la barrière est branchée sur le port du moteur.
     */
    const controleur = fs.readFileSync(path.join(ici, '..', 'controllers', 'deployment.controller.js'), 'utf8');
    check('aucune écriture d’étape n’est plus lancée en fire-and-forget',
      !/void recordStep\(runId/.test(controleur));
    check('…les transitions passent par la file à deux régimes',
      /createStepJournal\(runId\)/.test(controleur) && /journalEtapes\.enqueue\(/.test(controleur));
    check('…et la barrière de publication est fournie au moteur',
      /assertDurable: \(\) => journalEtapes\.assertDurable\(\)/.test(controleur));
    check('…et le moteur, lui, ne connaît aucune base', !/mongoose/.test(moteur));

    /**
     * LE TRACEUR RESTE NON STRICT EN PRODUCTION. Une violation de protocole
     * est consignée dans le résultat, pas fatale. Le scénario nominal en
     * produit zéro — c'est ce qui rend ce choix tenable.
     */
    check('le traceur est NON strict en production (constat)', /strict: false/.test(moteur));
    check('…et le nominal n’en produit aucune', nominal.result.protocolViolations.length === 0);
    check('…mais le résultat les EXPOSE quand il y en a',
      Array.isArray(nominal.result.protocolViolations));
  }

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('DEPLOYMENT E2E TEST CRASHED:', err);
  fail++;
} finally {
  await harness.close();
  process.exit(fail === 0 ? 0 : 1);
}
