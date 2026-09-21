import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  // Régime DEV canonique : vitrine (6102) en MÊME ORIGINE que le backend canonique
  // (6100) via ce proxy. API appelée en relatif (`/api`), comme sur le site déployé.
  server: {
    port: 6102,
    proxy: {
      '/api': 'http://localhost:6100',
      '/uploads': 'http://localhost:6100',
    },
  },
});
