import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { MAX_INPUT_BYTES, humanBytes } from '../services/media/mediaPolicy.js';

// Keep files in memory; Sharp processes the buffer then writes the final file.
const storage = multer.memoryStorage();

/**
 * LA BORNE VIENT DE LA POLITIQUE — plus jamais d'un nombre écrit ici.
 *
 * ══ POURQUOI LE PLAFOND, ET NON LA LIMITE DU TYPE ══════════════════════════
 *
 * `multer` coupe le flux AVANT que le corps ne soit lu : à cet instant, on ne
 * sait pas encore de quel type de média il s'agit (il voyage dans la requête).
 * On laisse donc entrer jusqu'au plafond de la table, puis `validateImage`
 * refuse par TYPE — avec un message qui nomme la bonne limite.
 *
 * L'inverse produirait le pire des deux mondes : une coupure de flux muette,
 * sans code métier, sur un fichier parfaitement légitime pour son usage.
 *
 * ── LE FILTRE MIME NE FILTRE PLUS RIEN ──────────────────────────────────────
 *
 * `file.mimetype` est DÉCLARÉ par le navigateur d'après l'extension : il ne
 * prouve rien. Le vrai contrôle lit les OCTETS (`validateImage`). On garde ici
 * un refus précoce et bon marché des types manifestement étrangers, sans
 * jamais lui faire porter la sécurité.
 */
export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_INPUT_BYTES },
  fileFilter(req, file, cb) {
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(ApiError.badRequest(
        'Seules les images sont autorisées.',
        { code: 'MEDIA_TYPE_UNSUPPORTED' },
      ));
    }
    cb(null, true);
  },
});

/**
 * TRADUIT LES REFUS DE `multer` EN ERREURS MÉTIER.
 *
 * ══ CE QUI S'AFFICHAIT AVANT ════════════════════════════════════════════════
 *
 *     Erreur interne.
 *     MulterError: File too large
 *
 * Un rejet parfaitement PRÉVU — l'utilisateur a déposé un fichier trop gros —
 * se présentait comme une panne du serveur, sans dire la limite ni quoi faire.
 * Un utilisateur ne peut rien faire d'une panne ; il peut réduire une image.
 *
 * À poser APRÈS le middleware d'upload, sur les routes qui l'utilisent.
 */
export function translateUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(
        413,
        `Cette image dépasse la taille maximale acceptée (${humanBytes(MAX_INPUT_BYTES)}).`,
        { code: 'MEDIA_TOO_LARGE', maxBytes: MAX_INPUT_BYTES },
      ));
    }
    return next(ApiError.badRequest(
      `Envoi de fichier invalide (${err.code}).`,
      { code: 'MEDIA_INVALID' },
    ));
  }
  return next(err);
}

// Upload de PDF de contrat (mémoire) : la validation profonde (magic bytes,
// chiffrement, pages) est faite par contractDocument.service. Ici on filtre le
// MIME et on borne la taille (le service revalide de toute façon).
export const uploadContractPdf = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    const okMime = file.mimetype === 'application/pdf';
    const okExt = /\.pdf$/i.test(file.originalname || '');
    if (!okMime || !okExt) {
      return cb(ApiError.badRequest('Seuls les fichiers PDF sont autorisés'));
    }
    cb(null, true);
  },
});

/** Plafond d'un livrable (vidéo comprise) — Nginx doit laisser passer au moins autant. */
export const TRAINING_DELIVERABLE_MAX_BYTES = 120 * 1024 * 1024;

/**
 * LES LIVRABLES S'ÉCRIVENT DIRECTEMENT SUR LE DISQUE.
 *
 * Une vidéo de 120 Mo gardée en mémoire le temps de la requête, c'est 120 Mo
 * de RAM du serveur par cliente qui envoie son dossier. Le nom de fichier
 * porte l'identité de la cliente (`c<id>-…`) : c'est ce qui l'autorise, elle
 * seule, à supprimer ou remplacer son fichier avant de soumettre.
 */
const trainingDeliverableStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(config.paths.uploads, 'training-deliverables');
    fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (err) => cb(err));
  },
  filename(req, file, cb) {
    const owner = req.customer?._id ? `c${req.customer._id}` : 'manager';
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) || '';
    cb(null, `${owner}-${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

export const uploadTrainingDeliverable = multer({
  storage: trainingDeliverableStorage,
  limits: { fileSize: TRAINING_DELIVERABLE_MAX_BYTES },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || '');
    if (!mime.startsWith('image/') && !mime.startsWith('video/') && mime !== 'application/pdf') {
      return cb(ApiError.badRequest(
        'Formats acceptes : image, video ou PDF.',
        { code: 'DELIVERABLE_TYPE_UNSUPPORTED' },
      ));
    }
    cb(null, true);
  },
});
