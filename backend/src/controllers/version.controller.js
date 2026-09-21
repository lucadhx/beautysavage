/**
 * Version du backend DÉPLOYÉ (LOT 5/6). Lit le manifeste embarqué au build
 * (`build-manifest.json`, généré depuis la vraie source construite). PUBLIC et
 * NON SENSIBLE : commit / branche / date uniquement — jamais de chemin local ni
 * de secret. Sert de source de vérité « quelle version est réellement servie ».
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
/**
 * L'IDENTITÉ ANNONCÉE VIENT DU PROFIL DU PROJET, ET DE NULLE PART AILLEURS.
 *
 * Elle était écrite en dur — `'sbauto06'` — dans les trois branches de repli
 * ci-dessous. Le moteur de duplication réécrit pourtant `project.profile.js`
 * précisément pour qu'aucune copie n'annonce l'identité de sa source : la
 * réécriture était juste, et ce fichier ne la lisait pas. Un projet neuf
 * lancé depuis ses sources répondait donc `project: "sbauto06"` à
 * `/api/version`, c'est-à-dire au Panel qui l'interroge.
 */
import { PROJECT_ID } from '../deployment-engine/config/project.profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../build-manifest.json');

let cached = null;

export const getVersion = asyncHandler(async (req, res) => {
  if (!cached) {
    try {
      // Priorité : manifeste embarqué au BUILD (source de vérité du déployé).
      const m = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
      cached = { project: m.project || PROJECT_ID, commitHash: m.commitHash || null, shortCommit: m.shortCommit || null, branch: m.branch || null, builtAt: m.builtAt || null, isDirty: Boolean(m.isDirty), source: 'manifest' };
    } catch {
      // Pas de manifeste (backend lancé depuis la source en dev) : repli Git local.
      try {
        const { getGitSourceInfo } = await import('../deployment-engine/build.js');
        const g = await getGitSourceInfo(path.resolve(__dirname, '../../..'));
        cached = { project: PROJECT_ID, commitHash: g.commitHash, shortCommit: g.shortCommit, branch: g.branch, builtAt: null, isDirty: g.isDirty, source: g.isGit ? 'git' : 'unavailable' };
      } catch {
        cached = { project: PROJECT_ID, commitHash: null, shortCommit: null, branch: null, builtAt: null, isDirty: false, source: 'unavailable' };
      }
    }
  }
  return ok(res, cached);
});
