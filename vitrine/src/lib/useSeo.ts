/**
 * CONSERVÉ POUR LES PAGES QUI L'APPELLENT, MAIS SANS EFFET.
 *
 * Le titre, la description, la canonique et les directives robots de chaque
 * page sont désormais composés par le backend à partir des données (voir
 * backend/src/services/seo et lib/seoHead.ts) : servis dans le HTML, puis
 * appliqués à chaque navigation. Un second auteur côté page écrasait cette
 * résolution avec des valeurs plus pauvres (titres écrits en dur, pas de
 * partage, pas de données structurées).
 */
export function useSeo(_options: { title?: string; description?: string; noindex?: boolean }) {
  void _options;
}

export default useSeo;
