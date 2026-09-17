// Réglages d'accueil (manager, admin+dev). FAQ générale + bannière/slogan de la page d'accueil.
// Le PUT est PARTIEL — le backend conserve les champs non transmis.
import { apiGet, apiPut, apiUpload } from '../apiFetch';

export interface HomeFaqItem {
  question: string;
  answer: string;
}

function mapFaq(value: unknown): HomeFaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return { question: String(r.question ?? '').trim(), answer: String(r.answer ?? '').trim() };
    })
    .filter((f) => f.question && f.answer);
}

/** GET /api/gestion/home-settings — renvoie la FAQ générale actuelle. */
export async function getHomeFaq(signal?: AbortSignal): Promise<HomeFaqItem[]> {
  const res = await apiGet<{ ok: boolean; settings?: { faq?: unknown } }>('/api/gestion/home-settings', undefined);
  void signal;
  return mapFaq(res.settings?.faq);
}

/** PUT /api/gestion/home-settings — met à jour uniquement la FAQ générale. */
export async function saveHomeFaq(faq: HomeFaqItem[]): Promise<HomeFaqItem[]> {
  const res = await apiPut<{ ok: boolean; settings?: { faq?: unknown } }>('/api/gestion/home-settings', { faq });
  return mapFaq(res.settings?.faq);
}

// ── Bannière + slogan de la page d'accueil ──────────────────────────────────────────
export interface HomeBanner {
  type: 'url' | 'upload' | null;
  url: string | null;
  filePath: string | null;
  urlResolved: string | null;
}
export interface HomeHeroSettings {
  banner: HomeBanner;
  slogan: string;
}

function mapBanner(raw: unknown): HomeBanner {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    type: (r.type as HomeBanner['type']) ?? null,
    url: (r.url as string) ?? null,
    filePath: (r.filePath as string) ?? null,
    urlResolved: (r.urlResolved as string) ?? (r.url as string) ?? null,
  };
}

/** GET /api/gestion/home-settings — bannière + slogan actuels. */
export async function getHomeHeroSettings(signal?: AbortSignal): Promise<HomeHeroSettings> {
  void signal;
  const res = await apiGet<{ ok: boolean; settings?: { banner?: unknown; slogan?: unknown } }>('/api/gestion/home-settings', undefined);
  return { banner: mapBanner(res.settings?.banner), slogan: String(res.settings?.slogan ?? '') };
}

export interface TempAssetResult { tempAssetId: string; tempAssetUrl: string; }

/** POST /api/gestion/home-settings/temp-asset — upload d'une image temporaire (champ `asset`). */
export async function uploadTempHomeAsset(file: File): Promise<TempAssetResult> {
  const fd = new FormData();
  fd.append('asset', file);
  const res = await apiUpload<{ ok: boolean; tempAssetId: string; tempAssetUrl: string }>('/api/gestion/home-settings/temp-asset', fd);
  return { tempAssetId: res.tempAssetId, tempAssetUrl: res.tempAssetUrl };
}

export interface SaveHomeHeroInput {
  banner?: { type: 'url' | 'upload' | null; url?: string | null; tempAssetId?: string | null };
  slogan?: string;
}

/** PUT /api/gestion/home-settings — enregistre bannière et/ou slogan (partiel). */
export async function saveHomeHero(input: SaveHomeHeroInput): Promise<HomeHeroSettings> {
  const res = await apiPut<{ ok: boolean; settings?: { banner?: unknown; slogan?: unknown } }>('/api/gestion/home-settings', input);
  return { banner: mapBanner(res.settings?.banner), slogan: String(res.settings?.slogan ?? '') };
}
