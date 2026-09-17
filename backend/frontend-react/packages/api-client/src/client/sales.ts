// RX4 — Ventes / factures / documents (client). Lecture de l'historique d'achats + factures.
import { API_BASE_URL } from '@bs/config';
import { apiGet } from '../apiFetch';
import type { ClientSale } from './types';

const BASE = '/api/client';

/** Forme brute renvoyée par listMySales (backend) — normalisée avant exposition. */
interface RawSale {
  id: string;
  createdAt?: string | null;
  date_achat?: string | null;
  date_formation?: string | null;
  totalAmount?: number;
  itemCount?: number;
  items?: { type?: string; name?: string; price?: number }[];
  giftCardUsage?: { amountUsed?: number }[];
  accepted_cgv?: boolean;
  invoice?: ClientSale['invoice'] | null;
}

function normalizeSale(raw: RawSale): ClientSale {
  const items = Array.isArray(raw.items)
    ? raw.items.map((i) => ({ type: String(i.type || ''), name: i.name || 'Article', price: Number(i.price || 0) }))
    : [];
  const giftCardTotal = Array.isArray(raw.giftCardUsage)
    ? raw.giftCardUsage.reduce((sum, g) => sum + Number(g.amountUsed || 0), 0)
    : 0;
  return {
    id: raw.id,
    createdAt: raw.createdAt ?? null,
    dateAchat: raw.date_achat ?? raw.createdAt ?? null,
    dateFormation: raw.date_formation ?? null,
    totalAmount: Number(raw.totalAmount || 0),
    itemCount: Number.isFinite(Number(raw.itemCount)) ? Number(raw.itemCount) : items.length,
    items,
    giftCardTotal,
    acceptedCgv: Boolean(raw.accepted_cgv),
    invoice: raw.invoice ?? null,
  };
}

/** GET /api/client/sales → historique d'achats (triés récents d'abord par le backend). */
export async function listMySales(signal?: AbortSignal): Promise<ClientSale[]> {
  const res = await apiGet<{ ok: boolean; sales: RawSale[] }>(`${BASE}/sales`, undefined);
  void signal;
  return (res.sales ?? []).map(normalizeSale);
}

/** URL de téléchargement de la facture d'une vente (authentifiée par cookie same-origin). */
export function saleInvoiceUrl(saleId: string): string {
  return `${API_BASE_URL || ''}${BASE}/sales/${encodeURIComponent(saleId)}/invoice`;
}
