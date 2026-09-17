// Prestations publiques. GET /api/vitrine/services (liste) + /services/:slug (détail).
import { apiFetch } from '../apiFetch';
import { rawArr } from './raw';
import { mapService } from './mappers';
import type { PublicService } from './types';

export async function getPublicServices(signal?: AbortSignal): Promise<PublicService[]> {
  const res = await apiFetch<{ ok: boolean; services?: unknown }>('/api/vitrine/services', { signal });
  return rawArr(res.services).map(mapService);
}

export async function getPublicServiceBySlug(slug: string, signal?: AbortSignal): Promise<PublicService> {
  const res = await apiFetch<{ ok: boolean; service?: unknown }>(
    `/api/vitrine/services/${encodeURIComponent(slug)}`,
    { signal },
  );
  return mapService(res.service);
}
