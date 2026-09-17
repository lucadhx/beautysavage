// C1 — Catalogue Studio (manager). Client API typé pour prestations, formations
// (présentielles/distancielles), sessions, QR de présence, et configuration des cartes cadeaux.
// Le backend reste l'autorité (prix, slug, validations) ; aucun calcul métier côté client.
// Réutilise la convention envelope-unwrap (`{ ok, ... }`) + apiGet/apiPost/apiPut/apiDelete.
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../apiFetch';

const SERVICES = '/api/gestion/services';
const FORMATIONS = '/api/gestion/formations';
const GIFT_CARDS = '/api/gestion/gift-cards';

// ── États transverses (validation / visibilité) ─────────────────────────────
export type CatalogueModuleStatus = 'complete' | 'incomplete' | 'error' | 'optional';
export type CatalogueVisibility = 'visible' | 'hidden' | 'archived' | 'draft';

export interface CatalogueValidationIssue {
  /** Clé du module concerné (identite, prix, sessions…). */
  module: string;
  /** Gravité : `error` bloque la publication, `warning` est informatif. */
  level: 'error' | 'warning';
  message: string;
}

// ── Prestations ──────────────────────────────────────────────────────────────
export interface CatalogueServiceOption {
  id?: string;
  name: string;
  description?: string;
  price: number;
  isActive: boolean;
}

export interface CatalogueServicePromotion {
  isActive?: boolean;
  type?: 'percentage' | 'fixed';
  value?: number;
  startDate?: string | null;
  endDate?: string | null;
}

/** Entrée FAQ éditable (prestation / formation). */
export interface CatalogueFaqItem {
  question: string;
  answer: string;
}

export interface CatalogueService {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  duration: number;
  price: number;
  photos: string[];
  isActive: boolean;
  isBookable: boolean;
  paymentType: 'full' | 'deposit' | 'free';
  depositType: 'percentage' | 'fixed';
  depositValue: number;
  balanceSettlementMode: 'none' | 'pay_on_site';
  capacity: number;
  bufferTime: number;
  promotion: CatalogueServicePromotion;
  boost: { isActive?: boolean; order?: number };
  cancellationDays: number;
  bookingLeadDays: number;
  allowClientChoosePractitioner: boolean;
  options: CatalogueServiceOption[];
  faq: CatalogueFaqItem[];
  createdAt: string | null;
  updatedAt: string | null;
}

export type CatalogueServiceInput = Partial<
  Omit<CatalogueService, 'id' | 'slug' | 'createdAt' | 'updatedAt'>
>;

export async function listServices(signal?: AbortSignal): Promise<CatalogueService[]> {
  const res = await apiGet<{ ok: boolean; services: CatalogueService[] }>(SERVICES, undefined);
  void signal;
  return res.services ?? [];
}

export async function getService(id: string): Promise<CatalogueService> {
  const res = await apiGet<{ ok: boolean; service: CatalogueService }>(`${SERVICES}/${encodeURIComponent(id)}`);
  return res.service;
}

/** Crée (sans id) ou met à jour (avec id) une prestation. */
export async function saveService(input: CatalogueServiceInput, id?: string): Promise<CatalogueService> {
  const res = id
    ? await apiPut<{ ok: boolean; service: CatalogueService }>(`${SERVICES}/${encodeURIComponent(id)}`, input)
    : await apiPost<{ ok: boolean; service: CatalogueService }>(SERVICES, input);
  return res.service;
}

/** Upload d'une photo de prestation (multipart). Renvoie l'URL du fichier. */
export async function uploadServicePhoto(id: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append('photo', file);
  const res = await apiUpload<{ ok: boolean; photoUrl: string }>(`${SERVICES}/${encodeURIComponent(id)}/upload-photo`, fd);
  return res.photoUrl;
}

/** Upload d'une image de formation (réutilise l'endpoint de couverture, renvoie l'URL). */
export async function uploadFormationImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('coverImage', file);
  const res = await apiUpload<{ ok: boolean; coverImage: string }>(`${FORMATIONS}/upload-cover`, fd);
  return res.coverImage;
}

/** Archive (soft-delete : isActive=false). */
export async function archiveService(id: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`${SERVICES}/${encodeURIComponent(id)}`);
}

export async function duplicateService(id: string): Promise<CatalogueService> {
  const res = await apiPost<{ ok: boolean; service: CatalogueService }>(`${SERVICES}/${encodeURIComponent(id)}/duplicate`);
  return res.service;
}

// ── Formations ────────────────────────────────────────────────────────────────
export type CatalogueTrainingType = 'presentiel' | 'distanciel';
export type CatalogueTrainingStatus = 'draft' | 'published' | 'disabled';

export interface CatalogueTraining {
  id: string;
  name: string;
  description: string;
  previewDescription: string;
  editorialHtml: string;
  formalities: string;
  durationDays: number;
  refundDays: number;
  price: number;
  coverImage: string;
  trailerVideoTitle: string;
  trailerVideoUrl: string;
  whatsappGroupTitle: string;
  whatsappGroupUrl: string | null;
  type: CatalogueTrainingType;
  accessDeliveryMode: 'manual' | 'immediate';
  accessUrl: string;
  accessLifetime: boolean;
  isRefundableAfterAccess: boolean;
  status: CatalogueTrainingStatus;
  photos: string[];
  faq: CatalogueFaqItem[];
  soldCount: number;
  purchasedUsersCount: number;
  typeLocked: boolean;
  createdAt: string | null;
}

export type CatalogueTrainingInput = Partial<
  Omit<CatalogueTraining, 'id' | 'previewDescription' | 'soldCount' | 'purchasedUsersCount' | 'typeLocked' | 'createdAt'>
>;

export async function listTrainings(signal?: AbortSignal): Promise<CatalogueTraining[]> {
  const res = await apiGet<{ ok: boolean; formations: CatalogueTraining[] }>(FORMATIONS, undefined);
  void signal;
  return res.formations ?? [];
}

export async function getTraining(id: string): Promise<CatalogueTraining> {
  const res = await apiGet<{ ok: boolean; formation: CatalogueTraining }>(`${FORMATIONS}/${encodeURIComponent(id)}`);
  return res.formation;
}

export async function saveTraining(input: CatalogueTrainingInput, id?: string): Promise<CatalogueTraining> {
  const res = id
    ? await apiPut<{ ok: boolean; formation: CatalogueTraining }>(`${FORMATIONS}/${encodeURIComponent(id)}`, input)
    : await apiPost<{ ok: boolean; formation: CatalogueTraining }>(FORMATIONS, input);
  return res.formation;
}

export async function duplicateTraining(id: string): Promise<CatalogueTraining> {
  const res = await apiPost<{ ok: boolean; formation: CatalogueTraining }>(`${FORMATIONS}/${encodeURIComponent(id)}/duplicate`);
  return res.formation;
}

/** Suppression définitive (le backend archive l'historique et notifie les clients). */
export async function deleteTraining(id: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`${FORMATIONS}/${encodeURIComponent(id)}`);
}

// ── Sessions présentielles + QR ────────────────────────────────────────────────
export interface CatalogueScheduleEntry {
  dayIndex: number;
  startTime: string;
  endTime: string;
}

export interface CatalogueSessionQr {
  hasToken: boolean;
  token: string | null;
  payload: string | null;
  generatedAt: string | null;
}

export interface CatalogueTrainingSession {
  id: string;
  formationId: string;
  startDate: string;
  durationDays: number;
  durationLabel: string;
  schedule: CatalogueScheduleEntry[];
  maxClients: number;
  reservedCount: number;
  placesRemaining: number;
  isAvailable: boolean;
  status: string;
  isCanceled: boolean;
  instructorId: string | null;
  instructorName: string | null;
  qr: CatalogueSessionQr;
}

export interface CatalogueSessionInput {
  startDate: string;
  maxClients: number;
  schedule: CatalogueScheduleEntry[];
}

export async function listSessions(formationId: string, signal?: AbortSignal): Promise<CatalogueTrainingSession[]> {
  const res = await apiGet<{ ok: boolean; sessions: CatalogueTrainingSession[] }>(
    `${FORMATIONS}/${encodeURIComponent(formationId)}/sessions`,
    undefined,
  );
  void signal;
  return res.sessions ?? [];
}

export async function saveSession(
  formationId: string,
  input: CatalogueSessionInput,
  sessionId?: string,
): Promise<void> {
  const base = `${FORMATIONS}/${encodeURIComponent(formationId)}/sessions`;
  if (sessionId) {
    await apiPut<{ ok: boolean }>(`${base}/${encodeURIComponent(sessionId)}`, input);
  } else {
    await apiPost<{ ok: boolean }>(base, input);
  }
}

export async function deleteSession(formationId: string, sessionId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(
    `${FORMATIONS}/${encodeURIComponent(formationId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/** Génère (ou régénère) le QR de présence opaque d'une session. */
export async function generateSessionQr(
  formationId: string,
  sessionId: string,
  regenerate = false,
): Promise<CatalogueSessionQr> {
  const res = await apiPost<{ ok: boolean; qr: CatalogueSessionQr }>(
    `${FORMATIONS}/${encodeURIComponent(formationId)}/sessions/${encodeURIComponent(sessionId)}/qr`,
    { regenerate },
  );
  return res.qr;
}

// ── Cartes cadeaux (configuration vitrine) ─────────────────────────────────────
export interface CatalogueGiftCardConfig {
  minAmount: number;
  maxAmount: number;
  presetAmounts: number[];
  description: string;
  image: string;
}

export interface CatalogueGiftCardActiveTemplate {
  id: string | null;
  name: string | null;
  slug: string | null;
}

export async function getGiftCardsConfig(): Promise<CatalogueGiftCardConfig> {
  const res = await apiGet<{ ok: boolean; config: CatalogueGiftCardConfig }>(`${GIFT_CARDS}/config`);
  return {
    minAmount: res.config?.minAmount ?? 0,
    maxAmount: res.config?.maxAmount ?? 0,
    presetAmounts: res.config?.presetAmounts ?? [],
    description: res.config?.description ?? '',
    image: res.config?.image ?? '',
  };
}

export async function updateGiftCardsConfig(
  input: Partial<CatalogueGiftCardConfig>,
): Promise<CatalogueGiftCardConfig> {
  const res = await apiPut<{ ok: boolean; config: CatalogueGiftCardConfig }>(`${GIFT_CARDS}/config`, input);
  return {
    minAmount: res.config?.minAmount ?? 0,
    maxAmount: res.config?.maxAmount ?? 0,
    presetAmounts: res.config?.presetAmounts ?? [],
    description: res.config?.description ?? '',
    image: res.config?.image ?? '',
  };
}

/** Upload d'une image de configuration carte cadeau (persiste `image` et renvoie l'URL). */
export async function uploadGiftCardImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('image', file);
  const res = await apiUpload<{ ok: boolean; imageUrl: string }>(`${GIFT_CARDS}/config/upload-image`, fd);
  return res.imageUrl;
}

/** Template actif (librairie M13). Lecture seule depuis le Studio Catalogue. */
export async function getGiftCardActiveTemplate(): Promise<CatalogueGiftCardActiveTemplate | null> {
  const res = await apiGet<{ ok: boolean; template: CatalogueGiftCardActiveTemplate | null }>(
    `${GIFT_CARDS}/templates/active`,
  );
  return res.template ?? null;
}
