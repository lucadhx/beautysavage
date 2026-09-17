import type { CartItemKind, SelectedServiceSlot, SelectedServiceOption } from '@bs/api-client';

// Panier React LOCAL et INDICATIF. Le backend recalcule tout (prix, dispo, lock).
// v2 (RX3 S3) : ajout des lignes formation (présentiel/distanciel) → bump de version (reset propre).
export const CART_VERSION = 2;
export const CART_STORAGE_KEY = 'bs_cart';

export interface CartItemBase {
  /** Identifiant de ligne (unique, généré client). */
  lineId: string;
  kind: CartItemKind;
  refId: string; // serviceId / formationId / productId
  slug?: string;
  name: string;
  /** Prix indicatif (euros) — affichage uniquement, jamais autoritaire. */
  indicativePrice?: number;
}

export interface ServiceCartItem extends CartItemBase {
  kind: 'service';
  /** Créneau choisi (prestation datée). */
  selectedSlot?: SelectedServiceSlot;
  selectedOptions?: SelectedServiceOption[];
}

/** Formation au panier (présentiel avec session, ou distanciel accès à vie). */
export interface FormationCartItem extends CartItemBase {
  kind: 'formation';
  formationType: 'presentiel' | 'distanciel';
  /** Présentiel : session choisie (obligatoire pour l'ajout). */
  sessionId?: string;
  /** Présentiel : début de session (ISO) — affichage + revalidation disponibilité. */
  sessionStartAt?: string;
  /** Délai de remboursement (jours) — utilisé pour dériver la renonciation présentielle (backend fait foi). */
  refundDays?: number;
  selectedOptions?: SelectedServiceOption[];
}

export type CartItem = ServiceCartItem | FormationCartItem | CartItemBase;

/** Garde de type : ligne formation. */
export function isFormationItem(item: CartItem): item is FormationCartItem {
  return item.kind === 'formation';
}

/** Garde de type : ligne prestation. */
export function isServiceItem(item: CartItem): item is ServiceCartItem {
  return item.kind === 'service';
}

export interface CartState {
  version: number;
  items: CartItem[];
}

export interface CartSummary {
  count: number;
  /** Total INDICATIF (euros), somme des prix indicatifs. Le backend fait foi. */
  indicativeTotal: number;
}
