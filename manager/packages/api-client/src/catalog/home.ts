// RX3 S4 — Endpoints d'accueil (CMS + merchandising). Tous publics. Tolérants (champs absents → défauts).
import { apiFetch } from '../apiFetch';
import { rawArr } from './raw';
import { mapService, mapFaq } from './mappers';
import type { PublicService, FaqItem } from './types';

export interface HomeSettings {
  bannerUrl?: string;
  slogan?: string;
  hookEditorialHtml?: string;
  aboutHtml?: string;
  faq?: FaqItem[];
}

export interface SiteIdentity {
  siteName?: string;
  logoUrl?: string;
}

export interface SocialLink {
  id: string;
  type: string;
  url: string;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

/** GET /api/vitrine/home-settings — bannière / slogan / éditorial (CMS manager). */
export async function getHomeSettings(signal?: AbortSignal): Promise<HomeSettings> {
  const res = await apiFetch<{ ok?: boolean; settings?: unknown }>('/api/vitrine/home-settings', { signal });
  const s = asObj(res.settings);
  const banner = asObj(s.banner);
  const about = asObj(s.about);
  return {
    bannerUrl: str(banner.urlResolved) ?? str(banner.url),
    slogan: str(s.slogan),
    hookEditorialHtml: str(s.hookEditorialHtml),
    aboutHtml: str(about.editorialHtml),
    faq: mapFaq(s.faq),
  };
}

/** GET /api/vitrine/site-identity — nom + logo (réponse « nue », sans wrapper ok). */
export async function getSiteIdentity(signal?: AbortSignal): Promise<SiteIdentity> {
  const res = await apiFetch<unknown>('/api/vitrine/site-identity', { signal });
  const r = asObj(res);
  return { siteName: str(r.siteName), logoUrl: str(r.logoUrlResolved) };
}

/** GET /api/vitrine/services/boosted — prestations mises en avant (même forme que services). */
export async function getBoostedServices(signal?: AbortSignal): Promise<PublicService[]> {
  const res = await apiFetch<{ ok?: boolean; services?: unknown }>('/api/vitrine/services/boosted', { signal });
  return rawArr(res.services).map(mapService);
}

/** GET /api/vitrine/social-links — liens sociaux actifs (footer). */
export async function getSocialLinks(signal?: AbortSignal): Promise<SocialLink[]> {
  const res = await apiFetch<{ ok?: boolean; socialLinks?: unknown }>('/api/vitrine/social-links', { signal });
  return rawArr(res.socialLinks)
    .map((raw) => {
      const r = asObj(raw);
      return { id: String(r.id ?? ''), type: String(r.type ?? ''), url: String(r.url ?? '') };
    })
    .filter((l) => Boolean(l.url));
}
