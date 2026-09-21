/**
 * LA MENTION DE COPYRIGHT — CALCULÉE, ET VÉRIFIABLE AVANT SON ÉCHÉANCE.
 *
 * L'année se lisait déjà à l'horloge, directement dans le pied de page :
 * `© {new Date().getFullYear()}`. Correct, et invérifiable — un test ne peut
 * qu'y comparer la même horloge, et se contenter de constater qu'un nombre est
 * égal à lui-même. Une telle assertion ne tombe jamais ; elle ne protège rien.
 *
 * La règle est donc extraite ici, et la date lui est FOURNIE. On peut alors
 * demander au produit ce qu'il affichera en 2027, et le lui demander en 2026 —
 * c'est-à-dire découvrir une régression avant le 1er janvier, et non le
 * lendemain, devant les visiteurs.
 *
 * Le nom de l'entreprise vient du Panel : la vitrine ne le connaît pas à la
 * compilation, et un pied de page ne doit rien affirmer tant qu'elle ne l'a pas
 * reçu.
 */

/** L'année à afficher. `maintenant` n'est explicite que pour être éprouvé. */
export function copyrightYear(maintenant: Date = new Date()): number {
  return maintenant.getFullYear();
}

/**
 * La mention complète, ou une chaîne vide tant que le nom n'est pas connu.
 *
 * Un « © 2026 . Tous droits réservés. » orphelin est pire qu'un pied de page
 * silencieux : il affirme une propriété sans propriétaire.
 */
export function copyrightNotice(nomEntreprise?: string | null, maintenant: Date = new Date()): string {
  const nom = (nomEntreprise ?? '').trim();
  if (!nom) return '';
  return `© ${copyrightYear(maintenant)} ${nom}. Tous droits réservés.`;
}
