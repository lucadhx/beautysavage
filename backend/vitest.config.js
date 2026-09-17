import { defineConfig, configDefaults } from 'vitest/config';

// Backend test harness configuration (Phase 0.2).
// - Tests run in Node, sequentially per file (fileParallelism:false) to avoid
//   spinning multiple in-memory MongoDB instances at once.
// - testEnv.js sets fake/safe environment variables BEFORE any app import, so
//   the real .env (secrets, prod DB) is never used in tests.
// - tests/audit/** is EXCLUDED here: the exploratory business-scenario matrix runs
//   only via `npm run audit:business-scenarios` (vitest.audit.config.js) so it never
//   destabilises the main P0/P1/integration suites.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/testEnv.js'],
    include: ['tests/**/*.test.js'],
    exclude: [...configDefaults.exclude, 'tests/audit/**'],
    testTimeout: 30000,
    hookTimeout: 120000, // in-memory mongod boot + app migrations can be slow on first run
    pool: 'forks',
    fileParallelism: false,
    // Surface unhandled rejections instead of hiding them
    dangerouslyIgnoreUnhandledErrors: false
  }
});
