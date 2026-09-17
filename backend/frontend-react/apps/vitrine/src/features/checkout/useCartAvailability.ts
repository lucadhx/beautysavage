// RX3 S3 — Disponibilité dynamique du panier. Revalide les SESSIONS présentielles (réutilise l'endpoint
// existant getFormationSessions ; aucun nouveau calendrier). Distanciel = toujours disponible. En cas
// d'erreur réseau, on NE bloque pas (optimiste) — le backend reste l'autorité au paiement.
import { useQueries } from '@tanstack/react-query';
import { getFormationSessions } from '@bs/api-client';
import type { CartItem } from '../cart/cartTypes';
import { isFormationItem } from '../cart/cartTypes';

export interface ItemAvailability {
  available: boolean;
  loading: boolean;
  reason?: string;
}

export function useCartAvailability(items: CartItem[]): Record<string, ItemAvailability> {
  const presentielIds = [
    ...new Set(
      items
        .filter(isFormationItem)
        .filter((f) => f.formationType === 'presentiel' && f.sessionId)
        .map((f) => f.refId),
    ),
  ];

  const queries = useQueries({
    queries: presentielIds.map((fid) => ({
      queryKey: ['formation', 'sessions', fid],
      queryFn: ({ signal }: { signal: AbortSignal }) => getFormationSessions(fid, signal),
      staleTime: 15_000,
    })),
  });
  const byFormation = new Map(presentielIds.map((fid, i) => [fid, queries[i]]));

  const result: Record<string, ItemAvailability> = {};
  for (const it of items) {
    if (!isFormationItem(it) || it.formationType === 'distanciel') {
      result[it.lineId] = { available: true, loading: false };
      continue;
    }
    const q = byFormation.get(it.refId);
    if (!q || q.isPending) {
      result[it.lineId] = { available: true, loading: true };
      continue;
    }
    if (q.isError) {
      result[it.lineId] = { available: true, loading: false }; // optimiste : le backend tranchera
      continue;
    }
    const session = (q.data ?? []).find((s) => s.id === it.sessionId);
    if (!session || session.isCanceled) {
      result[it.lineId] = { available: false, loading: false, reason: 'Cette session n’est plus disponible.' };
    } else if (session.placesRemaining <= 0 || !session.isAvailable) {
      result[it.lineId] = { available: false, loading: false, reason: 'Cette session n’a plus de place.' };
    } else {
      result[it.lineId] = { available: true, loading: false };
    }
  }
  return result;
}
