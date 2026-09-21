import path from 'node:path';
import fs from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

const { duplicateStream } = await import('../controllers/deployment.controller.js');

const projectRoot = path.resolve('..');
const destRoot = path.resolve(projectRoot, '..', 'duplication-stream-repro');

function makeEmitter() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return this;
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) || []) handler(...args);
    },
  };
}

try {
  await fs.rm(destRoot, { recursive: true, force: true }).catch(() => {});

  const req = Object.assign(makeEmitter(), {
    body: {
      projectName: 'Duplication Stream Repro',
      folderName: 'duplication-stream-repro',
      dbTest: 'duplication_stream_test',
      dbProd: 'duplication_stream_prod',
      devEmail: 'dev.stream@test.local',
      devName: 'Développeur Flux',
      adminEmail: 'admin.stream@test.local',
      adminPassword: 'Flux-Admin-2026',
      adminPasswordConfirmation: 'Flux-Admin-2026',
      githubRepositoryUrl: 'https://github.com/example/duplication-stream-repro',
    },
  });

  const writes = [];
  let ended = false;
  const res = Object.assign(makeEmitter(), {
    writableEnded: false,
    setHeader() {},
    flushHeaders() {},
    flush() {},
    end() {
      ended = true;
      this.writableEnded = true;
    },
    write(chunk) {
      const text = String(chunk).trim();
      writes.push(text);
      if (text.includes('"project":"manager"') && text.includes('"status":"ok"')) {
        this.emit('close');
        throw new Error('simulated client disconnect');
      }
      return true;
    },
  });

  let thrown = null;
  try {
    await duplicateStream(req, res);
  } catch (err) {
    thrown = err;
  }

  check('duplicateStream : une coupure client ne remonte pas en exception', thrown === null);
  check('duplicateStream : le backend termine même si le flux est coupé', ended === false);
  check('duplicateStream : backend installé malgré la coupure', await exists(path.join(destRoot, 'backend', 'node_modules')));
  check('duplicateStream : manager installé malgré la coupure', await exists(path.join(destRoot, 'manager', 'node_modules')));
  check('duplicateStream : vitrine installée malgré la coupure', await exists(path.join(destRoot, 'vitrine', 'node_modules')));
  check('duplicateStream : vite manager résolu localement', await exists(viteBin(path.join(destRoot, 'manager'))));
  check('duplicateStream : vite vitrine résolu localement', await exists(viteBin(path.join(destRoot, 'vitrine'))));
  check('duplicateStream : aucune phase seed n’est émise', writes.every((line) => !line.includes('"phase":"seed"')));
} catch (err) {
  console.error('DUPLICATION STREAM TEST CRASHED:', err);
  fail++;
} finally {
  await fs.rm(destRoot, { recursive: true, force: true }).catch(() => {});
  await mongod.stop();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function viteBin(projectDir) {
  return path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
