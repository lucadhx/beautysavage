import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * L'ICÔNE DU SITE, LISIBLE PAR GOOGLE.
 *
 * ══ LE DÉFAUT ══════════════════════════════════════════════════════════════
 *
 * Dans les résultats de recherche, Google affiche à côté du nom du site son
 * favicon. Il le lit dans le HTML de la page d'accueil, SANS exécuter le
 * JavaScript. Or la coquille de la vitrine ne déclarait qu'une icône vide
 * (`data:,`), la vraie étant posée ensuite par React ; et `/favicon.ico`
 * répondait 404. Google montrait donc un globe générique.
 *
 * ══ LE PRINCIPE ════════════════════════════════════════════════════════════
 *
 * Les icônes sont servies à des adresses FIXES du site public (`/favicon.ico`,
 * `/favicon-192.png`…), produites à la demande depuis le favicon choisi dans
 * le Manager (fiche Entreprise), à défaut depuis le logo. Le rendu serveur les
 * déclare avec une empreinte (`?v=…`) tirée du fichier source : changer le
 * favicon dans le Manager change l'adresse déclarée, signal clair pour Google
 * et pour les navigateurs que l'icône a changé — sans redéploiement.
 */

/** Le fichier choisi par l'institut : le favicon, à défaut le logo d'en-tête. */
export function iconSource(data) {
  return String(data?.company?.logos?.favicon || data?.company?.logos?.header || '').trim();
}

/** L'empreinte de l'icône courante — vide s'il n'y en a aucune. */
export function iconVersion(data) {
  const source = iconSource(data);
  return source ? crypto.createHash('sha1').update(source).digest('hex').slice(0, 10) : '';
}

/** Les adresses servies, et ce que chacune contient. */
const ICONS = {
  '/favicon.ico': { size: 48, ico: true },
  '/favicon-48.png': { size: 48 },
  '/favicon-192.png': { size: 192 },
  '/icon-512.png': { size: 512 },
  // iOS n'affiche pas la transparence (fond noir) : fond blanc plein.
  '/apple-touch-icon.png': { size: 180, flatten: true },
};
export const SITE_ICON_PATHS = [...Object.keys(ICONS), '/site.webmanifest'];

const rendered = new Map();

async function readSource(source) {
  // Un média de CE projet : lu sur disque, sans détour par le réseau.
  const local = source.match(/\/uploads\/([^/?#]+)/);
  if (local) {
    const file = path.join(config.paths.uploads, path.basename(decodeURIComponent(local[1])));
    try { return await fs.readFile(file); } catch { /* instance sans le fichier : on le demande par HTTP */ }
  }
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(5000) });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  }
  return null;
}

/** Un ICO qui embarque un PNG : format admis par tous les navigateurs et par Google. */
export function pngToIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(1, 4); // une image
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt8(0, 8); // pas de palette
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); // plans
  header.writeUInt16LE(32, 12); // bits par pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // l'image suit l'en-tête
  return Buffer.concat([header, png]);
}

async function renderIcon(source, spec) {
  const key = `${source}|${spec.size}|${spec.ico ? 'ico' : ''}|${spec.flatten ? 'flat' : ''}`;
  if (rendered.has(key)) return rendered.get(key);
  const input = await readSource(source);
  if (!input) return null;
  let image = sharp(input).resize(spec.size, spec.size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: spec.flatten ? 1 : 0 } });
  if (spec.flatten) image = image.flatten({ background: '#ffffff' });
  const png = await image.png().toBuffer();
  const body = spec.ico ? pngToIco(png, spec.size) : png;
  if (rendered.size > 40) rendered.clear();
  rendered.set(key, body);
  return body;
}

/**
 * Le gestionnaire Express des adresses d'icône. Une adresse qui porte
 * l'empreinte COURANTE est immuable (cache d'un an) ; sans empreinte, ou avec
 * une ancienne, elle n'est gardée qu'une heure.
 */
export async function serveSiteIcon(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!SITE_ICON_PATHS.includes(req.path)) return next();
  try {
    const { loadSeoData } = await import('./seo.service.js');
    const data = await loadSeoData();
    const version = iconVersion(data);
    const cache = version && req.query.v === version ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';

    if (req.path === '/site.webmanifest') {
      const name = String(data.company?.name || 'Institut').trim();
      const v = version ? `?v=${version}` : '';
      res.set('Cache-Control', 'public, max-age=3600');
      return res.type('application/manifest+json').send(JSON.stringify({
        name,
        short_name: name.length > 12 ? name.split(/\s+/)[0] : name,
        start_url: '/',
        display: 'browser',
        // Même couleur que la balise theme-color du rendu serveur.
        background_color: String(data.theme?.colors?.background || '#ffffff'),
        theme_color: String(data.theme?.colors?.background || '#ffffff'),
        icons: version ? [
          { src: `/favicon-192.png${v}`, sizes: '192x192', type: 'image/png' },
          { src: `/icon-512.png${v}`, sizes: '512x512', type: 'image/png' },
        ] : [],
      }));
    }

    const source = iconSource(data);
    const body = source ? await renderIcon(source, ICONS[req.path]) : null;
    if (!body) return res.status(404).type('text/plain').send('Not found');
    res.set('Cache-Control', cache);
    return res.type(ICONS[req.path].ico ? 'image/x-icon' : 'image/png').send(body);
  } catch (err) {
    logger.warn(`[seo] icône ${req.path} indisponible : ${err?.message}`);
    return res.status(404).type('text/plain').send('Not found');
  }
}
