// M13 — Client API Gift Card Template Studio (dev-only). Endpoints
// /api/gestion/dev/gift-card-templates (requireStrictDev). Édition HTML/CSS, versions, brouillon →
// publication → rollback, preview live (aucun envoi ; le QR de preview est factice). Le backend
// reste l'autorité.
import { apiGet, apiPost, apiPatch } from '../apiFetch';

export type GiftCardTemplateStatus = 'draft' | 'published' | 'archived';

export interface GiftCardTemplate {
  id: string;
  name: string;
  slug: string;
  html: string;
  css: string;
  variables: string[];
  previewData: Record<string, unknown> | null;
  visible: boolean;
  active: boolean;
  version: number;
  status: GiftCardTemplateStatus;
  publishedAt?: string | null;
  archivedAt?: string | null;
  isSystemDefault: boolean;
  createdFromVersion?: number | null;
  createdBy: string;
  updatedBy: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GiftCardTemplateDraftInput {
  name?: string;
  slug?: string;
  html?: string;
  css?: string;
  variables?: string[];
  previewData?: Record<string, unknown>;
  visible?: boolean;
}

const BASE = '/api/gestion/dev/gift-card-templates';

/** GET / — tous les templates + le vocabulaire de variables supporté. */
export async function listGiftCardStudioTemplates(): Promise<{ templates: GiftCardTemplate[]; variables: string[] }> {
  const res = await apiGet<{ ok: boolean; templates: GiftCardTemplate[]; variables: string[] }>(BASE);
  return { templates: res.templates ?? [], variables: res.variables ?? [] };
}

/** GET /:slug — template publié par slug. */
export async function getGiftCardStudioTemplate(slug: string): Promise<GiftCardTemplate | null> {
  const res = await apiGet<{ ok: boolean; template?: GiftCardTemplate }>(`${BASE}/${encodeURIComponent(slug)}`);
  return res.template ?? null;
}

/** GET /:slug/versions — historique des versions. */
export async function listGiftCardTemplateVersions(slug: string): Promise<GiftCardTemplate[]> {
  const res = await apiGet<{ ok: boolean; versions: GiftCardTemplate[] }>(`${BASE}/${encodeURIComponent(slug)}/versions`);
  return res.versions ?? [];
}

/** POST / — crée un nouveau template. */
export async function createGiftCardTemplate(input: GiftCardTemplateDraftInput): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(BASE, input);
  return res.template;
}

/** POST /:slug/draft — crée un brouillon à partir du template publié. */
export async function createGiftCardTemplateDraft(slug: string, input: GiftCardTemplateDraftInput): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(
    `${BASE}/${encodeURIComponent(slug)}/draft`,
    input,
  );
  return res.template;
}

/** PATCH /drafts/:id — met à jour un brouillon. */
export async function updateGiftCardTemplateDraft(id: string, input: GiftCardTemplateDraftInput): Promise<GiftCardTemplate> {
  const res = await apiPatch<{ ok: boolean; template: GiftCardTemplate }>(`${BASE}/drafts/${encodeURIComponent(id)}`, input);
  return res.template;
}

/** POST /drafts/:id/publish — publie un brouillon. */
export async function publishGiftCardTemplateDraft(id: string): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(`${BASE}/drafts/${encodeURIComponent(id)}/publish`);
  return res.template;
}

/** POST /drafts/:id/archive — archive un brouillon. */
export async function archiveGiftCardTemplate(id: string): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(`${BASE}/drafts/${encodeURIComponent(id)}/archive`);
  return res.template;
}

/** POST /:slug/rollback/:version — restaure une version antérieure. */
export async function rollbackGiftCardTemplate(slug: string, version: number): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(
    `${BASE}/${encodeURIComponent(slug)}/rollback/${version}`,
  );
  return res.template;
}

/** POST /preview — preview live (HTML rendu, QR factice). Aucun envoi. */
export async function previewGiftCardTemplate(
  input: { html?: string; css?: string; previewData?: Record<string, unknown>; id?: string },
): Promise<string> {
  const res = await apiPost<{ ok: boolean; html: string }>(`${BASE}/preview`, input);
  return res.html ?? '';
}
