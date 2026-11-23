import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * L'IMAGE D'UN LIEN PARTAGÉ — toujours un JPEG 1200 × 630.
 *
 * ══ LE DÉFAUT ══════════════════════════════════════════════════════════════
 *
 * L'image de partage choisie au Manager est une photo du site : du WebP, en
 * 3:2, souvent 2160 × 1440. Facebook et LinkedIn la recadrent à leur façon,
 * certaines versions de WhatsApp et d'iMessage n'affichent pas le WebP, et
 * sans largeur ni hauteur déclarées, la première personne qui partage un lien
 * voit une carte sans image (le réseau la télécharge pendant ce temps).
 *
 * ══ LE PRINCIPE ════════════════════════════════════════════════════════════
 *
 * Le rendu serveur n'annonce plus la photo d'origine : il annonce
 * `/og/<empreinte>.jpg`, dérivée À LA DEMANDE de cette photo — recadrée sur
 * sa zone d'intérêt au format 1,91:1 recommandé, en JPEG. L'empreinte vient
 * du fichier source : changer l'image au Manager change l'adresse, donc les
 * réseaux la relisent. Seuls les fichiers du site (`/uploads/…`) sont dérivés.
 */
export const SHARE_IMAGE = Object.freeze({ width: 1200, height: 630, type: 'image/jpeg' });
const PREFIXE = '/og/';
const MOTIF = /^\/og\/([0-9a-f]{16})\.jpg$/;

/** empreinte → nom du fichier source dans uploads/ */
const sources = new Map();
/** empreinte → JPEG produit (mémoire bornée : quelques dizaines d'images). */
const rendus = new Map();
const MAX_RENDUS = 64;

/** Le nom du média du site désigné par une adresse, sinon null (image externe). */
function fichierLocal(url) {
  const m = String(url || '').match(/^(?:https?:\/\/[^/]+)?\/uploads\/([^/?#]+)$/i);
  if (!m) return null;
  const nom = path.basename(decodeURIComponent(m[1]));
  return /\.(jpe?g|png|webp|avif|gif)$/i.test(nom) ? nom : null;
}

/**
 * L'adresse publique du JPEG de partage dérivé de `url`, ou null quand l'image
 * n'est pas un média du site (on garde alors l'adresse d'origine).
 */
export function shareImageFor(base, url) {
  const nom = fichierLocal(url);
  if (!nom || !base) return null;
  const empreinte = crypto.createHash('sha256').update(nom).digest('hex').slice(0, 16);
  sources.set(empreinte, nom);
  return `${String(base).replace(/\/+$/, '')}${PREFIXE}${empreinte}.jpg`;
}

export const isShareImagePath = (p) => MOTIF.test(String(p || ''));

/**
 * Sert `/og/<empreinte>.jpg`. Une empreinte inconnue (serveur redémarré avant
 * qu'une page ne l'ait annoncée) est retrouvée en rechargeant les pages : on
 * n'accepte jamais un nom de fichier venu de l'adresse elle-même.
 */
export async function serveShareImage(req, res, { reannoncer } = {}) {
  const m = String(req.path).match(MOTIF);
  if (!m) return res.status(404).type('text/plain').send('Not found');
  const empreinte = m[1];
  if (!sources.has(empreinte) && reannoncer) await reannoncer().catch(() => {});
  const nom = sources.get(empreinte);
  if (!nom) return res.status(404).type('text/plain').send('Not found');
  try {
    let jpeg = rendus.get(empreinte);
    if (!jpeg) {
      const brut = await fs.readFile(path.join(config.paths.uploads, nom));
      jpeg = await sharp(brut, { failOn: 'none' })
        .rotate()
        .resize(SHARE_IMAGE.width, SHARE_IMAGE.height, { fit: 'cover', position: sharp.strategy.attention })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true, progressive: true })
        .toBuffer();
      if (rendus.size >= MAX_RENDUS) rendus.delete(rendus.keys().next().value);
      rendus.set(empreinte, jpeg);
    }
    res.set('Content-Type', SHARE_IMAGE.type);
    // L'adresse change avec la source : le fichier, lui, ne change jamais.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    return req.method === 'HEAD' ? res.end() : res.send(jpeg);
  } catch (err) {
    logger.warn(`[seo] image de partage ${empreinte} : ${err?.message || err}`);
    return res.status(404).type('text/plain').send('Not found');
  }
}

export default { shareImageFor, serveShareImage, isShareImagePath, SHARE_IMAGE };
