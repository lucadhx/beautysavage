// RX4 — Cartes cadeaux détenues (client). Code/mot de passe masqués à l'affichage (révélation explicite).
// AUCUNE notion d'expiration (règle métier M13/RX2.6).
import { apiGet } from '../apiFetch';
import type { ClientGiftCard, ClientGiftCardDetail } from './types';

const BASE = '/api/client/gift-cards';

/** GET /api/client/gift-cards/my → cartes détenues (achetées ou reçues). */
export async function listMyGiftCards(signal?: AbortSignal): Promise<ClientGiftCard[]> {
  const res = await apiGet<{ ok: boolean; cards: ClientGiftCard[] }>(`${BASE}/my`, undefined);
  void signal;
  return res.cards ?? [];
}

/** GET /api/client/gift-cards/:id → carte + historique des transactions. */
export async function getMyGiftCard(cardId: string): Promise<ClientGiftCardDetail> {
  const res = await apiGet<{ ok: boolean } & ClientGiftCardDetail>(
    `${BASE}/${encodeURIComponent(cardId)}`,
  );
  return { card: res.card, transactions: res.transactions ?? [] };
}
