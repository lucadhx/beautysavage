import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Écriture des rapports de diagnostic sur disque — un fichier daté par exécution.
 *
 * Emplacement : `backend/logs/`. Ce dossier est ignoré par git (rapports = données
 * de recette, jamais du code). Le rapport JSON est la source de vérité partageable ;
 * le `.log` texte est le confort de lecture.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(HERE, '../../logs');

/** Horodatage compact pour un nom de fichier : 20260720-143005. */
function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * Persiste un rapport (JSON + texte lisible) et renvoie les chemins écrits.
 *
 * @param {object} report        Rapport structuré.
 * @param {string} humanText     Rendu texte (formatDiagnosticReport).
 * @param {string} [prefix]      Préfixe de nom de fichier.
 * @returns {Promise<{ jsonPath, logPath, dir }>}
 */
export async function writeDiagnosticReport(report, humanText, prefix = 'email-diagnostic') {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  const base = `${prefix}-${stamp()}`;
  const jsonPath = path.join(LOGS_DIR, `${base}.json`);
  const logPath = path.join(LOGS_DIR, `${base}.log`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(logPath, humanText, 'utf8');
  // Copie « latest » pour un accès stable (Manager / partage rapide).
  await fs.writeFile(path.join(LOGS_DIR, `${prefix}-latest.json`), JSON.stringify(report, null, 2), 'utf8');
  return { jsonPath, logPath, dir: LOGS_DIR };
}

export { LOGS_DIR };
export default { writeDiagnosticReport, LOGS_DIR };
