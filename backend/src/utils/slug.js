/** Turn a title into a URL-safe slug. */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * UN SLUG LIBRE DANS UNE COLLECTION — dérivé, jamais saisi.
 *
 * ══ POURQUOI CETTE FONCTION EST PARTAGÉE ════════════════════════════════════
 *
 * `service.controller.js` portait sa propre version, en local. Trois
 * collections l'ont réclamée ensuite — karts, tracés, pages éditoriales — et
 * trois copies auraient divergé sur le détail qui compte : le suffixe de
 * désambiguïsation. Une copie qui rendrait `-2` là où une autre rend `-1`
 * produirait, sur un même site, deux règles d'URL pour deux écrans voisins.
 *
 * ══ CE QU'ELLE GARANTIT ═════════════════════════════════════════════════════
 *
 * Le slug rendu n'est pris par aucun autre document de `Model` — `excludeId`
 * mis à part, sans quoi renommer un document en gardant son titre lui
 * ajouterait un suffixe à chaque enregistrement.
 *
 * @param {import('mongoose').Model} Model
 * @param {string} text      le titre dont le slug dérive
 * @param {string|null} excludeId  le document en cours de modification
 * @param {string} fallback  quand le titre ne donne aucun caractère utile
 */
export async function uniqueSlug(Model, text, excludeId = null, fallback = 'element') {
  const base = slugify(text) || fallback;
  let slug = base;
  let i = 2;
  const pris = async (candidat) => Model.exists({
    slug: candidat,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  // eslint-disable-next-line no-await-in-loop
  while (await pris(slug)) {
    slug = `${base}-${i}`;
    i += 1;
  }
  return slug;
}
