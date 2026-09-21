/**
 * LE NOM D'UN OBJET STOCKÉ — une seule définition, et elle fait autorité.
 *
 * ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════
 *
 * La forme d'un nom de média servait à DEUX décisions opposées, écrites à deux
 * endroits qui ne se connaissaient pas :
 *
 *   · `deleteProjectMedia` s'en servait pour REFUSER un nom qu'il ne reconnaît
 *     pas — une garde de sécurité ;
 *   · le balayage anti-orphelins aurait dû s'en servir pour RECONNAÎTRE, dans
 *     une fiche, une clé d'objet nue (un descripteur ne porte pas de chemin).
 *
 * Le second ne le faisait pas : un média désigné par son seul descripteur —
 * l'état vers lequel tout le projet converge — était invisible au relevé, donc
 * traitable comme un orphelin. Une seule définition, lue par les deux décisions.
 *
 * ══ DEUX FORMES, ET UNE SEULE EST PRODUITE AUJOURD'HUI ══════════════════════
 *
 *   ACTUELLE     `<uuid>-<12 chiffres hexadécimaux>.<ext>` — l'empreinte du
 *                contenu est DANS le nom : deux contenus différents ne peuvent
 *                pas partager une adresse.
 *   HISTORIQUE   `<préfixe>-<horodatage>-<aléa>.<ext>` — produite avant les
 *                descripteurs. Elle est encore en base ; la refuser rendrait
 *                indestructible tout ce que le projet a importé avant.
 */

/**
 * Les extensions qu'un import peut produire — voir `mediaPolicy.js`.
 *
 * Ce projet n'importe QUE des images : sa politique média ne porte aucun type
 * `document`, et `importProjectMedia` n'a pas de mode `raw`. Ajouter `pdf` ici
 * ferait reconnaître comme média un nom que rien ne peut écrire — et la garde
 * de suppression cesserait de décrire ce que ce projet produit.
 */
export const MEDIA_EXTENSIONS = Object.freeze(['webp', 'png']);

const EXT = MEDIA_EXTENSIONS.join('|');

/** La forme ACTUELLE : identité + empreinte du contenu. */
const NOM_EMPREINTE = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}\\.(${EXT})$`,
  'i',
);

/** La forme HISTORIQUE — antérieure aux descripteurs, toujours en base. */
const NOM_HISTORIQUE = new RegExp(`^[a-z0-9_-]{1,32}-\\d{10,}-\\d{1,12}\\.(${EXT})$`, 'i');

/**
 * Ce nom est-il celui d'un objet que CE projet a pu écrire ?
 *
 * La question n'est pas « ce fichier existe-t-il » mais « ce nom peut-il
 * désigner un média » : c'est une garde de forme, franchie avant toute
 * opération de disque.
 */
export function isValidMediaName(nom) {
  const valeur = String(nom ?? '');
  return NOM_EMPREINTE.test(valeur) || NOM_HISTORIQUE.test(valeur);
}

export default { MEDIA_EXTENSIONS, isValidMediaName };
