import type { BootstrapData, Chapter, LegalDocument, LegalDocumentType, SitePage } from '@/types';
import type { ContactPayload } from '@/lib/contactForm';

// URL initiale du backend (build/runtime). Vide -> chemin relatif (proxy Vite en dev).
export const API_ROOT = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const PUBLIC_BASE = API_ROOT ? `${API_ROOT}/api/public` : '/api/public';
const CUSTOMER_TOKEN_KEY = 'beautysavage.customer.token';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE}${path}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || 'Erreur de chargement');
  return json.data as T;
}

/**
 * Erreur d'API portant le CODE métier du backend.
 *
 * Le code (`CONTACT_EMAIL_INVALID`…) permet de replacer le message sous le bon
 * champ sans jamais parser une phrase française — un libellé se retraduit, un
 * code non. `issues` porte le détail zod (le chemin du champ fautif).
 */
export class ContactApiError extends Error {
  status: number;
  code: string | null;
  issues: { path?: (string | number)[]; message?: string }[];

  constructor(status: number, message: string, code: string | null, issues: unknown) {
    super(message);
    this.name = 'ContactApiError';
    this.status = status;
    this.code = code;
    this.issues = Array.isArray(issues) ? (issues as { path?: (string | number)[]; message?: string }[]) : [];
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ContactApiError(
      res.status,
      json.message || 'Une erreur est survenue.',
      json.details?.code ?? null,
      json.details?.issues ?? json.issues
    );
  }
  return json.data as T;
}

async function publicGet<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${PUBLIC_BASE}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || 'Erreur de chargement');
  return json.data as T;
}

async function publicSend<T>(path: string, body: unknown, token?: string | null, method = 'POST'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${PUBLIC_BASE}${path}`, { method, headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || 'Une erreur est survenue.');
  return json.data as T;
}

async function publicUpload<T>(path: string, file: File, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${PUBLIC_BASE}${path}`, { method: 'POST', headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || 'Import impossible.');
  return json.data as T;
}

export interface CommerceProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  kind: 'DISTANCE_TRAINING' | 'IN_PERSON_TRAINING' | 'SERVICE' | 'GIFT_CARD' | 'PRODUCT';
  price: { amountCents: number; currency: string };
  coverUrl?: string;
  gallery?: string[];
  durationMinutes?: number;
  trailer?: { title?: string; url?: string; sourceUrl?: string; streamableShortcode?: string; coverUrl?: string };
  options: { key: string; label: string; description: string; priceCents: number }[];
  sessions: { id: string; startsAt: string; endsAt: string; capacity: number; remaining: number }[];
  requiresLegalWaiver?: boolean;
}

export interface Customer {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
}

export interface CartView {
  id: string;
  lines: {
    id: string;
    product: CommerceProduct;
    quantity: number;
    sessionId: string | null;
    optionKeys: string[];
    unitPriceCents: number;
    totalCents: number;
    giftCard?: {
      senderName?: string;
      recipientName?: string;
      recipientEmail?: string;
      message?: string;
      amountCents?: number;
    } | null;
    consentRequirements?: { key: string; label: string; required: boolean }[];
  }[];
  totalCents: number;
  currency: string;
}

export const customerTokenStore = {
  get: () => localStorage.getItem(CUSTOMER_TOKEN_KEY),
  set: (token: string) => localStorage.setItem(CUSTOMER_TOKEN_KEY, token),
  clear: () => localStorage.removeItem(CUSTOMER_TOKEN_KEY),
};

export const commerceApi = {
  catalog: () => publicGet<CommerceProduct[]>('/commerce/catalog'),
  product: (slug: string) => publicGet<CommerceProduct>(`/commerce/products/${slug}`),
  availability: (params: { from: string; to: string; durationMinutes?: number; bufferAfterMinutes?: number }) => {
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.durationMinutes) query.set('durationMinutes', String(params.durationMinutes));
    if (params.bufferAfterMinutes) query.set('bufferAfterMinutes', String(params.bufferAfterMinutes));
    return publicGet<{ startsAt: string; endsAt: string; durationMinutes: number }[]>(`/commerce/availability?${query.toString()}`);
  },
  reviews: (productId?: string) =>
    publicGet<unknown[]>(`/commerce/reviews${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`),
};

export const customerApi = {
  register: (body: { email: string; password: string; firstName?: string; lastName?: string }) =>
    publicSend<{ customer: Customer; token: string; verificationCode?: string }>('/customer/register', body),
  login: (email: string, password: string) =>
    publicSend<{ customer: Customer; token: string }>('/customer/login', { email, password }),
  requestEmailVerification: () =>
    publicSend<{ message: string; verificationCode?: string }>('/customer/email-verification/request', {}, customerTokenStore.get()),
  verifyEmail: (code: string) =>
    publicSend<{ customer: Customer; token: string; message: string }>('/customer/email-verification/confirm', { code }),
  requestPasswordReset: (email: string) =>
    publicSend<{ message: string; resetUrl?: string }>('/customer/password-reset/request', { email }),
  resetPassword: (body: { token: string; password: string }) =>
    publicSend<{ message: string }>('/customer/password-reset/confirm', body),
  me: () => publicGet<Customer>('/customer/me', customerTokenStore.get()),
  cart: () => publicGet<CartView>('/customer/cart', customerTokenStore.get()),
  addCartItem: (body: {
    productId: string;
    quantity?: number;
    sessionId?: string | null;
    optionKeys?: string[];
    serviceBooking?: { startsAt: string; endsAt: string; durationMinutes?: number };
    giftCard?: { senderName?: string; recipientName?: string; recipientEmail?: string; message?: string; amountCents?: number };
  }) =>
    publicSend<CartView>('/customer/cart/items', body, customerTokenStore.get()),
  removeCartItem: (lineId: string) =>
    publicSend<CartView>(`/customer/cart/items/${lineId}`, {}, customerTokenStore.get(), 'DELETE'),
  checkout: (consents: string[] = [], giftCardCodes: string[] = []) =>
    publicSend<{ saleId: string; saleNumber: string; paymentStatus: string; checkoutUrl: string | null; message: string }>(
      '/customer/checkout',
      { idempotencyKey: globalThis.crypto?.randomUUID?.() || String(Date.now()), consents, giftCardCodes },
      customerTokenStore.get()
    ),
  orders: () => publicGet<unknown[]>('/customer/orders', customerTokenStore.get()),
  invoices: () => publicGet<unknown[]>('/customer/invoices', customerTokenStore.get()),
  formations: () => publicGet<unknown[]>('/customer/formations', customerTokenStore.get()),
  giftCards: () => publicGet<unknown[]>('/customer/gift-cards', customerTokenStore.get()),
  refundRequests: () => publicGet<unknown[]>('/customer/refund-requests', customerTokenStore.get()),
  createRefundRequest: (body: { saleId: string; lineId: string; amountCents?: number; reason?: string }) =>
    publicSend<unknown>('/customer/refund-requests', body, customerTokenStore.get()),
  trainingSubmissions: () => publicGet<unknown[]>('/customer/training-submissions', customerTokenStore.get()),
  uploadTrainingDeliverable: (file: File) =>
    publicUpload<{ url: string; name: string; mimeType: string; size: number; kind: string; uploadedAt: string }>('/customer/training-deliverables', file, customerTokenStore.get()),
  createTrainingSubmission: (body: { saleId: string; productId: string; answers?: unknown; deliverables?: unknown }) =>
    publicSend<unknown>('/customer/training-submissions', body, customerTokenStore.get()),
  streamablePlaybackUrl: (shortcode: string) =>
    publicGet<{ playbackUrl: string; shortcode: string }>(`/commerce/videos/streamable/${encodeURIComponent(shortcode)}/playback-url`),
  createReview: (body: { saleId: string; productId: string; rating: number; comment?: string; displayName?: string }) =>
    publicSend<unknown>('/customer/reviews', body, customerTokenStore.get()),
};

export const api = {
  bootstrap: () => get<BootstrapData>('/bootstrap'),
  networkConfiguration: () => get<{ backendUrl: string; websiteUrl: string }>('/network-configuration'),
  /**
   * UN CHAPITRE PAR SON SLUG — la porte de secours, pas le chemin normal.
   *
   * Les chapitres voyagent entiers dans le bootstrap ; `ChapterPage` les y lit
   * et n'appelle jamais ceci. Cette fonction existe pour le jour où ils
   * deviendront trop lourds pour la première requête du site : ce jour-là,
   * seule la page changera.
   */
  chapter: (slug: string) => get<Chapter>(`/chapters/${slug}`),
  /**
   * UN DOCUMENT LÉGAL — chargé à l'ouverture de la page, jamais au bootstrap.
   *
   * L'embarquer dans le bootstrap ferait payer deux documents complets à
   * chaque visite de l'accueil, pour des pages que l'immense majorité des
   * visiteurs n'ouvrira jamais.
   *
   * 404 quand le Panel n'a assigné aucun template : la page annonce alors
   * l'indisponibilité plutôt que d'inventer un texte.
   */
  legalDocument: (type: LegalDocumentType) => get<LegalDocument>(`/legal/${type}`),
  /**
   * LE CONTENU d'une page éditoriale — hors bootstrap, et volontairement.
   *
   * Le bootstrap porte l'ENTRÉE de chaque page (titre, adresse, rang au menu) :
   * c'est tout ce dont la barre de navigation a besoin. Les blocs, eux, pèsent
   * à proportion de ce que le client rédige, et personne ne les a encore
   * demandés au moment où la première image de l'accueil se peint.
   */
  page: (slug: string) => get<SitePage>(`/pages/${slug}`),
  /**
   * Dépôt d'une demande de contact — la seule ÉCRITURE publique du site.
   * La réponse est volontairement minimale : `{ submissionId }`, rien de plus.
   * Elle ne dit rien de l'e-mail, et c'est voulu (cf. docs/CONTACT_FORM.md).
   */
  submitContact: (payload: ContactPayload) => post<{ submissionId: string }>('/contact', payload),
};
