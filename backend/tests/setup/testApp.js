// tests/setup/testApp.js
// Boots the real Express app in test mode against the in-memory MongoDB and
// returns a supertest agent factory.
//
// Order matters:
//   1. start in-memory mongo + set process.env.MONGODB_URI (local URI)
//   2. assert the URI is local (never a real/prod cluster)
//   3. dynamic-import app.js (which then connects mongoose to the local URI and,
//      because NODE_ENV==='test', does NOT start schedulers or listen())
import supertest from 'supertest';
import { startMemoryDb } from './testDb.js';

let cachedApp = null;

export async function getTestApp() {
  if (cachedApp) return cachedApp;

  const uri = await startMemoryDb();
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(uri)) {
    throw new Error(
      `[testApp] Refusing to boot: MONGODB_URI is not an in-memory/local server (${uri}). ` +
        'This guards against connecting tests to a real database.'
    );
  }

  // Dynamic import AFTER env is set, so app.js connects to the in-memory DB.
  const mod = await import('../../app.js');
  cachedApp = mod.default;
  if (!cachedApp) {
    throw new Error('[testApp] app.js did not export the Express app (default export missing).');
  }
  return cachedApp;
}

/** Convenience: supertest agent bound to the booted app. */
export async function getAgent() {
  const app = await getTestApp();
  return supertest(app);
}

export { supertest };
