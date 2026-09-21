/**
 * POLITIQUE D'IMPORT DES MÉDIAS — une seule table, et elle fait autorité.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Les limites d'upload vivaient à quatre endroits qui ne se parlaient pas :
 *
 *   · `multer` — 12 Mo, en dur dans un middleware ;
 *   · le générateur Nginx — RIEN, donc le défaut du serveur : 1 Mo ;
 *   · le frontend — aucune limite ;
 *   · le traitement d'image — des `maxWidth`/`format` passés au cas par cas
 *     par chaque appelant.
 *
 * Conséquence mesurée en production : un logo de 3 Mo passait en local (Express
 * seul, 12 Mo) et repartait en **413 derrière Nginx** (1 Mo). Le même fichier,
 * accepté ici, refusé là — et l'écart de 12× n'était écrit nulle part.
 *
 * ══ CE QUE LA TABLE DÉCIDE ══════════════════════════════════════════════════
 *
 * Pour CHAQUE type métier : ce qu'on accepte à l'entrée, et ce qu'on écrit à la
 * sortie. Le reste du code ne choisit plus rien — il demande.
 *
 * ══ POURQUOI CES VALEURS ════════════════════════════════════════════════════
 *
 * Elles viennent de l'usage, pas d'un chiffre rond. Une photo de téléphone
 * moderne pèse 3 à 8 Mo ; un logo exporté en PNG depuis un outil de design
 * dépasse couramment 10 Mo. Le produit ne doit pas demander à un garagiste de
 * compresser son logo avant de l'importer — c'est précisément le travail que
 * `sharp` fait ensuite, et il le fait mieux.
 *
 * La SORTIE, elle, est normalisée : on ne conserve jamais le fichier d'entrée.
 * Un logo de 12 Mo devient un WebP de quelques dizaines de kilo-octets.
 */

/** Formats d'image réellement acceptés — vérifiés sur les OCTETS, pas sur le nom. */
export const ACCEPTED_IMAGE_FORMATS = Object.freeze([
  'jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'svg',
]);

/**
 * LA POLITIQUE PAR TYPE MÉTIER.
 *
 * `maxInputBytes` borne ce que l'utilisateur a le droit d'ENVOYER.
 * `maxWidth` / `square` / `format` décrivent ce qu'on ÉCRIT.
 */
export const MEDIA_POLICIES = Object.freeze({
  'company-logo': { maxInputBytes: 12 * 1024 * 1024, maxWidth: 1024, format: 'webp' },
  'company-favicon': { maxInputBytes: 4 * 1024 * 1024, square: true, format: 'png' },
  hero: { maxInputBytes: 15 * 1024 * 1024, maxWidth: 2560, format: 'webp' },
  /**
   * ── L'IMAGE D'UN CHAPITRE ─────────────────────────────────────────────────
   *
   * Un chapitre du récit L.Y — Conception, Architecture, L'Expérience — porte
   * une image de tête PLEINE LARGEUR, lue sur un fond noir profond. D'où
   * `maxWidth` aligné sur celui du hero, et non sur celui d'une vignette : une
   * image redimensionnée à 1600 px puis étalée sur 2560 se voit.
   */
  'chapter-image': { maxInputBytes: 15 * 1024 * 1024, maxWidth: 2560, format: 'webp' },
  'gallery-image': { maxInputBytes: 15 * 1024 * 1024, maxWidth: 1920, format: 'webp' },
  'team-photo': { maxInputBytes: 8 * 1024 * 1024, maxWidth: 800, format: 'webp' },
  'page-image': { maxInputBytes: 15 * 1024 * 1024, maxWidth: 1920, format: 'webp' },
  'commerce-cover': { maxInputBytes: 15 * 1024 * 1024, maxWidth: 1600, format: 'webp' },
  'training-deliverable': { maxInputBytes: 120 * 1024 * 1024, maxWidth: 1920, format: 'webp' },
});

/** Repli d'un type non listé — jamais plus permissif que le plus permissif. */
const DEFAUT = Object.freeze({ maxInputBytes: 8 * 1024 * 1024, maxWidth: 1920, format: 'webp' });

export function policyFor(mediaType) {
  return MEDIA_POLICIES[mediaType] ?? DEFAUT;
}

/**
 * LE PLAFOND DE TRANSPORT — le plus permissif de la table.
 *
 * C'est lui, et lui seul, qui borne `multer`. Borner au type demandé serait
 * séduisant mais faux : `multer` coupe le flux AVANT que le corps ne soit lu,
 * donc avant qu'on sache de quel type il s'agit. On laisse donc entrer jusqu'au
 * plafond, puis on refuse par type — avec un message qui nomme la bonne limite.
 */
export const MAX_INPUT_BYTES = Math.max(
  ...Object.values(MEDIA_POLICIES).map((p) => p.maxInputBytes),
);

/**
 * CE QUE LA COUCHE HTTP DOIT LAISSER PASSER.
 *
 * Un envoi `multipart/form-data` transporte plus que le fichier : frontières,
 * en-têtes de partie, nom de fichier, parfois d'autres champs. Aligner Nginx
 * sur `MAX_INPUT_BYTES` au kilo-octet près ferait donc refuser, par le serveur
 * web, un fichier que l'application accepte — et le refus serait un 413 nu,
 * sans code métier, puisqu'il n'atteindrait jamais Node.
 *
 * La marge est délibérément généreuse : elle ne coûte rien (le fichier est
 * refusé ensuite, proprement, avec sa raison) et elle garantit que la
 * DÉCISION appartient toujours à l'application.
 */
export const HTTP_BODY_LIMIT_BYTES = MAX_INPUT_BYTES + 4 * 1024 * 1024;

/** La même valeur, en mégaoctets entiers — l'unité qu'écrit Nginx. */
export const HTTP_BODY_LIMIT_MB = Math.ceil(HTTP_BODY_LIMIT_BYTES / (1024 * 1024));

/** Lisible par un humain : « 12 Mo », jamais « 12582912 ». */
export function humanBytes(bytes) {
  const mo = bytes / (1024 * 1024);
  return `${Number.isInteger(mo) ? mo : mo.toFixed(1)} Mo`;
}

export default {
  MEDIA_POLICIES,
  ACCEPTED_IMAGE_FORMATS,
  policyFor,
  MAX_INPUT_BYTES,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_BODY_LIMIT_MB,
  humanBytes,
};
