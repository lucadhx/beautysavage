/* Tests de la checklist live + rapport technique (RunRecorder, événements,
 * redaction, persistance logique). Sans VPS (FakeTransport), sans framework. */
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { createRedactor } from '../deployment-engine/report/sanitize.js';
import { renderMarkdown } from '../deployment-engine/report/markdown.js';
import { CANONICAL_ORDER } from '../deployment-engine/steps.js';
import { derivePrimarySubHost } from '../deployment-engine/hostnames.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

const WILDCARD = ['ly-solution.com'];
// Empreinte web factice : PROD fail-closed exige indexHash (le VPS simulé ne
// servant pas le site, le contrôle reste non bloquant : reachable=false).
const FP = { indexHash: 'f'.repeat(64), mainJs: null };
const ARTIFACT = { dists: { vitrine: '/local/vitrine/dist', manager: '/local/manager/dist' }, backendDir: '/local/backend', web: { vitrine: FP, manager: FP } };
const FAST_HEALTH = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };

function healthyVps(extra = {}) {
  const tx = new FakeTransport()
    .on('id -un', { stdout: 'deploy' })
    .on('command -v nginx', { stdout: 'OK' })
    .on('command -v node', { stdout: 'OK' })
    .on('command -v pm2', { stdout: 'OK' })
    .on('command -v certbot', { stdout: 'OK' })
    .on('command -v mongod', { stdout: 'OK' })
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('test -w /var/www', { stdout: 'WRITABLE' })
    .on(/df -Pk/, { stdout: '2000000' })
    .on(/cat \/etc\/nginx\/sites-available/, { stdout: '__NONE__' })
    .on('fullchain.pem', { stdout: 'OK' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' });
  for (const [m, r] of Object.entries(extra)) tx.on(m, r);
  return tx;
}

async function deploy(tx, url = 'https://demo-sbauto.ly-solution.com', opts = {}) {
  const engine = new DeploymentEngine({ wildcardBases: WILDCARD });
  const events = [];
  const result = await engine.deployWithReport({
    url,
    transport: tx,
    onEvent: (e) => events.push(e),
    options: { backendPort: 5001, skipBuild: true, artifact: ARTIFACT, version: 'abc123', sshHost: '203.0.113.10', sshUser: 'root', health: FAST_HEALTH, ...opts },
  });
  return { result, events };
}

try {
  /* ---------------------- 1. Redaction (sanitize) ---------------------- */
  const r = createRedactor(['Sup3rSecretVpsPwd']);
  check('redaction JWT', r.redactString('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcDEF123-_').includes('[REDACTED_TOKEN]'));
  check('redaction bearer', r.redactString('Authorization: Bearer abcdef123456789').includes('[REDACTED_TOKEN]'));
  check('redaction mongodb creds', !r.redactString('mongodb://user:p4ss@host:27017/db').includes('p4ss'));
  check('redaction stripe', r.redactString('key sk_live_ABCDEF123456').includes('[REDACTED_SECRET]'));
  check('redaction env assignment', r.redactString('JWT_SECRET=abcdef123 INTEGRATED_API_ENCRYPTION_KEY=deadbeef').match(/\[REDACTED_SECRET\]/g)?.length === 2);
  check('redaction mot de passe exact', !r.redactString('cmd --pw Sup3rSecretVpsPwd end').includes('Sup3rSecretVpsPwd'));
  check('redaction clé objet', r.redactValue({ password: 'x', name: 'ok' }).password === '[REDACTED_SECRET]' && r.redactValue({ password: 'x', name: 'ok' }).name === 'ok');
  check('redaction commande option --password', r.redactCommand('mysql --password=hunter2 db').includes('[REDACTED_SECRET]'));
  check('troncature marque', r.truncate('x'.repeat(5000), 1000).includes('caractères tronqués'));
  check('PEM masquée', r.redactString('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----').includes('[REDACTED_PRIVATE_KEY]'));

  /* ---------------------- 2. Déploiement réussi + rapport ---------------------- */
  const { result: okRes, events: okEvents } = await deploy(healthyVps());
  check('succès : status ok', okRes.ok === true && okRes.status === 'ok');
  check('succès : étape finale = finalize', okRes.finalStepId === 'deployment.finalize');
  check('succès : hostname Manager dérivé', okRes.managerHost === 'manager.demo-sbauto.ly-solution.com');
  check('succès : rapport structuré présent', !!okRes.structuredReport && okRes.structuredReport.reportVersion === '1.0');
  check('succès : markdown présent', typeof okRes.markdownReport === 'string' && okRes.markdownReport.startsWith('# Rapport de déploiement'));

  // Événements
  check('événements : deployment.started en premier', okEvents[0].type === 'deployment.started');
  check('événements : deployment.succeeded présent', okEvents.some((e) => e.type === 'deployment.succeeded'));
  check('événements : sequenceNumber strictement croissant', okEvents.every((e, i) => i === 0 || e.sequenceNumber > okEvents[i - 1].sequenceNumber));
  check('événements : step.started puis step.succeeded pour nginx', (() => {
    const st = okEvents.findIndex((e) => e.type === 'step.started' && e.stepId === 'nginx.configure');
    const su = okEvents.findIndex((e) => e.type === 'step.succeeded' && e.stepId === 'nginx.configure');
    return st >= 0 && su > st;
  })());
  check('événements : timestamps ISO', okEvents.every((e) => typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp))));

  // Steps canoniques
  const stepIds = okRes.steps.map((s) => s.id);
  check('checklist : étapes canoniques ordonnées', stepIds.includes('ssh.connect') && stepIds.includes('artifact.upload') && stepIds.includes('public.healthcheck'));
  check('checklist : toutes réussies', okRes.steps.every((s) => ['ok', 'skipped', 'warning'].includes(s.status)));
  check('checklist : ordre respecté', stepIds.every((id, i) => i === 0 || CANONICAL_ORDER.indexOf(id) >= CANONICAL_ORDER.indexOf(stepIds[i - 1])));

  // Rapport : vitrine + Manager traités ensemble
  const md = okRes.markdownReport;
  check('rapport : vitrine ET Manager dans le markdown', md.includes('demo-sbauto.ly-solution.com') && md.includes('manager.demo-sbauto.ly-solution.com'));
  check('rapport : contient prompt d’audit', md.includes("## Demande d'audit"));
  check('rapport : section pipeline avec commandes', md.includes('## Pipeline') && md.includes('commande (exit'));
  check('rapport structuré : identification Manager', okRes.structuredReport.identification.managerUrl === 'https://manager.demo-sbauto.ly-solution.com');
  check('rapport structuré : nginx server_name vitrine + Manager', JSON.stringify(okRes.structuredReport.nginx).includes('demo-sbauto'));

  /* ---------------------- 3. Redaction dans un vrai rapport ---------------------- */
  const LEAK_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWFrIn0.ABCdef123456ghiJKL';
  const leakyTx = healthyVps({
    'npm ci': { stdout: `installing... token=${LEAK_JWT} mongodb://u:leakpass@h/db sk_live_LEAK12345` },
  });
  const { result: leakRes } = await deploy(leakyTx);
  check('rapport : aucun secret (JWT/mongo/stripe) dans le markdown', !/leakpass|sk_live_LEAK12345/.test(leakRes.markdownReport) && !leakRes.markdownReport.includes(LEAK_JWT));
  check('rapport : secrets remplacés par des marqueurs', /\[REDACTED_(TOKEN|SECRET|PASSWORD|CREDENTIALS)\]/.test(JSON.stringify(leakRes.structuredReport)));

  /* ---------------------- 4. Troncature stdout ---------------------- */
  const bigTx = healthyVps({ 'npm ci': { stdout: 'A'.repeat(20000) } });
  const { result: bigRes } = await deploy(bigTx);
  const bigExec = bigRes.structuredReport.steps.flatMap((s) => s.execs).find((e) => e.command.includes('npm ci'));
  check('troncature : stdout borné + marqué', bigExec && bigExec.stdout.length < 6000 && bigExec.stdout.includes('caractères tronqués'));

  /* ---------------------- 5. Échec (health public) + rapport ---------------------- */
  const failTx = healthyVps({ [String(/https:\/\/.*\/health/)]: null }); // placeholder
  const failTx2 = healthyVps().on(/https:\/\/.*\/health/, { stdout: '\n000' });
  const { result: failRes, events: failEvents } = await deploy(failTx2);
  check('échec : status error', failRes.ok === false && failRes.status === 'error');
  check('échec : étape fautive = public.healthcheck', failRes.finalStepId === 'public.healthcheck');
  check('échec : rapport toujours produit', typeof failRes.markdownReport === 'string' && failRes.markdownReport.length > 100);
  check('échec : diagnostic présent', !!failRes.structuredReport.diagnosis && !!failRes.structuredReport.diagnosis.code);
  check('échec : deployment.failed émis', failEvents.some((e) => e.type === 'deployment.failed'));
  check('échec : errorSummary renseigné', !!failRes.errorSummary && !!failRes.errorSummary.code);
  void failTx;

  /* ---------------------- 6. Échec préflight (pas de build/pipeline) ---------------------- */
  const noNginx = healthyVps().on('command -v nginx', { stdout: 'NO' });
  const { result: pfRes } = await deploy(noNginx);
  check('préflight KO : status error', pfRes.ok === false);
  check('préflight KO : étape serveur', pfRes.finalStepId === 'server.preflight');
  check('préflight KO : rapport produit', pfRes.markdownReport.includes('Rapport de déploiement'));
  check('préflight KO : pas d’étape upload atteinte', !pfRes.steps.some((s) => s.id === 'artifact.upload' && s.status === 'ok'));

  /* ---------------------- 7. Exception transport -> rapport partiel ---------------------- */
  const throwTx = healthyVps();
  throwTx.on('mkdir -p', { throw: new Error('connexion perdue') }); // upload lance mkdir -p
  const { result: exRes } = await deploy(throwTx);
  check('exception : status error (rapport partiel)', exRes.ok === false && typeof exRes.markdownReport === 'string');
  check('exception : jamais laissé en running', exRes.status === 'error');

  /* ---------------------- 8. Préflight = run de première classe (PRECHECK) ---------------------- */
  const { result: pkOk } = await deploy(healthyVps(), 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight OK : status ok', pkOk.ok === true);
  check('préflight OK : operationType PRECHECK', pkOk.structuredReport.identification.operationType === 'PRECHECK');
  check('préflight OK : rapport généré (markdown)', typeof pkOk.markdownReport === 'string' && pkOk.markdownReport.includes('Vérification préalable'));
  check('préflight OK : PAS d’étape upload (s’arrête avant)', !pkOk.steps.some((s) => s.id === 'artifact.upload'));
  check('préflight OK : étapes de vérification présentes', pkOk.steps.some((s) => s.id === 'ssh.connect') && pkOk.steps.some((s) => s.id === 'server.preflight'));

  const sshKoTx = new FakeTransport({ defaultResponse: { code: 1, stdout: '', stderr: 'Permission denied (publickey,password)' } });
  const { result: pkSsh } = await deploy(sshKoTx, 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight SSH KO : status error', pkSsh.ok === false);
  check('préflight SSH KO : étape fautive ssh.connect', pkSsh.finalStepId === 'ssh.connect');
  check('préflight SSH KO : rapport généré + diagnostic', typeof pkSsh.markdownReport === 'string' && !!pkSsh.structuredReport.diagnosis?.code && !!pkSsh.errorSummary);
  // Le rapport doit expliquer POURQUOI SSH échoue (pas juste « ERREUR »).
  check('préflight SSH KO : erreur exacte dans le rapport (pas « ERREUR » seul)', pkSsh.markdownReport.includes('Permission denied'));
  check('préflight SSH KO : diagnostic spécifique SSH (port 22 / mot de passe)', (pkSsh.structuredReport.diagnosis.thingsToCheck || []).some((s) => /port 22|mot de passe|PasswordAuthentication/.test(s)));
  check('préflight SSH KO : commande sonde présente (id -un)', pkSsh.markdownReport.includes('id -un'));

  // Erreur de connexion (le transport lève, comme ssh2 ECONNREFUSED) : message exact remonté.
  const refusedTx = healthyVps().on('id -un', { throw: Object.assign(new Error('connect ECONNREFUSED 195.35.0.211:22'), { code: 'ECONNREFUSED' }) });
  const { result: pkRefused } = await deploy(refusedTx, 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight ECONNREFUSED : cause + message dans le rapport', pkRefused.markdownReport.includes('ECONNREFUSED') && /refus/i.test(pkRefused.markdownReport));
  check('préflight ECONNREFUSED : commande fautive + code dans le diagnostic', pkRefused.structuredReport.diagnosis.failingCommand?.includes('id -un'));
  check('préflight ECONNREFUSED : conseil port 22/pare-feu (pas auth)', (pkRefused.structuredReport.diagnosis.thingsToCheck || []).some((s) => /port SSH|pare-feu/.test(s)) && !(pkRefused.structuredReport.diagnosis.thingsToCheck || []).some((s) => /PermitRootLogin/.test(s)));

  // Authentification refusée (cas réel « All configured authentication methods failed ») :
  // conseil CIBLÉ (mot de passe / PermitRootLogin), pas port/pare-feu.
  const authTx = healthyVps().on('id -un', { throw: new Error('All configured authentication methods failed') });
  const { result: pkAuth } = await deploy(authTx, 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight AUTH KO : cause « authentification refusée »', /authentification refus/i.test(pkAuth.markdownReport));
  check('préflight AUTH KO : conseil PermitRootLogin/mot de passe', (pkAuth.structuredReport.diagnosis.thingsToCheck || []).some((s) => /PermitRootLogin|mot de passe root/.test(s)));

  const timeoutTx = healthyVps().on('id -un', { throw: new Error('Timeout de commande distante (20000 ms).') });
  const { result: pkTo } = await deploy(timeoutTx, 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight timeout : rapport généré, jamais running', pkTo.ok === false && pkTo.status === 'error' && typeof pkTo.markdownReport === 'string');

  const { result: pkDns } = await deploy(healthyVps(), 'https://nonexistent-xyz-deploy-check-123.fr', { preflightOnly: true });
  check('préflight DNS KO : status error + rapport', pkDns.ok === false && pkDns.markdownReport.includes('Rapport de déploiement'));

  const pkLeakTx = new FakeTransport({ defaultResponse: { code: 1, stdout: 'oops mongodb://u:pkleak@h/db', stderr: '' } });
  const { result: pkLeak } = await deploy(pkLeakTx, 'https://demo-sbauto.ly-solution.com', { preflightOnly: true });
  check('préflight : aucun secret dans le rapport', !pkLeak.markdownReport.includes('pkleak') && !JSON.stringify(pkLeak.structuredReport).includes('pkleak'));

  /* ---------------------- 9. Dérivation Manager ---------------------- */
  check('front sur sous-domaine : dérivation depuis le profil', derivePrimarySubHost('demo-sbauto.ly-solution.com') === 'manager.demo-sbauto.ly-solution.com');
  check('markdown : rendu autonome depuis structuré', renderMarkdown(okRes.structuredReport).includes('## Résumé'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('REPORT TEST CRASHED:', err);
  fail++;
} finally {
  process.exit(fail === 0 ? 0 : 1);
}
