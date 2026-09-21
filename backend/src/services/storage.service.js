import path from 'node:path';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isValidMediaName } from './media/mediaNaming.js';

/**
 * Gestion du cycle de vie des fichiers uploadés (dossier /uploads).
 *
 * Contexte critique :
 *  - Le dossier `uploads/` est UNIQUE et PARTAGÉ entre TEST et PROD (même disque,
 *    même cluster Mongo ; seul le NOM de base change). PROD ayant été initialisée
 *    par copie de TEST, les deux bases peuvent référencer le MÊME fichier
 *    physique. Un fichier ne peut donc être supprimé que s'il n'est référencé par
 *    AUCUN document de DB_TEST ∪ DB_PROD.
 *  - L'`ImageUpload` du manager envoie le fichier AVANT l'enregistrement du
 *    document : un fichier fraîchement uploadé est légitimement non référencé
 *    pendant la durée d'édition du formulaire. On protège donc les fichiers
 *    récents via une période de grâce (mtime).
 *
 * Conséquence : le nettoyage est un BALAYAGE anti-orphelins référence-compté, et
 * non une suppression ciblée « à la mutation » (qui casserait l'autre base).
 */

/**
 * LA PÉRIODE DE GRÂCE — une heure.
 *
 * Le Manager envoie le fichier AVANT que la fiche ne soit enregistrée : un
 * média fraîchement importé est donc légitimement non référencé pendant toute
 * la durée d'édition du formulaire. Le balayer immédiatement supprimerait
 * l'image que l'utilisateur est en train de poser.
 */
const AUTO_SWEEP_GRACE_MS = 60 * 60 * 1000; // 1 h
/** Anti-rafale : plusieurs mutations rapprochées ne déclenchent qu'un balayage. */
const SWEEP_DEBOUNCE_MS = 15_000;

/**
 * ══ CE QUI COMPTE COMME UNE RÉFÉRENCE, ET CE QUI N'EN EST PAS UNE ══════════
 *
 * Une fiche désigne un média de DEUX façons, et il a fallu les deux :
 *
 *   · un CHEMIN — `/uploads/<fichier>` — c'est la forme historique, celle que
 *     les champs `…Image` et `…PdfPath` conservent ;
 *   · une CLÉ D'OBJET NUE — `<uuid>-<empreinte>.webp` — c'est ce que porte un
 *     descripteur (`mediaDescriptorSchema`), qui n'a délibérément PAS de
 *     chemin : l'adresse est dérivée à la lecture, jamais stockée.
 *
 * Le balayage ne connaissait que la première. Une fiche qui n'aurait gardé que
 * son descripteur — l'état vers lequel tout le projet converge — aurait vu son
 * média traité comme un orphelin et supprimé sous elle.
 */
const UPLOAD_REF_RE = /\/uploads\/([^/\s"'?#]+)/g;

/**
 * ══ L'INVENTAIRE N'EST PAS UN CONSOMMATEUR — ET C'EST TOUT LE DÉFAUT ═══════
 *
 * `ProjectMedia` porte `path: '/uploads/<clé>'` pour CHAQUE média importé. Le
 * balayage lisant TOUTES les collections, il trouvait donc, dans l'inventaire
 * lui-même, une référence vers chacun des fichiers qu'il était censé juger.
 *
 * Conséquence exacte, et mesurable : `referenced` contenait l'intégralité du
 * dossier, `deleted` était toujours vide, et le nettoyage automatique posé
 * après chaque mutation ne pouvait RIEN nettoyer. Le stockage ne faisait que
 * croître — un logo remplacé dix fois laissait dix fichiers.
 *
 * L'inventaire DÉCRIT les objets ; il ne les utilise pas. Il est donc exclu du
 * relevé — exactement comme `findReferences` le fait déjà de son côté, et pour
 * la même raison.
 */
const COLLECTIONS_NON_CONSOMMATRICES = new Set(['projectmedias']);

/** Extrait les médias désignés par une valeur JSON — chemins ET clés nues. */
function collectRefs(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    let m;
    UPLOAD_REF_RE.lastIndex = 0;
    while ((m = UPLOAD_REF_RE.exec(value)) !== null) out.add(decodeURIComponent(m[1]));
    // Une clé d'objet nue : c'est la forme que porte un descripteur.
    if (isValidMediaName(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectRefs(v, out);
  }
}

/** Noms de bases à scanner : active + TEST + PROD (dédupliqués, définis). */
function databasesToScan() {
  return [...new Set([config.dbName, process.env.DB_TEST, process.env.DB_PROD].filter(Boolean))];
}

/**
 * Ensemble des fichiers upload référencés par au moins une FICHE, sur toutes
 * les collections consommatrices de toutes les bases pertinentes (TEST ∪ PROD).
 *
 * Conservateur par conception : on relève les deux formes de désignation, sur
 * les deux bases, avant de conclure qu'un fichier n'est rendu nulle part. Ce
 * qui est exclu, c'est l'inventaire — voir `COLLECTIONS_NON_CONSOMMATRICES`.
 */
export async function collectReferencedFilenames() {
  const referenced = new Set();
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1) {
    throw new Error('collectReferencedFilenames: connexion MongoDB indisponible');
  }

  for (const dbName of databasesToScan()) {
    const db = conn.useDb(dbName, { useCache: true }).db;
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      if (name.startsWith('system.')) continue;
      if (COLLECTIONS_NON_CONSOMMATRICES.has(name)) continue;
      const cursor = db.collection(name).find({}, { readPreference: 'primary' });
      for await (const doc of cursor) collectRefs(doc, referenced);
    }
  }
  return referenced;
}

/** Fichiers physiquement présents dans /uploads (hors dotfiles / .gitkeep). */
export async function listPhysicalFiles() {
  try {
    const entries = await fs.readdir(config.paths.uploads, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Balaye /uploads et supprime les fichiers orphelins.
 * @param {object}  opts
 * @param {boolean} opts.dryRun   n'effectue aucune suppression, se contente de rapporter.
 * @param {number}  opts.minAgeMs période de grâce ; un orphelin plus récent est conservé.
 * @returns {Promise<{referencedCount:number, physicalCount:number, deleted:string[],
 *                    keptRecent:string[], reclaimedBytes:number, dryRun:boolean}>}
 */
export async function sweepOrphans({ dryRun = false, minAgeMs = 0 } = {}) {
  const referenced = await collectReferencedFilenames();
  const files = await listPhysicalFiles();
  const now = Date.now();

  const deleted = [];
  const keptRecent = [];
  let reclaimedBytes = 0;

  for (const file of files) {
    if (referenced.has(file)) continue;
    const full = path.join(config.paths.uploads, file);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue; // disparu entre-temps
    }
    if (minAgeMs > 0 && now - stat.mtimeMs < minAgeMs) {
      keptRecent.push(file);
      continue;
    }
    if (!dryRun) {
      try {
        await fs.unlink(full);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.error(`[storage] échec suppression ${file}`, err.message);
          continue;
        }
      }
      /**
       * LE DESCRIPTEUR SUIT LE FICHIER.
       *
       * Sans cela, le balayage laisserait un descripteur vivant décrivant un
       * fichier disparu : l'adresse répondrait 404 (« n'a jamais existé »)
       * alors que la vérité est « a été retiré ». La distinction est
       * précisément ce que le descripteur sert à tenir.
       */
      try {
        const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
        const at = new Date().toISOString();
        await ProjectMedia.updateOne(
          { objectKey: file, deletedAt: null },
          { $set: { deletedAt: at, updatedAt: at } },
        );
      } catch {
        // Le descripteur est un confort d'exploitation : son absence ne doit
        // jamais empêcher le disque d'être nettoyé.
      }
    }
    reclaimedBytes += stat.size;
    deleted.push(file);
  }

  return {
    referencedCount: referenced.size,
    physicalCount: files.length,
    deleted,
    keptRecent,
    reclaimedBytes,
    dryRun,
  };
}

/* ------------------------------------------------------------------ *
 * Déclencheur automatique débattu (appelé après chaque mutation).    *
 * ------------------------------------------------------------------ */
let sweepTimer = null;
let sweepRunning = false;

async function runAutoSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const report = await sweepOrphans({ minAgeMs: AUTO_SWEEP_GRACE_MS });
    if (report.deleted.length > 0) {
      logger.info(
        `[storage] balayage : ${report.deleted.length} orphelin(s) supprimé(s), ` +
          `${(report.reclaimedBytes / 1024).toFixed(0)} Ko libérés`
      );
    }
  } catch (err) {
    logger.error('[storage] balayage automatique échoué', err.message);
  } finally {
    sweepRunning = false;
  }
}

/**
 * Programme un balayage anti-orphelins « bientôt ». Idempotent : les appels
 * rapprochés sont fusionnés en un seul passage. Ne bloque JAMAIS la requête
 * appelante (fire-and-forget).
 */
export function scheduleOrphanSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    void runAutoSweep();
  }, SWEEP_DEBOUNCE_MS);
  // Ne pas maintenir le process en vie juste pour le balayage.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/* ------------------------------------------------------------------ *
 * LE CONCIERGE — un balayage périodique, sur l'AUTORITÉ seulement.    *
 * ------------------------------------------------------------------ */

/**
 * ══ POURQUOI UN MINUTEUR EN PLUS DU DÉCLENCHEUR DE MUTATION ═════════════════
 *
 * Le balayage n'était programmé qu'après une mutation reçue par CETTE instance.
 * Or les médias vivent chez l'AUTORITÉ — le backend déployé — pendant que la
 * plupart des mutations sont émises depuis un poste de développement, qui les
 * écrit dans la base partagée sans jamais toucher l'API de l'autorité.
 *
 * Résultat : le seul processus qui possède les fichiers pouvait rester des
 * semaines sans jamais évaluer son dossier. Un média décroché d'une fiche
 * depuis un poste restait donc sur le disque du serveur, indéfiniment.
 *
 * Le minuteur ferme ce trou : l'autorité regarde son propre dossier à
 * intervalle régulier, qu'on lui ait parlé ou non.
 *
 * ══ SEULE L'AUTORITÉ BALAYE ═════════════════════════════════════════════════
 *
 * Une instance cliente n'a pas les fichiers : la faire balayer ne libérerait
 * rien et ferait tourner, pour rien, une lecture complète de deux bases.
 */
const JANITOR_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
/** Le premier passage attend que le démarrage soit fini — il n'est pas urgent. */
const JANITOR_FIRST_DELAY_MS = 3 * 60 * 1000; // 3 min

let janitorTimer = null;

async function passageDuConcierge() {
  try {
    const { resolveProjectMediaAuthority } = await import('./media/projectMediaAuthority.js');
    const { isAuthority } = await resolveProjectMediaAuthority();
    if (!isAuthority) return;
  } catch {
    // Autorité indéterminable : on s'abstient. Balayer « au cas où » serait
    // exactement la décision qu'on ne veut pas prendre sur un doute.
    return;
  }
  await runAutoSweep();
}

/**
 * DÉMARRE le concierge des médias. Idempotent, `unref` — il ne maintient
 * jamais le processus en vie.
 *
 * @returns {() => void} l'arrêt, à inscrire auprès du cycle de vie.
 */
export function startMediaJanitor() {
  if (janitorTimer) return () => stopMediaJanitor();

  const premier = setTimeout(() => { void passageDuConcierge(); }, JANITOR_FIRST_DELAY_MS);
  premier.unref?.();

  janitorTimer = setInterval(() => { void passageDuConcierge(); }, JANITOR_INTERVAL_MS);
  janitorTimer.unref?.();

  return () => {
    clearTimeout(premier);
    stopMediaJanitor();
  };
}

/** Arrête le concierge. Sans effet s'il ne tourne pas. */
export function stopMediaJanitor() {
  if (janitorTimer) clearInterval(janitorTimer);
  janitorTimer = null;
}

/** Le rythme du concierge — lu par les recettes, jamais recopié. */
export const MEDIA_JANITOR = Object.freeze({
  INTERVAL_MS: JANITOR_INTERVAL_MS,
  FIRST_DELAY_MS: JANITOR_FIRST_DELAY_MS,
  GRACE_MS: AUTO_SWEEP_GRACE_MS,
});
