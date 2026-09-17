// M13 — Client API Librairie de templates carte cadeau (admin/dev). Lecture seule + sélection de
// l'actif uniquement (PAS d'édition HTML). Endpoints /api/gestion/gift-cards/templates. Le backend
// garantit toujours exactement un template actif.
import { apiGet, apiPost } from '../apiFetch';
import type { GiftCardTemplate } from './giftCardTemplates';

const BASE = '/api/gestion/gift-cards/templates';

/** GET /templates — templates visibles et publiés (cartes pour sélection). */
export async function listGiftCardLibrary(): Promise<GiftCardTemplate[]> {
  const res = await apiGet<{ ok: boolean; templates: GiftCardTemplate[] }>(BASE);
  return res.templates ?? [];
}

/** GET /templates/active — le template actuellement actif. */
export async function getActiveGiftCardTemplate(): Promise<GiftCardTemplate | null> {
  const res = await apiGet<{ ok: boolean; template: GiftCardTemplate | null }>(`${BASE}/active`);
  return res.template ?? null;
}

/** GET /templates/:id/preview — HTML rendu (QR factice) pour aperçu en iframe sandbox. */
export async function previewGiftCardLibraryTemplate(id: string): Promise<string> {
  const res = await apiGet<{ ok: boolean; html: string }>(`${BASE}/${encodeURIComponent(id)}/preview`);
  return res.html ?? '';
}

/** POST /templates/:id/activate — définit ce template comme actif (exactement un actif). */
export async function activateGiftCardLibraryTemplate(id: string): Promise<GiftCardTemplate> {
  const res = await apiPost<{ ok: boolean; template: GiftCardTemplate }>(`${BASE}/${encodeURIComponent(id)}/activate`);
  return res.template;
}
