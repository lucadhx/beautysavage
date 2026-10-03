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
  if (!res.ok) throw apiError(json);
  return json.data as T;
}

/** Erreur d'API qui garde le code métier (`CUSTOMER_EXISTS`, `SLOT_REQUIRED`…) pour que l'écran réagisse au bon cas. */
export type ApiFailure = Error & { code?: string; details?: Record<string, unknown> };
function apiError(json: { message?: string; code?: string; details?: unknown }): ApiFailure {
  const err = new Error(json.message || 'Une erreur est survenue.') as ApiFailure;
  err.code = json.code;
  if (json.details && typeof json.details === 'object' && !Array.isArray(json.details)) err.details = json.details as Record<string, unknown>;
  return err;
}

/**
 * Envoi avec PROGRESSION — `fetch` ne sait pas dire où en est l'envoi d'un
 * corps de requête ; `XMLHttpRequest` si. Une vidéo de livrable pèse des
 * dizaines de mégaoctets : sans progression, la cliente croit l'écran figé.
 */
function publicUploadWithProgress<T>(path: string, file: File, token: string | null, onProgress: (ratio: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PUBLIC_BASE}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      let json: any = {};
      try { json = JSON.parse(xhr.responseText || '{}'); } catch { /* reponse non JSON (proxy) */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json.data as T);
      else reject(new Error(json.message || (xhr.status === 413 ? 'Fichier trop volumineux (120 Mo maximum).' : 'Import impossible.')));
    };
    xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}

export type UploadedDeliverable = { url: string; name: string; mimeType: string; size: number; kind: string; uploadedAt: string };

export interface CommerceProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  kind: 'DISTANCE_TRAINING' | 'IN_PERSON_TRAINING' | 'SERVICE' | 'GIFT_CARD' | 'PRODUCT';
  /** Le prix à payer maintenant — promotion comprise. */
  price: { amountCents: number; currency: string };
  /** Le prix d'origine, à barrer, quand une promotion court. */
  compareAtPrice?: { amountCents: number; currency: string } | null;
  promotion?: { percentOff: number; discountCents: number; type: 'PERCENT' | 'FIXED'; value: number; startsAt: string | null; endsAt: string | null } | null;
  /** Paiement complet, acompte (solde sur place) ou gratuit — réglé dans le Manager. */
  paymentRule?: { type: 'FULL' | 'DEPOSIT' | 'FREE'; depositType?: 'PERCENT' | 'FIXED'; depositValue?: number };
  coverUrl?: string;
  gallery?: string[];
  durationMinutes?: number;
  trailer?: { title?: string; url?: string; sourceUrl?: string; streamableShortcode?: string; coverUrl?: string };
  options: { key: string; label: string; description: string; priceCents: number }[];
  sessions: { id: string; startsAt: string; endsAt: string; capacity: number; remaining: number; days?: { startsAt: string; endsAt: string }[] }[];
  requiresLegalWaiver?: boolean;
  faq?: { question: string; answer: string }[];
  consentRequirements?: { key: string; label: string; required: boolean }[];
  homeFeatured?: boolean;
  homeFeaturedRank?: number | null;
  training?: { location?: string; durationDays?: number | null };
}

export type OrderLineInput = {
  productId: string;
  quantity?: number;
  sessionId?: string | null;
  optionKeys?: string[];
  serviceBooking?: { startsAt: string; endsAt: string; durationMinutes?: number };
  giftCard?: { senderName?: string; recipientName?: string; recipientEmail?: string; message?: string; amountCents?: number };
};

export type CheckoutResult = { saleId: string; saleNumber: string; paymentStatus: string; checkoutUrl: string | null; message: string };

/** Identifiant de la ligne unique d'un achat rapide — le serveur préfixe ses consentements avec. */
export const QUICK_BUY_LINE_ID = 'achat-rapide';

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
    bookingSnapshot?: { startsAt?: string; endsAt?: string; durationMinutes?: number } | null;
    optionKeys: string[];
    unitPriceCents: number;
    /** Ce qui est payé en ligne (acompte compris). */
    totalCents: number;
    fullTotalCents?: number;
    balanceDueCents?: number;
    paymentRule?: 'FULL' | 'DEPOSIT' | 'FREE';
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
  /** Ce qu'il restera à régler sur place (acomptes, prestations gratuites en ligne). */
  balanceDueCents?: number;
  currency: string;
}

export type CheckoutStatus = {
  state: 'PAID' | 'FINALIZING' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
  saleNumber: string;
  totalCents: number;
  giftCardAmountCents?: number;
  cardAmountCents?: number;
  giftCards?: { codeMasked: string; amountCents: number }[];
  /** La facture Stripe (page hébergée) ; vide tant qu'elle n'est pas émise, ou sans paiement Stripe. */
  invoiceUrl: string;
  balanceDueCents?: number;
};

export type Appointment = {
  id: string;
  kind: 'SERVICE' | 'IN_PERSON_TRAINING';
  title: string;
  productSlug: string;
  coverUrl: string;
  startsAt: string;
  endsAt: string;
  days: { startsAt: string; endsAt: string }[];
  status: string;
  soon: boolean;
  totalCents: number;
  paidCents: number;
  balanceDueCents: number;
  saleId: string | null;
  location: string;
  terms: { cancellable: boolean; onTime: boolean; freeCancelHours: number; deadline: string; percent: number; refundCents: number; paidCents: number };
};

export type Agenda = { upcoming: Appointment[]; past: Appointment[]; balanceDueCents: number; next: Appointment | null };

export type CustomerOrder = {
  id: string;
  saleNumber: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  balanceDueCents: number;
  invoiceUrl: string;
  createdAt: string;
  lines: { productSnapshot?: { title?: string; kind?: string }; totalCents: number }[];
};

export type WalletGiftCard = {
  id: string;
  code: string | null;
  codeMasked: string;
  initialAmountCents: number;
  balanceCents: number;
  availableCents: number;
  status: 'ACTIVE' | 'EMPTY' | 'VOID' | 'EXPIRED';
  origin: 'BOUGHT' | 'RECEIVED' | 'ADDED';
  recipientName: string;
  senderName: string;
  message: string;
  pdfUrl: string;
  createdAt: string;
  usage: { at: string; amountCents: number; reason: string }[];
};

export type GiftCardCheck = { code: string; codeMasked: string; availableCents: number; debitCents: number; remainingToPayCents: number; balanceAfterCents: number };

export const customerTokenStore = {
  get: () => localStorage.getItem(CUSTOMER_TOKEN_KEY),
  set: (token: string) => localStorage.setItem(CUSTOMER_TOKEN_KEY, token),
  clear: () => localStorage.removeItem(CUSTOMER_TOKEN_KEY),
};

export interface ServiceCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
  productIds: string[];
}

export const commerceApi = {
  catalog: () => publicGet<CommerceProduct[]>('/commerce/catalog'),
  /**
   * Collections de prestations (rayons). Un serveur qui ne les connaît pas encore
   * répond 404 : on renvoie alors une liste vide, et la page « Prestations »
   * garde son affichage en liste simple — rien ne casse.
   */
  collections: () => publicGet<ServiceCollection[]>('/commerce/collections').catch(() => [] as ServiceCollection[]),
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
    publicSend<{ message: string; token?: string; customer?: Customer }>('/customer/password-reset/confirm', body),
  me: () => publicGet<Customer>('/customer/me', customerTokenStore.get()),
  /** Où en est le paiement de cette session Stripe — vérifié (et finalisé) côté serveur. */
  checkoutStatus: (sessionId: string, saleNumber = '') =>
    publicGet<CheckoutStatus>(
      sessionId ? `/customer/checkout/status?session_id=${encodeURIComponent(sessionId)}` : `/customer/checkout/status?commande=${encodeURIComponent(saleNumber)}`,
      customerTokenStore.get(),
    ),
  cart: () => publicGet<CartView>('/customer/cart', customerTokenStore.get()),
  addCartItem: (body: OrderLineInput) =>
    publicSend<CartView>('/customer/cart/items', body, customerTokenStore.get()),
  /** Achat rapide : paie UNE ligne depuis sa fiche, sans lire ni vider le panier. */
  quickCheckout: (item: OrderLineInput, consents: string[] = [], giftCardCodes: string[] = [], returnPath = '') =>
    publicSend<CheckoutResult>(
      '/customer/checkout/quick',
      { idempotencyKey: globalThis.crypto?.randomUUID?.() || String(Date.now()), item, consents, giftCardCodes, returnPath },
      customerTokenStore.get()
    ),
  /** Choisit (ou change) le créneau d'une prestation déjà au panier. */
  setCartItemBooking: (lineId: string, serviceBooking: { startsAt: string; endsAt?: string; durationMinutes?: number }) =>
    publicSend<CartView>(`/customer/cart/items/${lineId}/booking`, { serviceBooking }, customerTokenStore.get(), 'PUT'),
  removeCartItem: (lineId: string) =>
    publicSend<CartView>(`/customer/cart/items/${lineId}`, {}, customerTokenStore.get(), 'DELETE'),
  checkout: (consents: string[] = [], giftCardCodes: string[] = []) =>
    publicSend<{ saleId: string; saleNumber: string; paymentStatus: string; checkoutUrl: string | null; message: string }>(
      '/customer/checkout',
      { idempotencyKey: globalThis.crypto?.randomUUID?.() || String(Date.now()), consents, giftCardCodes },
      customerTokenStore.get()
    ),
  orders: () => publicGet<CustomerOrder[]>('/customer/orders', customerTokenStore.get()),
  appointments: () => publicGet<Agenda>('/customer/appointments', customerTokenStore.get()),
  cancelAppointment: (id: string) =>
    publicSend<{ cancelled: boolean; refundCents: number; percent: number; onTime: boolean }>(`/customer/appointments/${encodeURIComponent(id)}/cancel`, {}, customerTokenStore.get()),
  invoices: () => publicGet<unknown[]>('/customer/invoices', customerTokenStore.get()),
  formations: () => publicGet<unknown[]>('/customer/formations', customerTokenStore.get()),
  giftCards: () => publicGet<WalletGiftCard[]>('/customer/gift-cards', customerTokenStore.get()),
  /** Ce qu'une carte paiera sur ce montant, et ce qu'il restera à régler. */
  checkGiftCard: (code: string, totalCents: number) =>
    publicSend<GiftCardCheck>('/customer/gift-cards/check', { code, totalCents }, customerTokenStore.get()),
  addGiftCardToWallet: (code: string) =>
    publicSend<WalletGiftCard[]>('/customer/gift-cards/wallet', { code }, customerTokenStore.get()),
  refundRequests: () => publicGet<unknown[]>('/customer/refund-requests', customerTokenStore.get()),
  createRefundRequest: (body: { saleId: string; lineId: string; amountCents?: number; reason?: string }) =>
    publicSend<unknown>('/customer/refund-requests', body, customerTokenStore.get()),
  trainingSubmissions: () => publicGet<unknown[]>('/customer/training-submissions', customerTokenStore.get()),
  uploadTrainingDeliverable: (file: File, onProgress: (ratio: number) => void = () => {}) =>
    publicUploadWithProgress<UploadedDeliverable>('/customer/training-deliverables', file, customerTokenStore.get(), onProgress),
  /** Retire du serveur un livrable envoyé mais pas encore soumis. */
  deleteTrainingDeliverable: (url: string) =>
    publicSend<{ deleted: boolean }>('/customer/training-deliverables', { url }, customerTokenStore.get(), 'DELETE'),
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
