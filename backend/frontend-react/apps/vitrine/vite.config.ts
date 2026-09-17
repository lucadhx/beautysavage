import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bsAliases, makeApiProxy } from '../../vite.shared';

// App vitrine (beautysavage.fr). Proxy same-origin /api,/auth,/uploads → backend.
// RX1 — base '/app/' : servie officiellement par Express sous /app (rollback via flag). Override
// par VITE_BASE (ex. '/' pour un déploiement racine / host dédié).
export default defineConfig({
  base: process.env.VITE_BASE || '/app/',
  plugins: [react()],
  resolve: { alias: bsAliases },
  server: {
    port: 5173,
    proxy: makeApiProxy(),
  },
});
