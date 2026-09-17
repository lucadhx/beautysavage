// Statut public du site. GET /api/site-status (blocage maintenance / suspension).
import { apiFetch } from '../apiFetch';
import { mapSiteStatus } from './mappers';
import type { PublicSiteStatus } from './types';

export async function getPublicSiteStatus(signal?: AbortSignal): Promise<PublicSiteStatus> {
  const res = await apiFetch<unknown>('/api/site-status', { signal });
  return mapSiteStatus(res);
}
