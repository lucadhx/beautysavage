// RX3 S3 — Validation d'une carte cadeau AU CHECKOUT (moyen de paiement). Distinct de client/giftCards.ts
// (RX4, cartes possédées). Endpoints : POST /api/client/gift-cards/validate[-credentials]. Auth requise.
import { apiFetch } from '../apiFetch';
import type { GiftCardValidation } from './types';

interface RawCard {
  id?: string;
  code?: string;
  availableBalance?: number;
  balance?: number;
  status?: string;
  hasPassword?: boolean;
}

function mapCard(card: RawCard | undefined): GiftCardValidation {
  return {
    id: String(card?.id ?? ''),
    code: String(card?.code ?? ''),
    availableBalance: Math.max(0, Number(card?.availableBalance ?? card?.balance ?? 0)),
    status: String(card?.status ?? ''),
    hasPassword: Boolean(card?.hasPassword),
  };
}

/** Valide un code de carte cadeau → carte + solde disponible. Lève ApiError si invalide/inactive/401. */
export async function validateGiftCard(code: string, signal?: AbortSignal): Promise<GiftCardValidation> {
  const res = await apiFetch<{ ok?: boolean; card?: RawCard }>('/api/client/gift-cards/validate', {
    method: 'POST',
    body: { code: code.trim().toUpperCase() },
    signal,
  });
  return mapCard(res.card);
}

/** Valide code + mot de passe (carte protégée) → carte + solde. */
export async function validateGiftCardCredentials(
  code: string,
  password: string,
  signal?: AbortSignal,
): Promise<GiftCardValidation> {
  const res = await apiFetch<{ ok?: boolean; card?: RawCard }>('/api/client/gift-cards/validate-credentials', {
    method: 'POST',
    body: { code: code.trim().toUpperCase(), password },
    signal,
  });
  return mapCard(res.card);
}
