import { useQuery } from '@tanstack/react-query';
import { getPublicSiteStatus } from '@bs/api-client';

// Statut site (best-effort) : ne bloque jamais l'app si l'appel échoue (retry:0, pas de throw exploité).
export function useSiteStatus() {
  return useQuery({
    queryKey: ['site-status'],
    queryFn: ({ signal }) => getPublicSiteStatus(signal),
    retry: false,
    staleTime: 30_000,
  });
}
