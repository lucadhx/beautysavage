import { CART_VERSION, CART_STORAGE_KEY, type CartItem, type CartState } from './cartTypes';

// Persistance localStorage sûre + migration de version. Version incompatible → reset propre.
export function loadCart(): CartItem[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CART_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (!parsed || parsed.version !== CART_VERSION || !Array.isArray(parsed.items)) {
      // Version/forme incompatible → on repart d'un panier vide (et on nettoie).
      saveCart([]);
      return [];
    }
    return parsed.items as CartItem[];
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const state: CartState = { version: CART_VERSION, items };
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / privacy mode : on ignore, le panier reste en mémoire */
  }
}

/** Identifiant de ligne unique (crypto si dispo, sinon fallback non-cryptographique). */
export function newLineId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `line_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
