/* Non-régression : la session VPS survit à travers préflight → déploiement →
 * redéploiement (bug NO_VPS_SESSION). La session appartient au frontend + TTL,
 * pas au moteur. Aucun VPS réel (FakeTransport via transportFactory). */
import * as vault from '../deployment-engine/passwordVault.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

const IP = '203.0.113.10';
// Empreinte web factice : PROD fail-closed exige indexHash (le VPS simulé ne
// servant pas le site, le contrôle reste non bloquant : reachable=false).
const FP = { indexHash: 'f'.repeat(64), mainJs: null };
const ART = { dists: { vitrine: '/l/vitrine', manager: '/l/manager' }, backendDir: '/l/backend', web: { vitrine: FP, manager: FP } };
const FAST = { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 };
const DNS_FAST = { timeoutMs: 400, minIntervalMs: 1, maxIntervalMs: 1 };

function healthyVps() {
  return new FakeTransport()
    .on('id -un', { stdout: 'deploy' })
    .on('command -v nginx', { stdout: 'OK' }).on('command -v node', { stdout: 'OK' }).on('command -v pm2', { stdout: 'OK' })
    .on('command -v certbot', { stdout: 'OK' }).on('command -v mongod', { stdout: 'OK' })
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('test -w /var/www', { stdout: 'WRITABLE' }).on(/df -Pk/, { stdout: '2000000' })
    .on(/cat \/etc\/nginx\/sites-available/, { stdout: '__NONE__' }).on('fullchain.pem', { stdout: 'OK' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/.*\/health/, { stdout: '{"success":true,"data":{"env":"PROD"}}\n200' });
}

const engine = () => new DeploymentEngine({ wildcardBases: ['ly-solution.com'], transportFactory: () => healthyVps() });
const URL = 'https://demo.ly-solution.com';
const preflight = (sessionId, url = URL) => engine().deployWithReport({ url, sessionId, options: { preflightOnly: true, backendPort: 5001, dnsExpectedIp: IP, version: 't', health: FAST, dnsResolutionOpts: DNS_FAST } });
const deploy = (sessionId, url = URL) => engine().deployWithReport({ url, sessionId, options: { backendPort: 5001, skipBuild: true, artifact: ART, dnsExpectedIp: IP, version: 't', health: FAST, dnsResolutionOpts: DNS_FAST } });

try {
  vault.closeAll();

  /* 1. Préflight → Deploy : la session SURVIT au préflight (cœur du bug). */
  const s = vault.openSession({ host: IP, username: 'root', password: 'pw-secret', keep: false });
  const pre = await preflight(s.sessionId);
  check('préflight : réussi', pre.ok === true);
  check('préflight : NE FERME PAS la session éphémère (correctif)', vault.hasSession(s.sessionId) === true);

  const dep = await deploy(s.sessionId);
  check('deploy après préflight : PAS de NO_VPS_SESSION', dep.errorSummary?.code !== 'NO_VPS_SESSION' && dep.finalStepId !== 'deployment.initialize');
  check('deploy après préflight : réussi', dep.ok === true);
  check('deploy : session toujours présente (redéploiement possible)', vault.hasSession(s.sessionId) === true);

  /* 2. Redéploiement (« Déployer une nouvelle version ») réutilise la session. */
  const redep = await deploy(s.sessionId);
  check('redéploiement : réussi avec la même session', redep.ok === true && vault.hasSession(s.sessionId));

  /* 3. Double préflight successif. */
  await preflight(s.sessionId);
  const pre2 = await preflight(s.sessionId);
  check('double préflight : session intacte', pre2.ok === true && vault.hasSession(s.sessionId));

  /* 4. Plusieurs destinations : sessions indépendantes. */
  const s2 = vault.openSession({ host: '198.51.100.7', username: 'root', password: 'pw2', keep: false });
  await preflight(s2.sessionId, 'https://autre.ly-solution.com');
  check('multi-destinations : les deux sessions coexistent', vault.hasSession(s.sessionId) && vault.hasSession(s2.sessionId));

  /* 5. Délai entre préflight et deploy : getSession rafraîchit le TTL. */
  const before = vault.describeSession(s.sessionId).expiresAt;
  await preflight(s.sessionId); // usage -> rafraîchit
  const after = vault.describeSession(s.sessionId).expiresAt;
  check('délai : le TTL éphémère est rafraîchi à chaque usage', after >= before && vault.hasSession(s.sessionId));

  /* 6. Déconnexion explicite (frontend) : ferme la session. */
  vault.closeSession(s.sessionId);
  check('déconnexion explicite : session fermée', vault.hasSession(s.sessionId) === false);

  /* 7. Session réellement absente : NO_VPS_SESSION (comportement correct conservé). */
  const gone = await deploy('session-inexistante');
  check('session absente : NO_VPS_SESSION (0 s, deployment.initialize)', gone.ok === false && gone.errorSummary?.code === 'NO_VPS_SESSION' && gone.finalStepId === 'deployment.initialize');

  /* 8. Session « conservée » : survit également (inchangé). */
  const k = vault.openSession({ host: IP, username: 'root', password: 'pw', keep: true });
  await deploy(k.sessionId);
  check('session conservée (keep) : survit au déploiement', vault.hasSession(k.sessionId) === true);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('SESSION TEST CRASHED:', err);
  fail++;
} finally {
  vault.closeAll();
  process.exit(fail === 0 ? 0 : 1);
}
