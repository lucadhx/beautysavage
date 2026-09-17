import { useQuery } from '@tanstack/react-query';
import { getPublicGiftCardConfig } from '@bs/api-client';

// La carte cadeau publique = config seule (montant min, description, image). Pas de liste/détail.
export function usePublicGiftCards() {
  return useQuery({
    queryKey: ['catalog', 'gift-cards'],
    queryFn: ({ signal }) => getPublicGiftCardConfig(signal),
  });
}
