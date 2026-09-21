/**
 * TEXTE RICHE ÉDITÉ DEPUIS LE MANAGER — assaini AU SERVEUR, jamais ailleurs.
 *
 * ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════
 *
 * L'éditeur de page rend du HTML, et la vitrine l'affiche. Entre les deux, il
 * n'y a qu'une seule frontière de confiance qui compte : celle-ci. Un
 * nettoyage fait dans le navigateur ne protège de rien — l'API accepte
 * n'importe quel corps, et un appel direct court-circuite l'éditeur.
 *
 * Le HTML est donc réécrit ICI, à l'écriture, et ce qui est stocké est déjà
 * sûr. La vitrine peut alors l'injecter sans se poser la question, et sans
 * embarquer une seconde bibliothèque qui divergerait de celle-ci.
 *
 * ══ UNE LISTE BLANCHE, ET RIEN D'AUTRE ══════════════════════════════════════
 *
 * On n'essaie PAS de reconnaître ce qui est dangereux : la liste des attaques
 * est ouverte, celle des balises utiles ne l'est pas. Tout ce qui n'est pas
 * nommé ci-dessous disparaît — balise comme attribut.
 *
 * Conséquence assumée : un collage depuis Word perd ses `style`, ses `class`
 * et ses `<font>`. C'est voulu. Le style d'une page appartient au THÈME, pas
 * au presse-papier de la personne qui rédige — sans quoi une page finit en
 * Times New Roman noir sur un site rouge et noir.
 */

/** Les balises conservées. Tout le reste est retiré (le TEXTE, lui, reste). */
const BALISES_AUTORISEES = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'mark',
  'ul', 'ol', 'li',
  'h2', 'h3', 'h4',
  'blockquote', 'a', 'span',
]);

/**
 * Les balises dont le CONTENU disparaît avec elles.
 *
 * Retirer `<script>` en gardant son texte laisserait le code source du script
 * s'afficher en clair au milieu d'un paragraphe — et, dans le cas d'un
 * `<style>`, réintroduirait exactement la mise en forme qu'on vient d'écarter.
 */
const BALISES_VIDEES = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

/** Les seuls attributs qui survivent, et seulement là où ils ont un sens. */
const ATTRIBUTS_AUTORISES = {
  a: new Set(['href', 'title']),
};

/** Un lien ne peut mener qu'à ces protocoles — jamais `javascript:` ni `data:`. */
const PROTOCOLES_AUTORISES = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

const echapper = (texte) => String(texte)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Les attributs d'une balise ouvrante, filtrés par la liste blanche.
 *
 * Les gestionnaires d'évènement (`onclick`, `onerror`…) ne sont pas « retirés »
 * par une règle qui les nomme : ils ne sont simplement JAMAIS dans la liste.
 * C'est la différence entre une liste blanche et une liste noire, et c'est
 * toute la raison de ce module.
 */
function attributsRetenus(balise, brut) {
  const permis = ATTRIBUTS_AUTORISES[balise];
  if (!permis || !brut) return '';

  const sortie = [];
  const motif = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = motif.exec(brut)) !== null) {
    const nom = m[1].toLowerCase();
    if (!permis.has(nom)) continue;
    const valeur = m[3] ?? m[4] ?? '';
    if (nom === 'href' && !PROTOCOLES_AUTORISES.test(valeur.trim())) continue;
    sortie.push(`${nom}="${echapper(valeur.trim())}"`);
  }

  /**
   * UN LIEN SORTANT S'OUVRE AILLEURS, ET SANS PRÊTER L'ONGLET.
   *
   * `rel` est posé par le serveur, jamais lu depuis l'entrée : c'est une
   * garantie, pas une préférence de rédaction.
   */
  if (balise === 'a' && sortie.some((a) => a.startsWith('href="http'))) {
    sortie.push('target="_blank"', 'rel="noopener noreferrer"');
  }
  return sortie.length ? ` ${sortie.join(' ')}` : '';
}

/**
 * ASSAINIT UN FRAGMENT HTML. Rend une chaîne sûre à injecter telle quelle.
 *
 * @param {unknown} html
 * @param {object} [opts]
 * @param {number} [opts.maxLength] borne de taille, appliquée APRÈS nettoyage
 * @returns {string}
 */
export function sanitizeRichText(html, { maxLength = 40000 } = {}) {
  if (html === null || html === undefined) return '';
  let texte = String(html);
  if (!texte.trim()) return '';

  // 1. Les balises dont le contenu part avec elles, commentaires compris.
  texte = texte.replace(BALISES_VIDEES, '').replace(/<!--[\s\S]*?-->/g, '');
  // Une ouverture non refermée (`<script>` en fin de fragment) ne doit pas
  // survivre au filtre balise-par-balise ci-dessous : elle y passerait pour
  // une balise inconnue, donc simplement retirée — mais son contenu resterait.
  texte = texte.replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*$/gi, '');

  // 2. Chaque balise est réécrite depuis la liste blanche, ou effacée.
  texte = texte.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g,
    (_tout, fermante, nomBrut, attributs, autoFermante) => {
      const nom = nomBrut.toLowerCase();
      if (!BALISES_AUTORISEES.has(nom)) return '';
      if (fermante) return `</${nom}>`;
      if (nom === 'br') return '<br />';
      return `<${nom}${attributsRetenus(nom, attributs)}${autoFermante ? ' /' : ''}>`;
    });

  // 3. Tout `<` restant est du TEXTE que l'auteur a écrit : on l'échappe.
  texte = texte.replace(/<(?!\/?(?:[a-zA-Z][a-zA-Z0-9]*)(?:\s|\/?>))/g, '&lt;');

  return texte.trim().slice(0, maxLength);
}

/**
 * Le texte NU d'un fragment — pour un résumé, une méta-description, un extrait.
 *
 * Passe par l'assainissement d'abord : une extraction faite sur l'entrée brute
 * rendrait le contenu d'un `<script>` sous forme de phrase.
 */
export function richTextToPlain(html, { maxLength = 300 } = {}) {
  const propre = sanitizeRichText(html);
  const nu = propre
    .replace(/<\/(p|li|h[2-4]|blockquote)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return nu.length > maxLength ? `${nu.slice(0, maxLength - 1).trimEnd()}…` : nu;
}

export default { sanitizeRichText, richTextToPlain };
