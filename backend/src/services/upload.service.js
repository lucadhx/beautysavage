/**
 * Ce module ne porte plus que la CONSTANTE du préfixe public et deux
 * délégations : l'import réel vit dans `media/projectMedia.service.js`.
 */

/**
 * On stocke un chemin RELATIF (`/uploads/<fichier>`), JAMAIS une URL absolue.
 *
 * Auparavant l'URL était figée avec `config.publicUrl` (fallback
 * `http://localhost:PORT`) au moment de l'upload → une fois déployé en HTTPS, le
 * Manager tentait de charger `http://localhost:6060/uploads/…` (Mixed Content /
 * loopback bloqué). Le chemin relatif est résolu à l'affichage : sur le VPS,
 * Nginx proxifie `/uploads/` en même origine ; en dev, le frontend préfixe avec
 * l'URL backend. Voir `manager|vitrine/src/lib/media.ts` et la migration
 * `migrate-media-urls.js` pour les données existantes.
 */
export const UPLOADS_PUBLIC_PREFIX = '/uploads';

/**
 * Process an uploaded image buffer with Sharp:
 *  - auto-rotate, resize to a sane max, convert to webp
 *  - write to /uploads and return its RELATIVE public path.
 */
/**
 * ── CES DEUX FONCTIONS NE NOMMENT PLUS LES FICHIERS ────────────────────────
 *
 * Elles produisaient `<préfixe>-<horodatage>-<aléa>.webp`. Rien, dans cette
 * adresse, ne dépendait du CONTENU : un cache ne pouvait pas savoir qu'il
 * détenait une version périmée, et rien ne rattachait le fichier à un projet.
 *
 * L'import appartient désormais à `services/media/projectMedia.service.js`,
 * qui nomme par l'empreinte du contenu et écrit un DESCRIPTEUR scopé (projet,
 * identité de projet, type métier, propriétaire, empreinte, dimensions,
 * version, auteur).
 *
 * Ces deux entrées subsistent en DÉLÉGATION : des scripts et des tests
 * antérieurs les appellent, et les supprimer d'un coup casserait des chemins
 * qui n'ont rien à voir avec ce lot. Elles ne dupliquent aucune logique.
 */
export async function processImage(buffer, { maxWidth = 1920, prefix = 'img', mediaType = null } = {}) {
  const { importProjectMedia } = await import('./media/projectMedia.service.js');
  const res = await importProjectMedia(buffer, { mediaType: mediaType ?? prefix, maxWidth });
  return { url: res.url, filename: res.filename, media: res.media };
}

/** Favicon : petit PNG carré. Retourne un chemin RELATIF. */
export async function processFavicon(buffer) {
  const { importProjectMedia } = await import('./media/projectMedia.service.js');
  const res = await importProjectMedia(buffer, { mediaType: 'favicon', format: 'png', square: true });
  return { url: res.url, filename: res.filename, media: res.media };
}
