// Identité du site (manager, admin+dev) : nom de l'institut + logo (URL ou upload).
// Endpoints /api/gestion/site-identity (guard requireDev = admin+dev). Le backend reste l'autorité.
import { apiGet, apiPut, apiUpload } from '../apiFetch';

export interface ManagerSiteIdentity {
  siteName: string;
  logoType: 'url' | 'upload' | null;
  logoUrl: string | null;
  logoPath: string | null;
  logoUrlResolved: string | null;
  updatedAt: string | null;
}

function mapIdentity(raw: unknown): ManagerSiteIdentity {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    siteName: String(r.siteName ?? '') || 'Beauty Savage',
    logoType: (r.logoType as ManagerSiteIdentity['logoType']) ?? null,
    logoUrl: (r.logoUrl as string) ?? null,
    logoPath: (r.logoPath as string) ?? null,
    logoUrlResolved: (r.logoUrlResolved as string) ?? (r.logoUrl as string) ?? null,
    updatedAt: (r.updatedAt as string) ?? null,
  };
}

/** GET /api/gestion/site-identity — nom + logo actuels. */
export async function getManagerSiteIdentity(signal?: AbortSignal): Promise<ManagerSiteIdentity> {
  void signal;
  const res = await apiGet<{ ok: boolean; identity?: unknown }>('/api/gestion/site-identity', undefined);
  return mapIdentity(res.identity);
}

export interface TempLogoResult { tempLogoId: string; tempLogoUrl: string; }

/** POST /api/gestion/site-identity/temp-logo — upload d'un logo temporaire (champ `logo`). */
export async function uploadTempSiteLogo(file: File): Promise<TempLogoResult> {
  const fd = new FormData();
  fd.append('logo', file);
  const res = await apiUpload<{ ok: boolean; tempLogoId: string; tempLogoUrl: string }>('/api/gestion/site-identity/temp-logo', fd);
  return { tempLogoId: res.tempLogoId, tempLogoUrl: res.tempLogoUrl };
}

export interface SaveSiteIdentityInput {
  siteName: string;
  logoType: 'url' | 'upload' | null;
  logoUrl?: string | null;
  /** Id d'un logo temporaire uploadé à confirmer (si logoType === 'upload'). */
  tempLogoId?: string | null;
}

/** PUT /api/gestion/site-identity — enregistre nom + logo. */
export async function saveSiteIdentity(input: SaveSiteIdentityInput): Promise<ManagerSiteIdentity> {
  const res = await apiPut<{ ok: boolean; identity?: unknown }>('/api/gestion/site-identity', input);
  return mapIdentity(res.identity);
}
