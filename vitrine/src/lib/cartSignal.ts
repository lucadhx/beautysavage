/**
 * LE PANIER, VU DE LA BARRE DE NAVIGATION — un signal minimal : le nombre
 * d'articles, publié par quiconque modifie le panier, et une animation
 * « l'article vole jusqu'au panier » qui part de l'élément cliqué.
 */
const EVENT = 'vitrine:cart';

export type CartSignal = { count: number; bump?: boolean };

export function publishCartCount(count: number, bump = false) {
  window.dispatchEvent(new CustomEvent<CartSignal>(EVENT, { detail: { count, bump } }));
}

export function onCartCount(listener: (signal: CartSignal) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<CartSignal>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** L'icône panier visible (la barre a une version bureau et une version téléphone). */
function visibleCartTarget(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-target]'));
  return all.find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0) || null;
}

/**
 * Fait voler une vignette (ou une pastille) de `from` jusqu'à l'icône panier.
 * Sans icône visible ou avec « réduire les animations », on s'abstient.
 */
export function flyToCart(from: HTMLElement | null, imageUrl?: string): Promise<void> {
  const target = visibleCartTarget();
  if (!from || !target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const size = 56;
  const ghost = document.createElement(imageUrl ? 'img' : 'span');
  if (imageUrl && ghost instanceof HTMLImageElement) { ghost.src = imageUrl; ghost.alt = ''; }
  Object.assign(ghost.style, {
    position: 'fixed', zIndex: '80', pointerEvents: 'none', width: `${size}px`, height: `${size}px`,
    left: `${a.left + a.width / 2 - size / 2}px`, top: `${a.top + a.height / 2 - size / 2}px`,
    borderRadius: '9999px', objectFit: 'cover', background: 'var(--v-primary)',
    boxShadow: '0 10px 30px rgba(0,0,0,.25)', border: '2px solid var(--v-surface, #fff)',
  });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 80}px) scale(.8)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.4 },
  ], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' });
  return anim.finished.then(() => { ghost.remove(); }, () => { ghost.remove(); });
}
