// M13 — Client API Cartes cadeaux (gestion, admin/dev). Création manuelle (paiement sur place),
// lookup par code/QR, débit manuel motivé (preview puis confirmation), liste/détail. Le backend
// reste l'autorité (montants, soldes, anti-doublon) ; aucun calcul métier ici.
import { apiGet, apiPost } from '../apiFetch';

export type GiftCardManualPaymentMethod = 'cash' | 'card' | 'other';

export interface GiftCardSummary {
  id: string;
  code: string;
  amount: number;
  balance: number;
  availableBalance?: number;
  reservedAmount?: number;
  status: string;
  purchasedAt: string | null;
  createdAt: string | null;
  saleId?: string;
  hasPassword?: boolean;
  userId?: string | null;
  ownerEmail?: string;
  ownerName?: string;
  recipientName?: string;
  purchaserName?: string;
}

export interface GiftCardTransaction {
  id: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  saleId: string;
  createdAt: string | null;
  transactionType: string;
  note: string;
  usedByLabel?: string;
  actorRole?: string;
  actorEmail?: string;
  ownerEmail?: string;
}

export interface ManualGiftCardCreated extends GiftCardSummary {
  creationMode: string;
  paymentMode: string;
  paymentLabel: string;
  cardVisualUrl: string | null;
  generatedPdfUrl: string | null;
  password: string;
}

export interface CreateManualGiftCardInput {
  customerId: string;
  recipientName: string;
  amount: number;
  manualPaymentMethod: GiftCardManualPaymentMethod;
  manualPaymentNote?: string;
  message?: string;
  templateId?: string;
  purchaserName?: string;
}

export interface ManualDebitPreview {
  preview: true;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface ManualDebitResult {
  card: GiftCardSummary;
  transaction: GiftCardTransaction;
}

const BASE = '/api/gestion/gift-cards';

/** GET /api/gestion/gift-cards?search=&status= — liste filtrable. */
export async function listGiftCards(params: { search?: string; status?: string } = {}): Promise<GiftCardSummary[]> {
  const query: Record<string, string> = {};
  if (params.search?.trim()) query.search = params.search.trim();
  if (params.status?.trim()) query.status = params.status.trim();
  const res = await apiGet<{ ok: boolean; cards: GiftCardSummary[] }>(BASE, Object.keys(query).length ? query : undefined);
  return res.cards ?? [];
}

/** GET /api/gestion/gift-cards/:id — détail + transactions. */
export async function getGiftCardDetail(id: string): Promise<{ card: GiftCardSummary; transactions: GiftCardTransaction[] }> {
  const res = await apiGet<{ ok: boolean; card: GiftCardSummary; transactions: GiftCardTransaction[] }>(
    `${BASE}/${encodeURIComponent(id)}`,
  );
  return { card: res.card, transactions: res.transactions ?? [] };
}

/** POST /api/gestion/gift-cards/manual — création manuelle (paiement sur place). */
export async function createManualGiftCard(input: CreateManualGiftCardInput): Promise<ManualGiftCardCreated> {
  const res = await apiPost<{ ok: boolean; giftCard: ManualGiftCardCreated }>(`${BASE}/manual`, input);
  return res.giftCard;
}

/**
 * LOT2 §4 — POST /api/gestion/gift-cards/:id/reset-pin — génère un NOUVEAU code (l'ancien est
 * invalidé), régénère le PDF et renvoie la carte au bénéficiaire. Le PIN n'est jamais renvoyé par l'API.
 */
export async function resetGiftCardPin(id: string): Promise<{ pinVersion: number; mail: unknown }> {
  const res = await apiPost<{ ok: boolean; pinVersion: number; mail: unknown }>(`${BASE}/${encodeURIComponent(id)}/reset-pin`);
  return { pinVersion: res.pinVersion, mail: res.mail };
}

/** GET /api/gestion/gift-cards/lookup?code= — recherche par code (404 si introuvable). */
export async function lookupGiftCardByCode(code: string): Promise<GiftCardSummary> {
  const res = await apiGet<{ ok: boolean; card: GiftCardSummary }>(`${BASE}/lookup`, { code });
  return res.card;
}

/** POST /api/gestion/gift-cards/lookup-qr — recherche via payload QR scanné/collé. */
export async function lookupGiftCardByQr(qrPayload: string): Promise<GiftCardSummary> {
  const res = await apiPost<{ ok: boolean; card: GiftCardSummary }>(`${BASE}/lookup-qr`, { qrPayload });
  return res.card;
}

/** POST /api/gestion/gift-cards/:id/manual-debit (preview:true) — aperçu sans écriture. */
export async function previewManualDebit(id: string, amount: number, reason: string): Promise<ManualDebitPreview> {
  return apiPost<ManualDebitPreview>(`${BASE}/${encodeURIComponent(id)}/manual-debit`, { amount, reason, preview: true });
}

/** POST /api/gestion/gift-cards/:id/manual-debit — débit définitif motivé. */
export async function manualDebitGiftCard(id: string, amount: number, reason: string): Promise<ManualDebitResult> {
  const res = await apiPost<{ ok: boolean; card: GiftCardSummary; transaction: GiftCardTransaction }>(
    `${BASE}/${encodeURIComponent(id)}/manual-debit`,
    { amount, reason },
  );
  return { card: res.card, transaction: res.transaction };
}
