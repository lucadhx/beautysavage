import { defineConfig } from 'vitest/config';

// Audit-only harness (rapport 90 — matrice de scénarios métier).
// EXPLORATOIRE et NON destructif : exécuté uniquement via
//   npm run audit:business-scenarios
// Isolé de la suite principale (vitest.config.js exclut tests/audit/**) pour qu'un
// scénario révélant un FAIL/FRAGILE ne casse jamais le CI P0/P1/integration.
// Les probes sont des tests de CARACTÉRISATION : vert = le comportement observé est
// celui documenté dans le rapport 90 (les risques y sont classés analytiquement).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/testEnv.js'],
    include: ['tests/audit/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
    fileParallelism: false,
    dangerouslyIgnoreUnhandledErrors: false
  }
});
