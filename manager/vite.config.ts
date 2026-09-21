import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * ══ L'IDENTITÉ DU PROJET, FIGÉE DANS LE BUILD ══════════════════════════════
 *
 * Le régime DEV canonique sert TOUS les managers du parc sur la même origine
 * (`localhost:6101`) — donc dans le même `localStorage`. Sans clé propre au
 * projet, le manager de FJ Services démarrait avec le nom, le logo et le jeton
 * de KleenPro. Voir `src/lib/projectIdentity.ts`.
 *
 * La source est `manager/package.json` (`<PROJECT_SLUG>-manager`), que le
 * moteur de duplication réécrit au même instant que `project.profile.js` : une
 * copie ne peut donc pas hériter de la clé de sa source.
 *
 * On LÈVE si elle est illisible : un build muet produirait un manager qui
 * repart d'un espace de noms jetable à chaque chargement — isolé, mais
 * inutilisable, et pour une raison invisible.
 */
const require = createRequire(import.meta.url);
const nomPaquet: string = require('./package.json').name ?? '';
const PROJECT_KEY = nomPaquet.replace(/-manager$/, '').trim();
if (!PROJECT_KEY) {
  throw new Error(
    'manager/package.json ne porte pas de nom exploitable : impossible de dériver '
    + 'la clé de projet qui cloisonne le stockage local. Voir src/lib/projectIdentity.ts.',
  );
}

export default defineConfig({
  plugins: [react()],
  define: {
    __PROJECT_KEY__: JSON.stringify(PROJECT_KEY),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      /*
        LES COMPOSANTS D'APERÇU VIENNENT DE LA VITRINE ELLE-MÊME.

        Un aperçu qui RE-DESSINE ce qu'il prétend montrer se périme au premier
        changement de la vitrine, sans que rien ne le signale. Les fichiers
        atteints par cet alias sont écrits pour être lus par les deux
        applications — voir l'en-tête de `HeroBanner.tsx`.

        Les deux dossiers sont toujours côte à côte : le moteur de déploiement
        construit les applications depuis la même source (`APPS`, chacune avec
        son `dir`), et une duplication de projet les emporte ensemble.
      */
      '@vitrine': path.resolve(__dirname, '../vitrine/src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Isole les grosses dépendances dans leurs propres chunks (mis en cache
        // indépendamment des pages, elles-mêmes découpées via React.lazy).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  // Régime DEV canonique (cf. scripts/dev-canonical.mjs) : Manager 6101 servi en
  // MÊME ORIGINE que le backend 6100 via ce proxy. On NE définit PAS VITE_API_URL
  // en local → l'API est appelée en relatif (`/api`, `/uploads`), exactement comme
  // sur le site déployé (Nginx proxifie vers le backend). Aucune requête
  // cross-origin → aucun CORS à gérer, et les médias relatifs se résolvent seuls.
  server: {
    port: 6101,
    /*
      Le serveur de développement refuse par défaut de servir un fichier situé
      hors de la racine du projet. Les composants d'aperçu venant de la vitrine
      (alias `@vitrine`) sont dans le dossier voisin : on autorise donc
      explicitement le dossier PARENT, qui contient les deux applications. La
      construction, elle, n'est pas concernée — cette garde ne vise que le
      serveur local.
    */
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:6100',
      '/uploads': 'http://localhost:6100',
    },
  },
});
