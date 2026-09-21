/* Tests du moteur de déploiement (UI-agnostic) via FakeTransport — aucun VPS.
 * Style aligné sur promote.test.js : runner autonome, sans framework. */
import crypto from 'node:crypto';
import { parseTargetUrl, DEFAULT_WILDCARD_BASES } from '../deployment-engine/url.js';
import { BACKUP_ROOT } from '../deployment-engine/config/project.profile.js';
import * as vault from '../deployment-engine/passwordVault.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { SshTransport } from '../deployment-engine/transport/SshTransport.js';
import { runPreflight } from '../deployment-engine/preflight.js';
import { renderNginxConfig, renderNginxHttpOnly, certPaths, applyNginxConfig, applyNginxHttpOnly, nginxEnabledPath } from '../deployment-engine/nginx.js';
import { runPipeline, PIPELINE_STEPS } from '../deployment-engine/pipeline.js';
import { collectBackendDiagnostics } from '../deployment-engine/health.js';
import { createBackup } from '../deployment-engine/backup.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { PreflightError, ValidationError } from '../deployment-engine/errors.js';
import { createTargetSchema, restoreSchema } from '../validators/deployment.validator.js';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
async function threws(fn, Type) {
  try {
    await fn();
    return false;
  } catch (e) {
    return Type ? e instanceof Type : true;
  }
}

const WILDCARD = ['demo.ly-solution.com'];

/** FakeTransport programmé pour un VPS « en bonne santé ». */
function healthyVps({ certPresent = true, artifactEnv = 'PROD' } = {}) {
  const t = new FakeTransport()
    .on('id -un', { stdout: 'deploy' })
    .on('command -v nginx', { stdout: 'OK' })
    .on('command -v node', { stdout: 'OK' })
    .on('command -v pm2', { stdout: 'OK' })
    .on('command -v certbot', { stdout: 'OK' })
    .on('command -v mongod', { stdout: 'OK' })
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('test -w /var/www', { stdout: 'WRITABLE' })
    .on(/df -Pk/, { stdout: '2000000' }) // 2 Go libres
    .on('fullchain.pem', { stdout: certPresent ? 'OK' : 'NO' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/.*\/health/, { stdout: `{"success":true,"data":{"env":"${artifactEnv}"}}\n200` })
    // Contrôle d'artefact web (validate) : le VPS « sert » exactement le build.
    .on(/-m 10 'https:\/\/[^']+\/'/, { stdout: INDEX_HTML })
    .on(/\/assets\/app-TEST1234\.js'/, { stdout: APP_JS })
    .on(/\/version\.json'/, { stdout: JSON.stringify({ commitHash: MANIFEST.commitHash }) });
  // Le manifeste RELU à l'étape dirs : uploadDir simulé ne peuple pas le FS
  // virtuel, on préseed donc build-manifest.json pour les cibles des tests.
  for (const site of ['sbauto06.demo.ly-solution.com', 'demo.ly-solution.com']) {
    t.files.set(`/var/www/${site}/backend/build-manifest.json`, JSON.stringify({ commitHash: MANIFEST.commitHash }));
  }
  return t;
}

// Artefact factice AVEC empreinte web + manifeste : depuis le durcissement
// fail-closed, un déploiement PROD sans empreinte est REFUSÉ (validate).
const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-TEST1234.js"></script></head><body></body></html>';
const APP_JS = 'console.log("app")';
const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const WEB_FP = { indexHash: sha256(INDEX_HTML), mainJs: { name: 'app-TEST1234.js', hash: sha256(APP_JS) } };
const MANIFEST = { commitHash: 'cafe0123456789abcdef', shortCommit: 'cafe012' };
// Artefact au format PROFIL : `dists` et `web` sont indexés par identifiant
// d'application déclaré au profil (ici `vitrine` et `manager`).
const ARTIFACT = {
  dists: { vitrine: '/local/vitrine/dist', manager: '/local/manager/dist' },
  backendDir: '/local/backend',
  web: { vitrine: WEB_FP, manager: WEB_FP }, manifest: MANIFEST,
};

try {
  /* ---------------------- 1. Analyse d'URL ---------------------- */
  const sub = parseTargetUrl('https://sbauto06.demo.ly-solution.com', { wildcardBases: WILDCARD });
  check('URL sous-domaine : type=subdomain', sub.type === 'subdomain');
  check('URL sous-domaine : sous-domaine extrait', sub.subdomain === 'sbauto06');
  check('URL sous-domaine : base wildcard', sub.wildcardBase === 'demo.ly-solution.com');
  check('URL sous-domaine : pas de cert dédié', sub.requiresDedicatedCert === false);
  check('URL sous-domaine : pas de contrôle DNS', sub.requiresDnsCheck === false);

  const dom = parseTargetUrl('https://sbauto06.fr', { wildcardBases: WILDCARD });
  check('URL domaine client : type=domain', dom.type === 'domain');
  check('URL domaine client : cert dédié requis', dom.requiresDedicatedCert === true);
  check('URL domaine client : contrôle DNS requis', dom.requiresDnsCheck === true);
  check('URL domaine client : domaine enregistrable', dom.registrableDomain === 'sbauto06.fr');

  // Architecture officielle : un unique wildcard *.ly-solution.com configuré une
  // fois. demo-sbauto.ly-solution.com est un sous-domaine DIRECT couvert par ce
  // wildcard -> AUCUN enregistrement DNS ni certificat à créer par site.
  const OFFICIAL = ['ly-solution.com'];
  check('défaut wildcard officiel = ly-solution.com', DEFAULT_WILDCARD_BASES.length === 1 && DEFAULT_WILDCARD_BASES[0] === 'ly-solution.com');
  const demo = parseTargetUrl('https://demo-sbauto.ly-solution.com', { wildcardBases: OFFICIAL });
  check('demo-sbauto : hostname extrait', demo.host === 'demo-sbauto.ly-solution.com');
  check('demo-sbauto : sous-domaine wildcard (pas domaine client)', demo.type === 'subdomain' && demo.wildcardBase === 'ly-solution.com');
  check('demo-sbauto : sous-domaine = demo-sbauto', demo.subdomain === 'demo-sbauto');
  // Un certificat PAR HÔTE, y compris l'hôte principal : le régime « wildcard
  // réutilisé » rendait un domaine vierge indéployable — le préflight exigeait
  // un fichier que seul un déploiement antérieur aurait pu créer.
  check('demo-sbauto : certificat dédié à l’hôte',
    certPaths(demo).shared === false && certPaths(demo).certName === 'demo-sbauto.ly-solution.com');
  check('demo-sbauto : AUCUN contrôle DNS par site', demo.requiresDnsCheck === false);
  const demoCfg = renderNginxConfig(demo, { webRoot: '/w', managerRoot: '/m', backendPort: 5005 });
  check('demo-sbauto : nginx server_name exact', demoCfg.includes('server_name demo-sbauto.ly-solution.com;'));
  check('demo-sbauto : nginx pointe le certificat de l’hôte',
    demoCfg.includes('/etc/letsencrypt/live/demo-sbauto.ly-solution.com/fullchain.pem')
    && !demoCfg.includes('/etc/letsencrypt/live/ly-solution.com/fullchain.pem'));
  // *.ly-solution.com ne couvre qu'UN niveau : un multi-label retombe en domaine client.
  const deep = parseTargetUrl('https://a.b.ly-solution.com', { wildcardBases: OFFICIAL });
  check('multi-label hors wildcard -> domaine client (cert dédié + DNS)', deep.type === 'domain' && deep.requiresDedicatedCert === true && deep.requiresDnsCheck === true);

  check('URL sans protocole -> https forcé', parseTargetUrl('sbauto06.fr').canonicalUrl === 'https://sbauto06.fr');
  check('URL avec port refusée', await threws(() => parseTargetUrl('https://sbauto06.fr:8080'), ValidationError));
  check('URL vide refusée', await threws(() => parseTargetUrl(''), ValidationError));
  check('hôte à un seul label refusé', await threws(() => parseTargetUrl('https://localhost'), ValidationError));

  /* ---------------------- 2. Coffre-fort VPS (RAM) ---------------------- */
  vault.closeAll();
  const s1 = vault.openSession({ host: '1.2.3.4', username: 'root', password: 's3cret' });
  check('session ouverte -> sessionId opaque', typeof s1.sessionId === 'string' && s1.sessionId.length > 10);
  check('getSession renvoie le secret en interne', vault.getSession(s1.sessionId).password === 's3cret');
  const desc = vault.describeSession(s1.sessionId);
  check('describeSession ne divulgue jamais le mot de passe', desc && !('password' in desc) && desc.host === '1.2.3.4');

  /**
   * ── UNE SEULE NATURE DE SESSION ──────────────────────────────────────────
   *
   * Il en existait deux, choisies par une case a cocher : « conservee » (8 h)
   * ou « ephemere » (15 min). L'operateur arbitrait donc la duree de vie d'un
   * secret en RAM — une question a laquelle il n'a aucun moyen de repondre —
   * et la mauvaise reponse se payait par une session disparue au milieu d'un
   * retrait, sous le message « Session VPS absente ou expiree ».
   */
  check('aucune notion de session « conservee » ne subsiste',
    !('keep' in s1) && !('keep' in vault.getSession(s1.sessionId)) && !('keep' in desc));
  check('le coffre n expose plus closeIfEphemeral',
    typeof vault.closeIfEphemeral === 'undefined');

  /**
   * ── L'ECHEANCE EST REPOUSSEE A CHAQUE USAGE ──────────────────────────────
   * Une operation active enchaine plusieurs appels (inspection, puis retrait).
   * Si l'echeance ne bougeait pas, elle pourrait tomber entre deux d'entre eux.
   */
  const avantUsage = vault.describeSession(s1.sessionId).expiresAt;
  await new Promise((r) => setTimeout(r, 12));
  vault.getSession(s1.sessionId);
  check('chaque utilisation repousse l echeance',
    vault.describeSession(s1.sessionId).expiresAt > avantUsage);

  check('closeAfterOperation detruit la session',
    vault.closeAfterOperation(s1.sessionId) === true && !vault.hasSession(s1.sessionId));

  vault.closeAll();
  check('closeAll détruit toutes les sessions', vault.activeSessionCount() === 0);
  check('openSession refuse sans mot de passe', await threws(() => vault.openSession({ host: 'h', username: 'u' })));

  /* ---------------------- 2bis. SshTransport (auth mot de passe, échecs) ---------------------- */
  const sshTx = new SshTransport({ host: '203.0.113.10', username: 'root', password: 's3cret' });
  check('SshTransport : instanciable (kind=ssh)', sshTx.kind === 'ssh');
  check('SshTransport : exige un mot de passe', await threws(() => new SshTransport({ host: 'h', username: 'root' })));
  check('SshTransport : exige un hôte', await threws(() => new SshTransport({ username: 'root', password: 'p' })));
  // Connexion vers un port fermé -> le exec REJETTE proprement, sans crasher le
  // process Node (une mauvaise IP/mot de passe ne doit jamais tuer le serveur).
  const deadTx = new SshTransport({ host: '127.0.0.1', username: 'root', password: 'x', port: 1, readyTimeout: 2000 });
  let sshRejected = false;
  try {
    await deadTx.exec('id');
  } catch {
    sshRejected = true;
  }
  await deadTx.close();
  check('SshTransport : échec de connexion -> rejet lisible (pas de crash)', sshRejected === true);
  check('SshTransport : le process survit à l’échec', true); // atteint = process vivant

  /* ---------------------- 3. Préflight ---------------------- */
  const pfOk = await runPreflight({
    transport: healthyVps(),
    url: 'https://sbauto06.demo.ly-solution.com',
    sshHost: '1.2.3.4',
    wildcardBases: WILDCARD,
  });
  check('préflight VPS sain : ok', pfOk.ok === true && pfOk.failedChecks.length === 0);
  check('préflight : contrôle SSH présent', pfOk.checks.some((c) => c.id === 'ssh' && c.ok));
  check('préflight sous-domaine : DNS non bloquant', pfOk.checks.find((c) => c.id === 'dns')?.required === false);

  const noSshTx = new FakeTransport({ defaultResponse: { code: 1, stdout: '', stderr: 'refused' } });
  const pfNoSsh = await runPreflight({ transport: noSshTx, url: 'https://x.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : SSH KO -> échec immédiat', pfNoSsh.ok === false && pfNoSsh.checks.length === 1);

  const noNginxTx = healthyVps().on('command -v nginx', { stdout: 'NO' });
  const pfNoNginx = await runPreflight({ transport: noNginxTx, url: 'https://x.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : Nginx absent -> bloquant', pfNoNginx.ok === false && pfNoNginx.failedChecks.some((c) => c.id === 'nginx'));

  // Adresse déjà occupée par un AUTRE site (conf Nginx étrangère, sans marqueur).
  const occupiedTx = healthyVps().on(/cat \/etc\/nginx\/sites-available/, {
    stdout: 'server {\n  server_name autre-site.fr;\n  listen 443 ssl;\n}',
  });
  const pfOccupied = await runPreflight({ transport: occupiedTx, url: 'https://sbauto06.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : adresse occupée par un autre site -> bloquant', pfOccupied.ok === false && pfOccupied.failedChecks.some((c) => c.id === 'occupied'));
  // Redéploiement de NOTRE site (conf avec marqueur) -> autorisé.
  const oursTx = healthyVps().on(/cat \/etc\/nginx\/sites-available/, {
    stdout: '# Généré par DeploymentEngine\nserver { server_name sbauto06.demo.ly-solution.com; listen 443 ssl; }',
  });
  const pfOurs = await runPreflight({ transport: oursTx, url: 'https://sbauto06.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : redéploiement de notre site -> autorisé', pfOurs.ok === true);

  // nginx -t cassé UNIQUEMENT par la conf de CETTE cible (déploiement précédent
  // interrompu) -> NON bloquant (le déploiement la régénère). Conf TIERCE -> bloquant.
  const staleOwnTx = healthyVps().on('nginx -t', { code: 1, stdout: '', stderr: 'nginx: [emerg] unknown directive "http2" in /etc/nginx/sites-enabled/sbauto06.demo.ly-solution.com.conf:15\nnginx: configuration file /etc/nginx/nginx.conf test failed' });
  const pfStale = await runPreflight({ transport: staleOwnTx, url: 'https://sbauto06.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : conf INVALIDE de notre propre site -> NON bloquant (régénérée)', pfStale.ok === true && !pfStale.failedChecks.some((c) => c.id === 'nginx-config'));
  const foreignBrokenTx = healthyVps().on('nginx -t', { code: 1, stdout: '', stderr: 'nginx: [emerg] invalid parameter in /etc/nginx/sites-enabled/autre-site.fr.conf:10\nnginx: configuration file /etc/nginx/nginx.conf test failed' });
  const pfForeign = await runPreflight({ transport: foreignBrokenTx, url: 'https://sbauto06.demo.ly-solution.com', sshHost: '1.2.3.4', wildcardBases: WILDCARD });
  check('préflight : conf tierce cassée -> BLOQUANT (on ne déploie pas sur un Nginx cassé)', pfForeign.ok === false && pfForeign.failedChecks.some((c) => c.id === 'nginx-config'));

  /* ---------------------- 4. Génération Nginx ---------------------- */
  const cfg = renderNginxConfig(sub, { webRoot: '/var/www/x/vitrine', managerRoot: '/var/www/x/manager', backendPort: 5001 });
  check('nginx : server_name = hôte', cfg.includes('server_name sbauto06.demo.ly-solution.com;'));
  check('nginx : certificat de l’hôte, jamais celui de la base',
    cfg.includes('/etc/letsencrypt/live/sbauto06.demo.ly-solution.com/fullchain.pem')
    && !cfg.includes('/etc/letsencrypt/live/demo.ly-solution.com/fullchain.pem'));
  check('nginx : proxy vers le port backend', cfg.includes('proxy_pass http://127.0.0.1:5001;'));
  const cfgDom = renderNginxConfig(dom, { webRoot: '/w', managerRoot: '/m', backendPort: 5002 });
  check('nginx : domaine client -> cert dédié', cfgDom.includes('/etc/letsencrypt/live/sbauto06.fr/fullchain.pem'));

  /* HTTP/2 : syntaxe compatible nginx < 1.25.1 (Ubuntu 20.04/22.04 → 1.18).
   * La directive autonome « http2 on; » fait échouer nginx -t sur ces serveurs
   * ([emerg] unknown directive "http2"). On l'active SUR la ligne listen. */
  check('nginx : http2 sur la directive listen (compat. nginx ancien)', (cfg.match(/listen 443 ssl http2;/g) || []).length === 3 && (cfg.match(/listen \[::\]:443 ssl http2;/g) || []).length === 3);
  // Aucune LIGNE de directive active « http2 on; » (les commentaires # sont ignorés par Nginx).
  check('nginx : PAS de directive autonome « http2 on; » active (incompat. < 1.25.1)', !/(^|\n)\s*http2 on;/.test(cfg));
  check('nginx : http2 activé sur les TROIS blocs 443 (vitrine + Manager + API)', (cfg.split('listen 443 ssl http2;').length - 1) === 3);
  check('nginx : bloc API dédié (proxy pur vers le backend)', cfg.includes('server_name api.sbauto06.demo.ly-solution.com;') && cfg.includes('/etc/letsencrypt/live/api.sbauto06.demo.ly-solution.com/fullchain.pem'));

  /* Config HTTP-only (PHASE 1, avant certbot) : ne référence AUCUN certificat —
   * sinon nginx -t échoue au 1er déploiement (certs pas encore émis). */
  const http = renderNginxHttpOnly(sub, { webRoot: '/w', managerRoot: '/m', backendPort: 5001, managerHost: 'manager.sbauto06.demo.ly-solution.com' });
  check('nginx http-only : AUCUNE référence ssl_certificate (certs pas encore émis)', !http.includes('ssl_certificate'));
  check('nginx http-only : pas de bloc 443/HTTPS', !http.includes('listen 443'));
  check('nginx http-only : sert le challenge ACME (HTTP-01)', http.includes('/.well-known/acme-challenge/') && http.includes('root /var/www/certbot'));
  check('nginx http-only : marqueur DeploymentEngine (redéploiement reconnu)', http.includes('Généré par DeploymentEngine'));
  check('nginx http-only : trois blocs :80 (vitrine + Manager + API)', (http.split('listen 80;').length - 1) === 3);
  check('nginx http-only : bloc API sert l\'ACME + proxifie', http.includes('server_name api.sbauto06.demo.ly-solution.com;'));

  /* Atomicité applyNginxConfig : conf invalide → symlink désactivé, pas de reload. */
  {
    const badTx = healthyVps().on('nginx -t', { stdout: '', stderr: '[emerg] unknown directive "http2" ... test failed' });
    let e = null;
    try {
      await applyNginxConfig(badTx, sub, { webRoot: '/w', managerRoot: '/m', backendPort: 5001, managerHost: 'manager.sbauto06.demo.ly-solution.com' });
    } catch (err) { e = err; }
    check('nginx : conf invalide -> NGINX_CONFIG_INVALID', e?.code === 'NGINX_CONFIG_INVALID');
    check('nginx : symlink sites-enabled RETIRÉ après échec (atomicité)', badTx.ran(`sudo rm -f ${nginxEnabledPath(sub.host)}`));
    check('nginx : PAS de reload après une conf invalide', !badTx.ran(/reload nginx|nginx -s reload/));
  }
  {
    const goodTx = healthyVps();
    const r = await applyNginxConfig(goodTx, sub, { webRoot: '/w', managerRoot: '/m', backendPort: 5001, managerHost: 'manager.sbauto06.demo.ly-solution.com' });
    check('nginx : conf valide -> reload effectué', r.reloaded === true && goodTx.ran(/reload nginx|nginx -s reload/));
    check('nginx : conf valide -> PAS de retrait du symlink', !goodTx.ran(/sudo rm -f .*sites-enabled/));
  }

  /* ---------------------- 5. Pipeline complet (happy path) ---------------------- */
  // .env distant COMPLET (le backend sort au démarrage s'il manque MONGODB_URI…).
  const FULL_ENV = {
    ENV: 'PROD', MONGODB_URI: 'mongodb+srv://u:p@c.mongodb.net/x', DB_PROD: 'prod_x',
    JWT_SECRET: 'x'.repeat(40), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
  };
  const FAST_HEALTH = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };
  const tx = healthyVps();
  const steps = [];
  const result = await runPipeline({
    transport: tx,
    target: sub,
    artifact: ARTIFACT,
    version: 'abc123',
    onStep: (e) => steps.push(e),
    options: { backendPort: 5001, env: 'PROD', remoteEnv: FULL_ENV, health: FAST_HEALTH },
  });
  check('pipeline : ok', result.ok === true && result.failedStep === null);
  check('pipeline : toutes les étapes réussies', result.steps.length === PIPELINE_STEPS.length && result.steps.every((s) => s.status === 'ok'));
  check('pipeline : ordre nginx avant certbot', tx.indexOf('sudo nginx -t') < tx.indexOf('fullchain.pem'));
  // Deux phases Nginx : HTTP-only AVANT certbot, HTTPS complète APRÈS (chicken-egg
  // des certificats résolu). Deux `nginx -t` encadrant l'émission du certificat.
  {
    const nginxTestIdxs = tx.commands.map((c, i) => (/nginx -t/.test(c.command) ? i : -1)).filter((i) => i >= 0);
    const idxCert = tx.commands.findIndex((c) => /fullchain\.pem|certonly/.test(c.command));
    check('pipeline : deux phases Nginx (HTTP puis HTTPS)', nginxTestIdxs.length === 2);
    check('pipeline : phase HTTP avant certbot, phase HTTPS après', nginxTestIdxs[0] < idxCert && nginxTestIdxs[1] > idxCert);
  }
  check('pipeline : certbot avant pm2', tx.indexOf('fullchain.pem') < tx.indexOf('pm2 start'));
  check('pipeline : pm2 (re)démarré', tx.ran('pm2 start') && tx.ran('pm2 save'));
  check('pipeline : health local + public', tx.ran(/127\.0\.0\.1.*health/) && tx.ran(/https:\/\/.*\/health/));
  check('pipeline : .env applicatif écrit (sans secret VPS)', tx.files.has('/var/www/sbauto06.demo.ly-solution.com/backend/.env'));
  check('pipeline : artefacts uploadés (vitrine+manager+backend)', tx.uploads.length === 3);
  // Publication ATOMIQUE des statiques : upload vers `.next`, bascule par mv,
  // ancienne version purgée (conservée en `.prev`). Plus d'assets périmés accumulés.
  {
    const SITE = '/var/www/sbauto06.demo.ly-solution.com';
    check('pipeline : vitrine uploadée vers .next (jamais en place)', tx.uploads.some((u) => u.remotePath === `${SITE}/vitrine.next`));
    check('pipeline : manager uploadé vers .next (jamais en place)', tx.uploads.some((u) => u.remotePath === `${SITE}/manager.next`));
    check('pipeline : bascule atomique vitrine (.next -> vitrine)', tx.ran(`mv ${SITE}/vitrine.next ${SITE}/vitrine`));
    check('pipeline : bascule atomique manager (.next -> manager)', tx.ran(`mv ${SITE}/manager.next ${SITE}/manager`));
    check('pipeline : purge des anciennes versions (.prev)', tx.ran(`rm -rf ${SITE}/vitrine.prev ${SITE}/manager.prev`));
  }
  // Contrôle d'artefact servi : la version.json publiée est comparée au manifeste.
  check('pipeline : version.json servie comparée au manifeste', tx.ran(/\/version\.json'/));
  check('pipeline : évènements onStep émis', steps.some((e) => e.step === 'validate' && e.status === 'ok'));

  /* ---------------------- 6. Pipeline en échec (health local KO) ---------------------- */
  const txBad = healthyVps()
    .on(/127\.0\.0\.1.*health/, { stdout: '000' })
    .on(/pm2 logs/, { stdout: 'MongoServerSelectionError: connection timed out — check Atlas Network Access' });
  const bad = await runPipeline({
    transport: txBad,
    target: sub,
    artifact: ARTIFACT,
    version: 'def456',
    options: { backendPort: 5001, remoteEnv: FULL_ENV, health: FAST_HEALTH },
  });
  check('pipeline échec : ok=false', bad.ok === false);
  check('pipeline échec : étape fautive = health', bad.failedStep === 'health');
  check('pipeline échec : validate jamais atteinte', !bad.steps.some((s) => s.step === 'validate'));
  // Observabilité : sur health KO, on capture le POURQUOI (statut PM2 + logs).
  check('pipeline échec health : diagnostic backend capturé (pm2 jlist + logs)', txBad.ran(/pm2 jlist/) && txBad.ran(/pm2 logs/));

  /* .env distant incomplet -> échec EXPLICITE à « dirs » (pas un health mystérieux). */
  {
    const txIncomplete = healthyVps();
    const inc = await runPipeline({
      transport: txIncomplete, target: sub, artifact: ARTIFACT, version: 'i',
      options: { backendPort: 5001, remoteEnv: { ENV: 'PROD', DB_PROD: 'x' }, health: FAST_HEALTH }, // pas de MONGODB_URI
    });
    const dirsStep = inc.steps.find((s) => s.step === 'dirs');
    check('.env incomplet : échec à dirs (relecture) AVANT le démarrage du service', inc.ok === false && inc.failedStep === 'dirs' && dirsStep?.error?.code === 'ENV_WRITE_INCOMPLETE');
    check('.env incomplet : le service n\'est jamais démarré', !txIncomplete.ran(/pm2 (start|reload)/));
  }

  /* collectBackendDiagnostics : parse le statut PM2 + rapporte la queue de logs. */
  {
    const diagTx = new FakeTransport()
      // Le process EXISTE et pointe sur le dossier déployé : l'étape PM2 doit
      // passer pour que l'échec attendu soit bien celui du health check.
      .on('pm2 jlist', {
        stdout: JSON.stringify([{
          name: 'sbauto-x',
          pm2_env: {
            status: 'errored',
            restart_time: 7,
            pm_exec_path: '/var/www/x.fr/backend/src/server.js',
            pm_cwd: '/var/www/x.fr/backend',
          },
        }]),
      })
      .on(/pm2 logs/, { stdout: 'Error: Missing MONGODB_URI\nprocess exited 1' });
    const diag = await collectBackendDiagnostics(diagTx, { name: 'sbauto-x' });
    check('diagnostics : statut + restarts PM2 extraits', diag.status === 'errored' && diag.restarts === 7);
    check('diagnostics : queue de logs (cause réelle) rapportée', /Missing MONGODB_URI/.test(diag.logTail));
  }

  /* Rapport de bout en bout : un backend qui ne répond pas expose SA cause. */
  {
    const rptTx = healthyVps()
      .on(/127\.0\.0\.1.*health/, { stdout: '000' })
      .on(/pm2 logs/, { stdout: 'MongoServerSelectionError: connect ETIMEDOUT 203.0.113.10:27017 — Atlas Network Access?' });
    const rpt = await new DeploymentEngine({ wildcardBases: ['ly-solution.com'] }).deployWithReport({
      url: 'https://demo.ly-solution.com', // sous-domaine 1 niveau -> DNS non bloquant (warning)
      transport: rptTx,
      options: {
        backendPort: 5001, skipBuild: true, artifact: ARTIFACT, dnsExpectedIp: '203.0.113.10', version: 't',
        remoteEnv: FULL_ENV,
        health: { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 },
        dnsResolutionOpts: { timeoutMs: 400, minIntervalMs: 1, maxIntervalMs: 1 },
      },
    });
    check('rapport health KO : échec à services.verify', rpt.ok === false && rpt.finalStepId === 'services.verify');
    check('rapport health KO : logs backend (cause réelle) présents dans le rapport', rpt.markdownReport.includes('MongoServerSelectionError'));
    check('rapport health KO : diagnostic oriente vers Atlas/Mongo', /atlas/i.test(rpt.markdownReport));
  }

  /* ------------- 7. Domaine VIERGE : aucun certificat sur le VPS ------------- */
  // C'est le cas nominal d'un premier déploiement, plus une erreur : le
  // certificat est ÉMIS pendant le déploiement, il n'est pas un prérequis.
  const txNoCert = healthyVps({ certPresent: false });
  const noCert = await runPipeline({
    transport: txNoCert,
    target: sub,
    artifact: ARTIFACT,
    version: 'g',
    options: { backendPort: 5001, remoteEnv: FULL_ENV, health: FAST_HEALTH },
  });
  check('pipeline : domaine vierge -> le déploiement aboutit', noCert.ok === true);
  check('…et certbot a émis, sans échouer', noCert.failedStep !== 'certbot');

  /* ---------------------- 8. Backup ---------------------- */
  const txBackup = new FakeTransport();
  const backup = await createBackup({
    transport: txBackup,
    host: 'sbauto06.demo.ly-solution.com',
    dbName: 'prod_x',
    mongoUri: 'mongodb://127.0.0.1:27017',
    version: 'abc123',
    stamp: '20260721-120000',
  });
  check('backup : archive .tar.gz nommée par hôte+stamp', backup.archive.endsWith('sbauto06.demo.ly-solution.com-20260721-120000.tar.gz'));
  check('backup : mongodump exécuté', txBackup.ran('mongodump'));
  check('backup : tar créé', txBackup.ran('tar -czf'));
  check('backup : manifest écrit', [...txBackup.files.keys()].some((k) => k.endsWith('manifest.json')));

  /* ---------------------- 9. Façade DeploymentEngine ---------------------- */
  const engine = new DeploymentEngine({ wildcardBases: WILDCARD, mongoUri: 'mongodb://127.0.0.1:27017' });

  // Déploiement via transport injecté + artefact fourni (skipBuild), skipPreflight.
  const injected = healthyVps();
  const dep = await engine.deploy({
    url: 'https://sbauto06.demo.ly-solution.com',
    transport: injected,
    skipPreflight: true,
    options: {
      backendPort: 5001,
      skipBuild: true,
      artifact: ARTIFACT,
      version: 'abc123',
      remoteEnv: FULL_ENV,
      health: FAST_HEALTH,
    },
  });
  check('façade deploy : ok avec transport injecté', dep.ok === true && dep.version === 'abc123');

  // Préflight en échec -> PreflightError (déploiement refusé, pas de demi-déploiement).
  const injectedNoNginx = healthyVps().on('command -v nginx', { stdout: 'NO' });
  check(
    'façade deploy : préflight KO -> PreflightError',
    await threws(
      () =>
        engine.deploy({
          url: 'https://sbauto06.demo.ly-solution.com',
          transport: injectedNoNginx,
          options: { backendPort: 5001, skipBuild: true, artifact: ARTIFACT, version: 'x' },
        }),
      PreflightError
    )
  );

  // Sans session ni transport -> refus explicite.
  check(
    'façade : ni session ni transport -> refus',
    await threws(() => engine.deploy({ url: 'https://sbauto06.demo.ly-solution.com', options: { skipBuild: true, artifact: ARTIFACT } }))
  );

  /* ---------------------- 10. Sécurité : validation anti-injection ---------------------- */
  const okTarget = createTargetSchema.body.safeParse({ name: 'Démo', url: 'https://demo-sbauto.ly-solution.com', environment: 'TEST', dbName: 'sbauto_demo', sshHost: '203.0.113.10', sshUser: 'root' });
  check('validator : cible légitime acceptée', okTarget.success === true);

  /**
   * L'ENVIRONNEMENT EST EXIGÉ, et n'a PAS de valeur par défaut.
   *
   * Il était un champ du formulaire de déploiement, avec PROD présélectionné :
   * la même destination pouvait être déployée en TEST puis en PROD, et un clic
   * de trop publiait en production. Un défaut ici reproduirait ce défaut.
   */
  const sansEnv = createTargetSchema.body.safeParse({ name: 'Démo', url: 'https://demo-sbauto.ly-solution.com', sshHost: '203.0.113.10' });
  check('validator : une cible SANS environnement est refusée', sansEnv.success === false);
  check('validator : dbName avec métacaractère shell refusé', createTargetSchema.body.safeParse({ name: 'X', url: 'https://a.fr', dbName: "x'; rm -rf / #" }).success === false);
  check('validator : remoteRoot injection refusé', createTargetSchema.body.safeParse({ name: 'X', url: 'https://a.fr', remoteRoot: '/var/www; rm -rf /' }).success === false);
  check('validator : sshHost injection refusé', createTargetSchema.body.safeParse({ name: 'X', url: 'https://a.fr', sshHost: '1.2.3.4 && curl evil' }).success === false);
  check('validator : sshUser injection refusé', createTargetSchema.body.safeParse({ name: 'X', url: 'https://a.fr', sshUser: 'root; id' }).success === false);
  /**
   * L'ARCHIVE LÉGITIME EST CELLE DE *CE* PROJET.
   *
   * Le chemin était écrit en dur (`/var/backups/sbauto/…`). Le contrôle, lui,
   * s'ancre sur `BACKUP_ROOT`, dérivée du slug : sur toute copie, ce contrôle
   * n'éprouvait donc plus rien — il n'affirmait que « la racine du projet
   * d'origine est refusée ici », ce qui est vrai et sans intérêt.
   */
  check('validator : archive légitime acceptée', restoreSchema.body.safeParse({ targetId: 't', sessionId: 's', archive: `${BACKUP_ROOT}/demo.ly-solution.com-20260721-120000.tar.gz` }).success === true);
  check('validator : archive hors dossier/injection refusée', restoreSchema.body.safeParse({ targetId: 't', sessionId: 's', archive: '/etc/passwd; rm -rf /' }).success === false);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('DEPLOYMENT ENGINE TEST CRASHED:', err);
  fail++;
} finally {
  vault.closeAll();
  process.exit(fail === 0 ? 0 : 1);
}
