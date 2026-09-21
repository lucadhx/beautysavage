/**
 * Conversion CENTRALISÉE et ÉPROUVÉE des zones de signature (ratios de page)
 * vers le système de coordonnées de la plateforme (points PDF).
 *
 * ══ CE QUI ÉTAIT UNE HYPOTHÈSE EST DEVENU UNE MESURE ═══════════════════
 *
 * Ce fichier portait un avertissement : l'origine du repère et la base
 * d'indexation des pages n'étaient pas documentées par le fournisseur, et la
 * conversion reposait sur une « hypothèse à confirmer en bac à sable ». C'est
 * le genre de dette qui ne coûte rien jusqu'au jour où une signature atterrit
 * à dix centimètres de sa ligne, sur un contrat déjà signé.
 *
 * Elle a été mesurée, quatre fois et par des chemins indépendants :
 *
 *   · les widgets incrustés par le fournisseur dans le PDF stocké ;
 *   · l'enregistrement brut côté fournisseur ;
 *   · le DOM de son client de signature (facteur 1,27731 = 760 px / 595 pt) ;
 *   · la position de l'encre dans le PDF SIGNÉ, écart 0 point.
 *
 * Verdict, sans hypothèse restante :
 *
 *   · origine  = coin SUPÉRIEUR GAUCHE, comme l'éditeur de zones ;
 *   · pages    = 1-indexées, comme nos zones ;
 *   · unité    = le POINT PDF (rendu @72 dpi), pas un pixel d'aperçu.
 *
 * Le paramétrage reste : c'est ce qui a permis de mesurer plutôt que de
 * deviner, et ce qui permettra de mesurer le prochain fournisseur sans
 * réécrire la conversion.
 *
 * Recettes : `Panel/tools/opensign/measureCoordinates.js`,
 * `signInBrowser.js`, `editorWidgetRecipe.js`.
 */

export const COORDINATE_CONFIG = Object.freeze({
  /** MESURÉ : le fournisseur compte depuis le haut, comme l'éditeur. */
  origin: 'top-left', // 'top-left' | 'bottom-left'
  /** MESURÉ : page 1 = première page, des deux côtés. */
  pageIndexBase: 1,
});

/**
 * Bornes de taille d'une zone de signature, en points.
 *
 * ⚠️ Ce sont les bornes DE CE PROJET, héritées du fournisseur précédent et
 * conservées telles quelles : elles sont conservatrices, et une zone plus
 * petite serait de toute façon illisible sur un contrat imprimé.
 *
 * L'AUTORITÉ est la plateforme, qui tranche à l'ouverture. Ces bornes ne sont
 * qu'une politesse pour l'éditeur : refuser ici évite un aller-retour, mais un
 * désaccord entre les deux se règle toujours en faveur du Panel.
 */
export const SIGNATURE_SIZE = Object.freeze({
  minWidth: 85,
  maxWidth: 2000,
  minHeight: 37,
  maxHeight: 1000,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convertit une zone (ratios) en champ Yousign (pixels) pour une page donnée.
 * @param {object} zone { page, xRatio, yRatio, widthRatio, heightRatio, type }
 * @param {object} pageSize { width, height } en points (= pixels @72dpi)
 * @param {object} [cfg] override de COORDINATE_CONFIG
 * @returns {{ page:number, x:number, y:number, width:number, height:number }}
 */
export function mapZoneToField(zone, pageSize, cfg = COORDINATE_CONFIG) {
  if (!pageSize || !pageSize.width || !pageSize.height) {
    throw new Error(`Dimensions de page manquantes pour la page ${zone.page}.`);
  }
  const pw = pageSize.width;
  const ph = pageSize.height;

  let width = Math.round(zone.widthRatio * pw);
  let height = Math.round(zone.heightRatio * ph);
  // Respect des bornes Yousign pour une signature.
  width = clamp(width, SIGNATURE_SIZE.minWidth, SIGNATURE_SIZE.maxWidth);
  height = clamp(height, SIGNATURE_SIZE.minHeight, SIGNATURE_SIZE.maxHeight);

  const x = Math.round(zone.xRatio * pw);
  let y;
  if (cfg.origin === 'bottom-left') {
    // Origine PDF classique : y mesuré depuis le bas. yRatio est depuis le haut.
    y = Math.round((1 - zone.yRatio) * ph - height);
  } else {
    // Origine haut-gauche (défaut) : y mesuré depuis le haut.
    y = Math.round(zone.yRatio * ph);
  }

  return {
    page: zone.page - 1 + cfg.pageIndexBase, // 1-indexé interne -> base configurée
    x: clamp(x, 0, Math.round(pw)),
    y: clamp(y, 0, Math.round(ph)),
    width,
    height,
  };
}

/**
 * Valide un ensemble de zones contre les pages du document (utilisé avant la
 * validation du contrat ET avant l'envoi Yousign). Renvoie la liste d'erreurs.
 */
export function validateZones(zones, { pageCount, signerRolesPresent } = {}) {
  const errors = [];
  if (!Array.isArray(zones) || zones.length === 0) {
    errors.push('Au moins une zone de signature est requise.');
    return errors;
  }
  for (const z of zones) {
    if (!z.page || z.page < 1 || (pageCount && z.page > pageCount)) {
      errors.push(`Zone "${z.name || z.id}" sur une page inexistante (${z.page}).`);
    }
    const within = (v) => typeof v === 'number' && v >= 0 && v <= 1;
    if (![z.xRatio, z.yRatio, z.widthRatio, z.heightRatio].every(within)) {
      errors.push(`Zone "${z.name || z.id}" hors page (ratios invalides).`);
    }
    if (!(z.widthRatio > 0) || !(z.heightRatio > 0)) {
      errors.push(`Zone "${z.name || z.id}" de taille nulle.`);
    }
    if (z.xRatio + z.widthRatio > 1.0001 || z.yRatio + z.heightRatio > 1.0001) {
      errors.push(`Zone "${z.name || z.id}" dépasse les bords de la page.`);
    }
  }
  // Au moins une zone par signataire requis (DEVELOPER + CLIENT).
  const roles = new Set(zones.map((z) => z.signerRole));
  if (signerRolesPresent) {
    for (const role of signerRolesPresent) {
      if (!roles.has(role)) errors.push(`Aucune zone pour le signataire ${role}.`);
    }
  }
  return errors;
}

export default { mapZoneToField, validateZones, COORDINATE_CONFIG, SIGNATURE_SIZE };
