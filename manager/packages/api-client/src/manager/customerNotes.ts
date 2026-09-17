// M13 — Client API Notes internes client (gestion, admin/dev). Endpoints
// /api/gestion/customers/:customerId/notes. Le backend reste l'autorité (auteur résolu côté serveur).
import { apiGet, apiPost } from '../apiFetch';

export interface CustomerNote {
  id: string;
  body: string;
  authorRole: string;
  authorLabel: string;
  createdAt: string | null;
}

const BASE = '/api/gestion/customers';

/** GET /:customerId/notes — notes internes (anti-chrono côté backend). */
export async function listCustomerNotes(customerId: string): Promise<CustomerNote[]> {
  const res = await apiGet<{ ok: boolean; notes: CustomerNote[] }>(`${BASE}/${encodeURIComponent(customerId)}/notes`);
  return res.notes ?? [];
}

/** POST /:customerId/notes — ajoute une note (body requis). */
export async function createCustomerNote(customerId: string, body: string): Promise<CustomerNote> {
  const res = await apiPost<{ ok: boolean; note: CustomerNote }>(`${BASE}/${encodeURIComponent(customerId)}/notes`, {
    body,
  });
  return res.note;
}
