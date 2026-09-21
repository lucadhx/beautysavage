/**
 * LES ÉTAPES DE DÉPLOIEMENT — protocole, machine d'état, ordre observé.
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * `engine-governance` prouve, par lecture du code, qu'il n'existe plus qu'UNE
 * définition d'étape et que tout en dérive. C'est une garde STATIQUE : elle ne
 * peut rien dire de ce qui se passe pendant un vrai déploiement.
 *
 * Cette suite éprouve le RUNTIME, sur les invariants propres au déploiement —
 * qui ne sont pas ceux de la duplication :
 *
 *   · une étape hors registre fait échouer l'émission, sur-le-champ ;
 *   · `pending → ok` est refusé : une étape réussie sans avoir commencé est le
 *     mensonge que ce lot existe pour rendre impossible ;
 *   · `warning` est un état à part entière — une vérification DNS qui aboutit
 *     en signalant une propagation incomplète n'est ni un succès muet ni un
 *     échec ;
 *   · le MODE décide de ce qui est exigible : un préflight ne doit pas être
 *     accusé de n'avoir pas transféré le projet ;
 *   · l'ordre OBSERVÉ dans un vrai pipeline (transport simulé, exécution
 *     réelle) est comparé AU REGISTRE, jamais à un instantané écrit à la main ;
 *   · un échec AVANT la frontière de publication n'allume rien de ce qui suit ;
 *     un échec APRÈS ne réécrit pas l'histoire de ce qui précède.
 */
import crypto from 'node:crypto';

import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { runPipeline, PIPELINE_STEPS } from '../deployment-engine/pipeline.js';
import { parseTargetUrl } from '../deployment-engine/url.js';
import {
  CANONICAL_STEPS,
  RUN_MODES,
  STEP_STATUS,
  canonicalStep,
  isKnownStep,
  stepsForMode,
  toCanonical,
  isLastRawOfStep,
} from '../deployment-engine/steps.js';
import { createDeploymentStepTracker, StepProtocolError } from '../deployment-engine/stepTracker.js';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);
const leve = (fn) => { try { fn(); return null; } catch (e) { return e; } };

/* ── Décor : un VPS en bonne santé, identique à celui du moteur ──────────── */
const WILDCARD = ['demo.ly-solution.com'];
const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-TEST1234.js"></script></head><body></body></html>';
const APP_JS = 'console.log("app")';
const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const WEB_FP = { indexHash: sha256(INDEX_HTML), mainJs: { name: 'app-TEST1234.js', hash: sha256(APP_JS) } };
const MANIFEST = { commitHash: 'cafe0123456789abcdef', shortCommit: 'cafe012' };
const ARTIFACT = {
  dists: { vitrine: '/local/vitrine/dist', manager: '/local/manager/dist' },
  backendDir: '/local/backend',
  web: { vitrine: WEB_FP, manager: WEB_FP },
  manifest: MANIFEST,
};
const FULL_ENV = {
  ENV: 'PROD', MONGODB_URI: 'mongodb+srv://u:p@c.mongodb.net/x', DB_PROD: 'prod_x',
  JWT_SECRET: 'x'.repeat(40), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
};
const FAST_HEALTH = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };

function healthyVps({ casse = null } = {}) {
  const t = new FakeTransport()
    .on('id -un', { stdout: 'deploy' })
    .on('command -v nginx', { stdout: 'OK' })
    .on('command -v node', { stdout: 'OK' })
    .on('command -v pm2', { stdout: 'OK' })
    .on('command -v certbot', { stdout: 'OK' })
    .on('command -v mongod', { stdout: 'OK' })
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('test -w /var/www', { stdout: 'WRITABLE' })
    .on(/df -Pk/, { stdout: '2000000' })
    .on('fullchain.pem', { stdout: 'OK' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' })
    .on(/-m 10 'https:\/\/[^']+\/'/, { stdout: INDEX_HTML })
    .on(/\/assets\/app-TEST1234\.js'/, { stdout: APP_JS })
    .on(/\/version\.json'/, { stdout: JSON.stringify({ commitHash: MANIFEST.commitHash }) });
  for (const site of ['sbauto06.demo.ly-solution.com', 'demo.ly-solution.com']) {
    t.files.set(`/var/www/${site}/backend/build-manifest.json`, JSON.stringify({ commitHash: MANIFEST.commitHash }));
  }
  /**
   * L'INJECTION D'ÉCHEC PORTE SUR UNE COMMANDE RÉELLE.
   *
   * On ne simule pas « l'étape X échoue » : on casse ce qu'elle exécute
   * vraiment. C'est la seule façon de prouver que l'étape RÉELLEMENT en cours
   * au moment de la panne est celle que le rapport nommera.
   */
  if (casse) t.on(casse.pattern, casse.reponse);
  return t;
}

const cible = parseTargetUrl('https://sbauto06.demo.ly-solution.com', { wildcardBases: WILDCARD });

/** Rejoue un pipeline réel et rend les étapes CANONIQUES observées. */
async function pipelineObserve({ casse = null } = {}) {
  const brutes = [];
  const tx = healthyVps({ casse });
  const resultat = await runPipeline({
    transport: tx,
    target: cible,
    artifact: ARTIFACT,
    version: 'phase-test',
    onStep: (e) => brutes.push(e),
    options: { backendPort: 5001, env: 'PROD', remoteEnv: FULL_ENV, health: FAST_HEALTH },
  }).catch((err) => ({ ok: false, error: err }));

  /**
   * LE PIPELINE PARLE BRUT, LE REGISTRE PARLE CANONIQUE.
   *
   * On applique la table de traduction, puis on FILTRE les répétitions : deux
   * gestes bruts (`certbot` puis `reload`) composent une seule étape visible,
   * et le traceur refuserait — à juste titre — un second `running` sur elle.
   */
  const tracker = createDeploymentStepTracker({ mode: RUN_MODES.DEPLOYMENT, strict: false });
  const canoniques = [];
  for (const brute of brutes) {
    const id = toCanonical(brute.step);
    const statut = brute.status === 'error' ? STEP_STATUS.ERROR : brute.status;
    // Un seul DÉPART par étape visible, et une clôture au DERNIER geste — la
    // projection exacte que le moteur applique.
    if (statut === STEP_STATUS.RUNNING && tracker.state(id) !== STEP_STATUS.PENDING) continue;
    if (statut === STEP_STATUS.OK && !isLastRawOfStep(brute.step, PIPELINE_STEPS)) continue;
    if (!tracker.record(id, statut)) continue;
    canoniques.push({ id, status: statut, raw: brute.step });
  }
  return { brutes, canoniques, tracker, resultat };
}

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LE PROTOCOLE — une étape inconnue ne peut pas être émise.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Le registre est la seule porte d’entrée');
  {
    const t = createDeploymentStepTracker();
    const inconnue = leve(() => t.record('nginx.config', 'running'));
    check('une étape HORS REGISTRE fait échouer l’émission', inconnue !== null);
    check('…et le message nomme le fichier où la déclarer', /steps\.js/.test(inconnue.message));
    check('…un identifiant proche ne « passe » pas par ressemblance', t.state('nginx.configure') === 'pending');

    check('un statut hors vocabulaire est refusé', leve(() => t.record('ssh.connect', 'presque')) !== null);
    check('…« failed » n’appartient pas au vocabulaire', leve(() => t.record('ssh.connect', 'failed')) !== null);
    check('…« pass » non plus', leve(() => t.record('ssh.connect', 'pass')) !== null);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. LA MACHINE D'ÉTAT.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · Transitions : ce qui est interdit, et pourquoi');
  {
    const t = createDeploymentStepTracker();
    check('pending → ok est REFUSÉ (réussir sans avoir commencé)',
      leve(() => t.record('ssh.connect', 'ok')) instanceof StepProtocolError);

    t.record('ssh.connect', 'running');
    check('running deux fois est REFUSÉ',
      leve(() => t.record('ssh.connect', 'running')) instanceof StepProtocolError);
    t.record('ssh.connect', 'ok');
    check('ok → running est REFUSÉ', leve(() => t.record('ssh.connect', 'running')) instanceof StepProtocolError);

    t.record('nginx.configure', 'running');
    t.record('nginx.configure', 'error');
    check('error → ok est REFUSÉ (un échec ne s’efface pas)',
      leve(() => t.record('nginx.configure', 'ok')) instanceof StepProtocolError);
    check('…mais error → cancelled reste possible (interruption d’opérateur)',
      t.record('nginx.configure', 'cancelled') === true);

    /**
     * `warning` EST UN ÉTAT À PART ENTIÈRE.
     * Une résolution DNS qui aboutit en signalant une propagation incomplète
     * n'est ni un succès muet ni un échec : l'appeler `ok` masquerait un fait
     * que l'exploitant doit voir, `error` arrêterait un déploiement légitime.
     */
    const w = createDeploymentStepTracker();
    w.record('dns.verify', 'running');
    check('running → warning est ACCEPTÉ', w.record('dns.verify', 'warning') === true);
    check('…et warning est un état FINAL', w.state('dns.verify') === STEP_STATUS.WARNING);
    check('…il n’est pas confondu avec ok', w.state('dns.verify') !== STEP_STATUS.OK);

    /**
     * `pending → warning` est l'exception documentée : sans fournisseur DNS,
     * le moteur signale « gestion automatique non configurée » sur une étape
     * qu'il n'a jamais démarrée. Un `skipped` muet perdrait le message.
     */
    const d = createDeploymentStepTracker();
    check('pending → warning est ACCEPTÉ (domaine non géré)',
      d.record('dns.provider', 'warning') === true);
    check('pending → skipped aussi', d.record('dns.zone', 'skipped') === true);
    check('…et skipped n’est pas ok', d.state('dns.zone') !== STEP_STATUS.OK);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. LES MODES — un préflight n'est pas un déploiement inachevé.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Ce qui est exigible dépend du MODE');
  {
    const precheck = createDeploymentStepTracker({ mode: RUN_MODES.PRECHECK });
    const exigibles = precheck.missingRequired();
    check('le préflight n’exige pas la préparation de la version',
      !exigibles.includes('artifact.build'));
    check('…ni le transfert du projet', !exigibles.includes('artifact.upload'));
    check('…ni la publication des médias', !exigibles.includes('media.publish'));
    check('mais il exige la connexion au serveur', exigibles.includes('ssh.connect'));
    check('…et sa propre finalisation', exigibles.includes('deployment.finalize'));

    /**
     * LE LIBELLÉ DU PRÉFLIGHT VIENT DU REGISTRE, PAS D'UN SECOND ÉCRAN.
     * « Préparation du déploiement » serait mensonger en préflight : rien n'est
     * déployé. L'écran tenait donc SA propre version du libellé ; elle est
     * désormais déclarée.
     */
    check('le préflight porte le libellé DÉCLARÉ pour son mode',
      precheck.label('deployment.initialize') === 'Validation de la destination');
    const deploiement = createDeploymentStepTracker({ mode: RUN_MODES.DEPLOYMENT });
    check('…et le déploiement, le sien',
      deploiement.label('deployment.initialize') === 'Préparation du déploiement');
    check('une étape sans libellé alternatif est identique dans les deux modes',
      precheck.label('ssh.connect') === deploiement.label('ssh.connect'));

    check('la checklist du préflight est un SOUS-ENSEMBLE',
      precheck.checklist().length < deploiement.checklist().length);
    check('…dans l’ordre canonique',
      precheck.checklist().every((s, i, a) => i === 0 || s.order > a[i - 1].order));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. L'ÉTAPE OUBLIÉE — impossible de conclure sans elle.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · Une étape obligatoire oubliée est une anomalie MOTEUR');
  {
    const t = createDeploymentStepTracker();
    const requises = stepsForMode(RUN_MODES.DEPLOYMENT).filter((s) => s.required).length;
    check('au départ, toutes les étapes requises manquent', t.missingRequired().length === requises);

    t.record('ssh.connect', 'running');
    check('une étape EN COURS compte comme manquante', t.missingRequired().includes('ssh.connect'));
    t.record('ssh.connect', 'ok');
    check('…et cesse de manquer une fois aboutie', !t.missingRequired().includes('ssh.connect'));

    t.record('dns.verify', 'running');
    t.record('dns.verify', 'warning');
    check('un warning CLÔT l’étape', !t.missingRequired().includes('dns.verify'));

    t.record('nginx.configure', 'running');
    t.record('nginx.configure', 'error');
    check('une étape en ERREUR manque toujours', t.missingRequired().includes('nginx.configure'));

    /**
     * LES ÉTAPES CONDITIONNELLES NE SONT JAMAIS EXIGÉES.
     * Sans fournisseur DNS, `dns.zone` n'a pas lieu. Les déclarer requises
     * ferait échouer tout déploiement sur un domaine géré à la main — la
     * majorité des premiers déploiements.
     */
    check('les étapes conditionnelles ne sont pas exigées',
      !t.missingRequired().some((id) => ['dns.zone', 'dns.provider', 'dns.read', 'dns.site', 'dns.apps'].includes(id)));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. UN PIPELINE RÉEL — l'ordre observé, comparé au REGISTRE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · Ordre réellement observé sur un pipeline complet');
  const nominal = await pipelineObserve();
  check('le pipeline aboutit', nominal.resultat.ok === true);

  console.log('\n  ── TRACE OBSERVÉE (pipeline distant) ──');
  nominal.canoniques.forEach((e, i) => console.log(
    `  ${String(i + 1).padStart(2, '0')} ${e.status.toUpperCase().padEnd(8)} ${e.id.padEnd(22)} ← ${e.raw}`
  ));
  console.log('');

  check('toute étape observée appartient au REGISTRE',
    nominal.canoniques.every((e) => isKnownStep(e.id)));
  const premiere = [];
  for (const e of nominal.canoniques) if (!premiere.includes(e.id)) premiere.push(e.id);
  const ordres = premiere.map((id) => canonicalStep(id).order);
  check('les étapes apparaissent dans l’ORDRE CANONIQUE',
    ordres.every((o, i) => i === 0 || o >= ordres[i - 1]));
  check('aucune violation de protocole', nominal.tracker.violations().length === 0);
  if (nominal.tracker.violations().length) nominal.tracker.violations().forEach((v) => console.error('    → ' + v));
  check('aucune étape ne reste ouverte', nominal.tracker.open().length === 0);

  /**
   * DEUX GESTES BRUTS, UNE SEULE ÉTAPE VISIBLE.
   * `certbot` (émission) et `reload` (bascule de configuration) composent
   * « Activation HTTPS ». C'est le cas qui justifie la table de traduction —
   * et qui interdisait de faire du raw id l'identifiant public.
   */
  const brutesHttps = nominal.brutes.filter((b) => toCanonical(b.step) === 'https.configure');
  check('plusieurs gestes bruts composent une seule étape visible',
    new Set(brutesHttps.map((b) => b.step)).size > 1);
  check('…et l’étape visible n’apparaît qu’une fois dans la trace',
    premiere.filter((id) => id === 'https.configure').length === 1);

  /* ══════════════════════════════════════════════════════════════════════════
     6. ÉCHEC DANS LE PIPELINE DISTANT — QUI EST TOUT ENTIER APRÈS LA FRONTIÈRE.

     ══ CE QUE CETTE SECTION AFFIRMAIT, ET POURQUOI C'ÉTAIT FAUX ══════════════

     Elle vérifiait qu'un échec sur `nginx -t` « n'atteignait jamais la
     frontière de publication ». Cela tenait à un placement erroné de cette
     frontière — sur l'activation HTTPS — qui ne décrivait que la toute
     PREMIÈRE mise en ligne d'un site. Sur un redéploiement, la bascule de
     release a déjà changé ce que voit le public avant même que Nginx ne soit
     relu.

     La frontière est désormais posée sur `artifact.upload`, c'est-à-dire sur
     le PREMIER geste de ce pipeline. La conclusion s'inverse donc, et c'est la
     bonne : tout échec ici survient APRÈS publication. Ce qu'on vérifie n'est
     plus « rien n'a été publié » — ce serait un mensonge — mais que le rapport
     ne PRÉTEND pas le contraire, et que rien ne s'allume en aval de l'échec.

     La preuve du refus AVANT publication n'a pas disparu : elle a changé de
     niveau. Elle se joue au-dessus du pipeline, dans `deployment-durable-
     recorder.test.js`, là où les étapes antérieures à la bascule existent.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · Un échec dans le pipeline distant survient APRÈS la publication');
  {
    const frontiere = CANONICAL_STEPS.find((s) => s.publicationBoundary);
    const ko = await pipelineObserve({ casse: { pattern: 'nginx -t', reponse: { code: 1, stderr: 'invalid config' } } });
    check('le pipeline ÉCHOUE', ko.resultat.ok !== true);

    const enErreur = ko.canoniques.filter((e) => e.status === 'error');
    check('…sur la configuration du routage web',
      enErreur.some((e) => e.id === 'nginx.configure'));

    const apres = ko.canoniques.slice(ko.canoniques.findIndex((e) => e.status === 'error') + 1);
    check('…aucune étape n’est déclarée réussie APRÈS l’échec',
      !apres.some((e) => e.status === 'ok'));
    check('…la frontière de publication, elle, A BIEN été franchie',
      ko.canoniques.some((e) => e.id === frontiere.id));
    check('…et elle l’a été AVANT l’échec, pas après',
      ko.canoniques.findIndex((e) => e.id === frontiere.id)
        < ko.canoniques.findIndex((e) => e.status === 'error'));
    check('…les services ne sont pas démarrés',
      !ko.canoniques.some((e) => e.id === 'services.start'));
    check('…et la vérification publique n’a pas lieu',
      !ko.canoniques.some((e) => e.id === 'public.healthcheck'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. ÉCHEC APRÈS LA FRONTIÈRE — on ne réécrit pas l'histoire.
     ══════════════════════════════════════════════════════════════════════════ */
  section('7 · Un échec après publication ne réécrit pas ce qui précède');
  {
    const ko = await pipelineObserve({
      casse: { pattern: /https:\/\/.*\/health/, reponse: { stdout: '000' } },
    });
    check('le pipeline ÉCHOUE', ko.resultat.ok !== true);
    check('…et l’échec porte sur la vérification publique finale',
      ko.canoniques.some((e) => e.id === 'public.healthcheck' && e.status === 'error'));

    /**
     * CE QUI PRÉCÈDE RESTE VRAI, ET C'EST LE POINT.
     * La nouvelle version EST publiée : remettre l'activation sur « en
     * attente » ferait disparaître du rapport le fait qu'une version non
     * vérifiée est en ligne — c'est-à-dire exactement ce qu'il faut savoir
     * pour décider d'un retour arrière.
     */
    const frontiere = ko.canoniques.filter((e) => e.id === 'https.configure');
    check('l’activation HTTPS reste OK', frontiere.some((e) => e.status === 'ok'));
    check('…et n’est pas repassée en attente',
      ko.tracker.state('https.configure') === STEP_STATUS.OK);
    check('les services démarrés restent démarrés',
      ko.tracker.state('services.start') === STEP_STATUS.OK);
  }

  /* ── Autres injections : transfert, installation, services ──────────────── */
  section('8 · Chaque panne nomme SON étape');
  for (const cas of [
    /**
     * ══ CHOISIR UN POINT DE PANNE QUE L'ÉTAPE VÉRIFIE VRAIMENT ═════════════
     *
     * Une première version cassait `npm ci --omit=dev` en attendant une erreur
     * sur l'installation. Le pipeline a continué : cette étape n'inspecte pas
     * le code de retour de l'installation distante. Le contrôle « prouvait »
     * alors une attribution d'échec qui n'existe pas — et masquait la vraie
     * découverte, consignée au rapport comme risque résiduel.
     *
     * On casse donc `nginx -t`, que l'étape de routage VÉRIFIE explicitement.
     */
    { nom: 'routage web', pattern: 'nginx -t', attendue: 'nginx.configure' },
    { nom: 'services (PM2)', pattern: /pm2 (start|restart|reload)/, attendue: 'services.start' },
    { nom: 'santé locale', pattern: /127\.0\.0\.1.*health/, attendue: 'services.verify', reponse: { stdout: '500' } },
  ]) {
    const ko = await pipelineObserve({
      casse: { pattern: cas.pattern, reponse: cas.reponse || { code: 1, stderr: `${cas.nom} KO` } },
    });
    const erreur = ko.canoniques.find((e) => e.status === 'error');
    if (erreur?.id !== cas.attendue) {
      console.error(`      → brutes : ${ko.brutes.map((b) => b.step + ':' + b.status).join(' | ')}`);
      console.error(`      → canoniques : ${ko.canoniques.map((b) => b.id + ':' + b.status).join(' | ')}`);
    }
    check(`panne « ${cas.nom} » → ${cas.attendue} en ERREUR`, erreur?.id === cas.attendue);
    const apres = ko.canoniques.slice(ko.canoniques.indexOf(erreur) + 1);
    check(`…et rien de réussi après`, !apres.some((e) => e.status === 'ok'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8 bis. LA MATRICE D'ÉCHEC — une commande critique fait tomber SA phase.

     ══ CE QUE CETTE SECTION AJOUTE AU LOT PRÉCÉDENT ═════════════════════════

     Les injections ci-dessus cassaient des commandes dont le pipeline LISAIT
     déjà le résultat. Celles-ci cassent les commandes qu'il ne lisait PAS :
     `npm ci`, la bascule de release, la préparation des dossiers, le
     rechargement Nginx. Avant ce lot, chacune produisait une étape verte.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8 bis · Les commandes autrefois non vérifiées font échouer leur phase');
  for (const cas of [
    {
      nom: 'npm ci', pattern: /npm ci --omit=dev/, attendue: 'dependencies.install',
      commandId: 'dependencies.npm_ci',
    },
    {
      nom: 'préparation des dossiers', pattern: /mkdir -p .*certbot/, attendue: 'artifact.upload',
      commandId: 'release.prepare_dirs',
    },
    {
      nom: 'bascule de release', pattern: /mv .*\.next /, attendue: 'artifact.upload',
      commandId: 'release.swap',
    },
    {
      nom: 'rechargement Nginx', pattern: /systemctl reload nginx/, attendue: 'nginx.configure',
      commandId: 'nginx.reload',
    },
  ]) {
    const ko = await pipelineObserve({
      casse: { pattern: cas.pattern, reponse: { code: 1, stderr: `${cas.nom} KO` } },
    });
    const erreur = ko.canoniques.find((e) => e.status === 'error');
    check(`« ${cas.nom} » en échec → ${cas.attendue} en ERREUR`, erreur?.id === cas.attendue);
    check(`…et le pipeline s'arrête`, ko.resultat.ok !== true);
    const apres = ko.canoniques.slice(ko.canoniques.indexOf(erreur) + 1);
    check(`…aucune phase réussie après`, erreur !== undefined && !apres.some((e) => e.status === 'ok'));
    check(`…l'erreur nomme la commande, pas la ligne shell`,
      ko.resultat.error?.details?.commandId === cas.commandId
      || ko.resultat.error?.code === 'REMOTE_COMMAND_FAILED');
  }

  /* ── CONNEXION PERDUE ET DÉLAI DÉPASSÉ ─────────────────────────────────── */
  section('8 ter · Une coupure n’est jamais un succès');
  {
    /**
     * LE CAS QUI ÉTAIT LE PLUS GRAVE.
     * Le transport rendait `code ?? 0` : un flux fermé sans code — connexion
     * coupée, process tué — était rapporté comme réussite. Une panne réseau au
     * milieu d'une installation produisait un déploiement vert.
     */
    const coupure = await pipelineObserve({
      casse: { pattern: /npm ci --omit=dev/, reponse: { code: null } },
    });
    const erreur = coupure.canoniques.find((e) => e.status === 'error');
    check('connexion perdue pendant npm ci → dependencies.install en ERREUR',
      erreur?.id === 'dependencies.install');
    check('…jamais un succès', coupure.resultat.ok !== true);
    check('…et l’erreur est typée connexion perdue',
      coupure.resultat.error?.code === 'REMOTE_COMMAND_CONNECTION_LOST');

    const tue = await pipelineObserve({
      casse: { pattern: /npm ci --omit=dev/, reponse: { code: null, signal: 'SIGKILL' } },
    });
    check('process tué par signal → ERREUR typée',
      tue.resultat.error?.code === 'REMOTE_COMMAND_SIGNALLED');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. AUCUN SECRET DANS LA PROJECTION NI DANS LA TRACE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('9 · Ni secret, ni chemin, ni commande dans ce qui est publié');
  {
    const { describeDeploymentSteps } = await import('../deployment-engine/steps.js');
    const projection = JSON.stringify(describeDeploymentSteps());
    check('la projection publique ne contient aucun secret',
      !/mongodb\+srv|JWT_SECRET|ENCRYPTION_KEY|BEGIN [A-Z ]*PRIVATE KEY/.test(projection));
    check('…aucun chemin serveur', !/\/var\/www|\/etc\/nginx|\/home\//.test(projection));
    check('…aucune commande', !/certbot|pm2 |sudo /.test(projection));

    const trace = JSON.stringify(nominal.canoniques);
    check('la trace canonique ne porte aucun secret',
      !/mongodb\+srv|JWT_SECRET|ENCRYPTION_KEY/.test(trace));
  }

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('DEPLOYMENT PHASES TEST CRASHED:', err);
  fail++;
}
process.exit(fail === 0 ? 0 : 1);
