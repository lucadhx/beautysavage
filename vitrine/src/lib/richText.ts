/**
 * LES DESCRIPTIONS RICHES DU MANAGER, LUES PAR LA VITRINE.
 *
 * L'éditeur de description du Manager enregistre du HTML (gras, italique,
 * souligné, listes, paragraphes). Un texte collé depuis un traitement de
 * texte y apporte en plus ses polices, tailles et marges en `style=""`.
 *
 * La vitrine garde la MISE EN FORME — gras, italique, souligné, listes,
 * paragraphes, liens — et laisse tomber la PRÉSENTATION du logiciel d'origine
 * (Times New Roman 12 px, marges) : le texte prend la typographie du site.
 * Un gras exprimé par `font-weight: bold` sur un <span> reste un gras.
 *
 * Rien n'est réécrit en base : on nettoie au moment d'afficher. Une ancienne
 * description en texte brut (sans balise) s'affiche telle quelle, retours à
 * la ligne compris.
 */

const BLOCKS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H2', 'H3', 'H4']);
const INLINE = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'S', 'BR', 'A', 'SPAN', 'FONT']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'svg', 'SVG']);
const RENAME: Record<string, string> = { B: 'strong', I: 'em', H1: 'h2', H5: 'h4', H6: 'h4' };

/** Contient au moins une balise HTML ? Sinon c'est un texte brut. */
export function isHtml(value?: string) {
  return /<[a-z][\s\S]*>/i.test(value || '');
}

function safeHref(href: string) {
  const value = href.trim();
  return /^(https?:|mailto:|tel:|\/|#)/i.test(value) ? value : '';
}

/** Le gras / italique / souligné qu'un `style` exprime, à reporter en balises. */
function styleMarks(el: Element) {
  const style = (el.getAttribute('style') || '').toLowerCase();
  const weight = /font-weight\s*:\s*(bold|bolder|[6-9]00)/.test(style);
  const italic = /font-style\s*:\s*italic/.test(style);
  const underline = /text-decoration[a-z-]*\s*:[^;]*underline/.test(style);
  return { weight, italic, underline };
}

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent || '')];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP_WITH_CONTENT.has(tag) || DROP_WITH_CONTENT.has(el.tagName)) return [];

  const children = Array.from(el.childNodes).flatMap((child) => cleanNode(child, doc));
  const mapped = RENAME[tag] || (BLOCKS.has(tag) || INLINE.has(tag) ? tag.toLowerCase() : '');

  // Balise inconnue ou purement décorative : on garde son contenu, pas elle.
  let out: Node[];
  if (!mapped || mapped === 'span' || mapped === 'font') {
    out = children;
  } else {
    const clean = doc.createElement(mapped);
    if (mapped === 'a') {
      const href = safeHref(el.getAttribute('href') || '');
      if (!href) return children;
      clean.setAttribute('href', href);
      if (/^https?:/i.test(href)) {
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }
    children.forEach((child) => clean.appendChild(child));
    out = [clean];
  }

  // Le gras d'un <span style="font-weight: bold"> reste un gras.
  const marks = styleMarks(el);
  const wrap = (nodes: Node[], name: string) => {
    if (!nodes.length) return nodes;
    const w = doc.createElement(name);
    nodes.forEach((n) => w.appendChild(n));
    return [w];
  };
  const inlineTarget = !BLOCKS.has(tag);
  if (inlineTarget) {
    if (marks.underline && mapped !== 'u') out = wrap(out, 'u');
    if (marks.italic && mapped !== 'em') out = wrap(out, 'em');
    if (marks.weight && mapped !== 'strong') out = wrap(out, 'strong');
  } else if (out.length === 1 && (marks.weight || marks.italic || marks.underline)) {
    // Bloc entièrement en gras : on enveloppe son contenu, le bloc reste un bloc.
    const block = out[0] as Element;
    let inner: Node[] = Array.from(block.childNodes);
    if (marks.underline) inner = wrap(inner, 'u');
    if (marks.italic) inner = wrap(inner, 'em');
    if (marks.weight) inner = wrap(inner, 'strong');
    inner.forEach((n) => block.appendChild(n));
  }
  return out;
}

/** Le HTML de la description, nettoyé : balises de mise en forme seulement, sans styles. */
export function sanitizeRichText(html: string) {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = doc.createElement('div');
  Array.from(doc.body.childNodes).flatMap((n) => cleanNode(n, doc)).forEach((n) => out.appendChild(n));
  // Paragraphes vides laissés par le copier-coller (hors ceux qui ne portent qu'un saut de ligne voulu).
  out.querySelectorAll('p, div, li').forEach((el) => {
    if (!el.textContent?.replace(/ /g, ' ').trim() && !el.querySelector('br')) el.remove();
  });
  return out.innerHTML;
}

/** La description en texte simple : cartes du catalogue, recherche, aperçus. */
export function richTextToPlain(value?: string) {
  const raw = value || '';
  if (!isHtml(raw)) return raw;
  if (typeof DOMParser === 'undefined') return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(
    `<body>${raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '</$1>\n')}</body>`,
    'text/html',
  );
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  return (doc.body.textContent || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
