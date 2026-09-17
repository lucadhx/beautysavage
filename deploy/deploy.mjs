#!/usr/bin/env node
// Façade BeautySavage : elle ne déploie rien par elle-même ; elle remet la
// destination et la session SSH au moteur embarqué du projet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DeploymentEngine } from '../backend/src/deployment-engine/DeploymentEngine.js';
import { buildRemoteEnv, describeRemoteEnv, parseEnv } from '../backend/src/deployment-engine/deployEnv.js';
import { openSession, closeSession } from '../backend/src/deployment-engine/passwordVault.js';
import { syncBeautyRuntimeConfiguration } from '../backend/deployment-runtime-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const has = (flag) => process.argv.includes(flag);
const value = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const configPath = value('--config') || path.join(root, 'deploy', 'deploy.config.json');

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const key of ['url', 'host', 'environment', 'sshHost', 'sshUser', 'backendPort']) {
    if (!config[key]) throw new Error(`Configuration de déploiement incomplète : ${key}.`);
  }
  return config;
}

async function main() {
  const target = loadConfig();
  const password = process.env.VPS_PASS;
  if (!password) throw new Error('VPS_PASS est requis dans l’environnement du processus.');
  const sourceEnv = parseEnv(fs.readFileSync(path.join(root, 'backend', '.env'), 'utf8'));
  sourceEnv.DB_TEST ??= sourceEnv.MONGODB_DB_NAME;
  sourceEnv.DB_PROD ??= sourceEnv.MONGODB_DB_NAME;
  const built = buildRemoteEnv(target, { env: target.environment, source: sourceEnv });
  // BeautySavage isole sa base par MONGODB_DB_NAME. DB_TEST/DB_PROD sont
  // conservées ici pour le contrat du moteur et sa synchronisation post-release.
  built.remoteEnv.DB_TEST ??= built.remoteEnv.MONGODB_DB_NAME;
  built.remoteEnv.DB_PROD ??= built.remoteEnv.MONGODB_DB_NAME;
  built.remoteEnv.STATIC_FRONTENDS_DEPLOYED = 'true';
  built.remoteEnv.REACT_OFFICIAL_FRONTEND = 'true';

  console.log(`\n── BeautySavage · ${target.environment} · ${target.host} ──`);
  console.log(`  moteur : deployment-engine embarqué`);
  console.log(`  ssh    : ${target.sshUser}@${target.sshHost}:${target.sshPort || 22}`);
  console.log(`  env    : ${describeRemoteEnv(built).keys.length} variables prêtes (secrets masqués)`);

  const engine = new DeploymentEngine();
  const { sessionId } = openSession({ host: target.sshHost, username: target.sshUser, password });
  try {
    if (has('--preflight')) {
      const result = await engine.preflight({ url: target.url, sessionId, remoteRoot: target.remoteRoot });
      console.log(result.ok ? '✓ Préflight terminé.' : '✗ Préflight en échec.');
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    if (!has('--execute')) {
      console.log('Simulation validée. Ajoutez --execute pour lancer le pipeline réel.');
      return;
    }
    const result = await engine.deploy({
      url: target.url,
      sessionId,
      options: {
        remoteRoot: target.remoteRoot,
        backendPort: target.backendPort,
        env: target.environment,
        remoteEnv: built.remoteEnv,
        runtimeConfigSync: syncBeautyRuntimeConfiguration,
        dnsPath: 'MANUAL_VERIFIED',
      },
      onStep: (event) => console.log(`  ${event.step || event.phase || 'étape'}${event.status ? ` — ${event.status}` : ''}${event.message ? ` : ${event.message}` : ''}`),
    });
    if (result?.ok === false) {
      throw new Error(`${result.pipeline?.error?.code || 'DEPLOY_FAILED'} ${result.pipeline?.error?.message || 'Pipeline interrompu.'}`);
    }
    console.log(`✓ Déploiement terminé : https://${target.host}`);
  } finally {
    closeSession(sessionId);
  }
}

main().catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1; });
