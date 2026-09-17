import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { bsAliases } from './vite.shared';

// Tests frontend (apps + packages).
// PERF : l'environnement jsdom est coûteux (instanciation par fichier). La grande majorité des
// tests `*.test.ts` (logique pure / clients API) N'ONT PAS besoin du DOM → ils tournent en
// `node` (rapide). Seuls les tests de composants `*.test.tsx` obtiennent jsdom + Testing Library.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: bsAliases },
  test: {
    environment: 'node',
    // jsdom pour les tests de composants (.test.tsx) et les rares .test.ts qui touchent le DOM
    // (ex. motion.test.ts utilise matchMedia). Tout le reste (logique/clients API) reste en node.
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/motion.test.ts', 'jsdom'],
    ],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads', // threads > forks pour ces suites (réutilisation worker, jsdom plus rapide)
    include: [
      'apps/**/src/**/*.test.{ts,tsx}',
      'packages/**/src/**/*.test.{ts,tsx}',
    ],
  },
});
