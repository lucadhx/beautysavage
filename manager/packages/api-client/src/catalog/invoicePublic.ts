// RX-GO-2 — Facture publique par token (lien e-mail, SANS compte). Réutilise l'endpoint EXISTANT
// GET /api/invoice/:token (statut de génération + résumé). N'expose QUE ce que le backend renvoie
// (titre / montant / date / lien PDF) — jamais de lignes/TVA inventées.
import { API_BASE_URL } from '@bs/config';
import { apiGet } from '../apiFetch';

export interface PublicInvoiceStatus {
  ready: boolean;
  /** URL de téléchargement du PDF (Stripe ou endpoint local) quand prête, sinon null. */
  invoiceUrl: string | null;
  formationTitle: string;
  amount: number;
  date: string | null;
}

/** GET /api/invoice/:token → statut + résumé. Lève ApiError (404) si token inconnu. */
export async function getPublicInvoice(token: string): Promise<PublicInvoiceStatus> {
  const res = await apiGet<Partial<PublicInvoiceStatus>>(`/api/invoice/${encodeURIComponent(token)}`, undefined);
  return {
    ready: Boolean(res.ready),
    invoiceUrl: res.invoiceUrl ?? null,
    formationTitle: String(res.formationTitle || 'Facture'),
    amount: Number(res.amount || 0),
    date: res.date ?? null,
  };
}

/** URL de téléchargement directe du PDF par token (public, même origine). */
export function publicInvoiceDownloadUrl(token: string): string {
  return `${API_BASE_URL || ''}/api/invoice/download/${encodeURIComponent(token)}`;
}
