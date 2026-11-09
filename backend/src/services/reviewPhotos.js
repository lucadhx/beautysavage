import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { validateImage } from './media/mediaValidation.js';

/**
 * LES PHOTOS D'UN AVIS — trois au plus, ajoutées par la cliente (ou par
 * l'institut pour un avis saisi à la main).
 *
 * Chaque photo est RÉ-ENCODÉE (webp, 1600 px au plus, orientation appliquée) :
 * le fichier publié ne garde aucune métadonnée de l'original — une photo prise
 * au téléphone porte souvent la position GPS du domicile de la cliente.
 *
 * Le nom du fichier dit qui l'a déposée (`r<idCliente>-…` ou `m-…` pour le
 * Manager) : une cliente ne peut joindre à son avis que ses propres photos.
 */

export const REVIEW_PHOTO_MAX = 3;
const DIR = 'review-photos';
const URL_RE = /^\/uploads\/review-photos\/((?:r[a-f0-9]{24}|m)-[a-f0-9-]{36}\.webp)$/;

export async function storeReviewPhoto(file, { customerId = null } = {}) {
  if (!file?.buffer?.length) throw ApiError.badRequest('Aucune photo reçue.', { code: 'REVIEW_PHOTO_MISSING' });
  await validateImage(file.buffer);
  let output;
  try {
    output = await sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw ApiError.badRequest('Cette photo n’a pas pu être lue.', { code: 'REVIEW_PHOTO_INVALID' });
  }
  const owner = customerId ? `r${String(customerId)}` : 'm';
  const filename = `${owner}-${crypto.randomUUID()}.webp`;
  const dir = path.join(config.paths.uploads, DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), output);
  return { url: `/uploads/${DIR}/${filename}` };
}

/**
 * Les photos jointes à un avis : adresses de ce dossier seulement, sans
 * doublon, trois au plus ; une cliente ne joint que les siennes.
 */
export function normalizeReviewPhotos(raw, { customerId = null, manager = false } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const urls = [];
  for (const entry of list) {
    const url = String(typeof entry === 'string' ? entry : entry?.url || '').trim();
    const match = url.match(URL_RE);
    if (!match) throw ApiError.badRequest('Photo invalide.', { code: 'REVIEW_PHOTO_INVALID' });
    const mine = manager || match[1].startsWith(`r${String(customerId)}-`);
    if (!mine) throw ApiError.forbidden('Cette photo ne vous appartient pas.', { code: 'REVIEW_PHOTO_FORBIDDEN' });
    if (!urls.includes(url)) urls.push(url);
  }
  if (urls.length > REVIEW_PHOTO_MAX) {
    throw ApiError.badRequest(`${REVIEW_PHOTO_MAX} photos au plus par avis.`, { code: 'REVIEW_PHOTO_TOO_MANY', max: REVIEW_PHOTO_MAX });
  }
  return urls.map((url) => ({ url }));
}
