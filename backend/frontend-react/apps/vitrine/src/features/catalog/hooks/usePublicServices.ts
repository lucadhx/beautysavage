import { useQuery } from '@tanstack/react-query';
import { getPublicServices, getPublicServiceBySlug } from '@bs/api-client';

export function usePublicServices() {
  return useQuery({
    queryKey: ['catalog', 'services'],
    queryFn: ({ signal }) => getPublicServices(signal),
  });
}

export function usePublicService(slug: string | undefined) {
  return useQuery({
    queryKey: ['catalog', 'service', slug],
    queryFn: ({ signal }) => getPublicServiceBySlug(slug as string, signal),
    enabled: Boolean(slug),
  });
}
