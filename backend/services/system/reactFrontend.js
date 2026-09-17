// RX1 — React comme frontend officiel (progressif, avec rollback). Sert les deux builds Vite sous
// des sous-chemins dédiés (vitrine = /app, manager = /manager) en SPA, SANS shadow de /api, /auth ni
// de Vanilla. Le flag REACT_OFFICIAL_FRONTEND (défaut OFF) pilote la bascule des points d'entrée
// Vanilla (/, /vitrine.html, /gestion.html) vers React. Rollback = flag OFF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

export const VITRINE_BASE = '/app';
export const MANAGER_BASE = '/manager';
const VITRINE_DIST = path.join(REPO_ROOT, 'frontend-react', 'apps', 'vitrine', 'dist');
const MANAGER_DIST = path.join(REPO_ROOT, 'frontend-react', 'apps', 'manager', 'dist');

/** Le flag est lu DYNAMIQUEMENT (par requête) → togglable sans reboot + testable. */
export function isReactOfficialFrontend() {
  return String(process.env.REACT_OFFICIAL_FRONTEND || '').trim().toLowerCase() === 'true';
}

// SPA handler : renvoie index.html pour toute route cliente non-asset. 503 si build absent
// (jamais un crash) → message actionnable.
function spaFallback(distDir, label) {
  const indexFile = path.join(distDir, 'index.html');
  return (_req, res) => {
    if (!fs.existsSync(indexFile)) {
      return res
        .status(503)
        .type('text/plain')
        .send(`Build React ${label} manquant. Lancez \`npm run build\` dans frontend-react.`);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(indexFile);
  };
}

/**
 * Monte le serving des deux SPA React. À appeler AVANT le static Vanilla (public/) et le handler '/'.
 * Non destructif : crée seulement les préfixes /app et /manager (aucun chevauchement existant).
 */
export function mountReactFrontend(app) {
  // Assets statiques (hash → cache long ; index géré par le fallback en no-store).
  app.use(VITRINE_BASE, express.static(VITRINE_DIST, { index: false }));
  app.use(MANAGER_BASE, express.static(MANAGER_DIST, { index: false }));
  // Fallback SPA (client-side routing).
  app.get(`${VITRINE_BASE}`, spaFallback(VITRINE_DIST, 'vitrine'));
  app.get(`${VITRINE_BASE}/*`, spaFallback(VITRINE_DIST, 'vitrine'));
  app.get(`${MANAGER_BASE}`, spaFallback(MANAGER_DIST, 'manager'));
  app.get(`${MANAGER_BASE}/*`, spaFallback(MANAGER_DIST, 'manager'));
}

/**
 * Redirection conditionnelle d'un point d'entrée Vanilla vers React quand le flag est ON.
 * Retourne un middleware : si flag ON → 302 vers `target`, sinon `next()` (Vanilla sert).
 */
export function redirectToReactWhenOfficial(target) {
  return (req, res, next) => {
    if (isReactOfficialFrontend()) {
      return res.redirect(302, target);
    }
    return next();
  };
}
