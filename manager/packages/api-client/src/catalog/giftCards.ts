// Carte cadeau publique : configuration seule (pas de liste/détail). GET /api/vitrine/gift-cards.
import { apiFetch } from '../apiFetch';
import { mapGiftCardConfig } from './mappers';
import type { PublicGiftCardConfig } from './types';

export async function getPublicGiftCardConfig(signal?: AbortSignal): Promise<PublicGiftCardConfig> {
  const res = await apiFetch<{ ok: boolean; config?: unknown }>('/api/vitrine/gift-cards', { signal });
  return mapGiftCardConfig(res.config);
}
