import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bsAliases, makeApiProxy } from '../../vite.shared';

// App manager (manager.beautysavage.fr). APP_KIND figé à 'manager'.
// RX1 — base '/manager/' : servie officiellement par Express sous /manager (rollback via flag).
// Override par VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE || '/manager/',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_KIND': JSON.stringify('manager'),
  },
  resolve: { alias: bsAliases },
  server: {
    port: 5174,
    proxy: makeApiProxy(),
  },
});
