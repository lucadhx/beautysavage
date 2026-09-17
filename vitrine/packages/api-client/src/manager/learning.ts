// C2 — Learning Studio + présence (manager). Chapitres/leçons CRUD, participants, présence, scan
// QR, attestation (preview). Convention envelope-unwrap + apiGet/apiPost/apiPut/apiDelete.
import { API_BASE_URL } from '@bs/config';
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from '../apiFetch';

const BASE = '/api/gestion/learning';

// C3 — URL de téléchargement de l'attestation d'un client (manager, lien direct authentifié).
export function managerAttestationUrl(customerId: string, formationId: string): string {
  return `${API_BASE_URL || ''}${BASE}/customers/${encodeURIComponent(customerId)}/formations/${encodeURIComponent(formationId)}/attestation`;
}

export type LearningResourceType = 'pdf' | 'link' | 'document';

export interface LearningResource {
  id?: string;
  name: string;
  type: LearningResourceType;
  url: string;
  description?: string;
  order?: number;
  visible?: boolean;
}

export interface LearningChapter {
  id: string;
  formationId: string;
  title: string;
  description: string;
  order: number;
  visible: boolean;
}

export interface LearningLesson {
  id: string;
  formationId: string;
  chapterId: string;
  title: string;
  description: string;
  videoUrl: string;
  resources: LearningResource[];
  order: number;
  visible: boolean;
  isFree: boolean;
  estimatedMinutes: number;
}

export interface LearningTree {
  chapters: LearningChapter[];
  lessons: LearningLesson[];
}

export type LearningChapterInput = Partial<Pick<LearningChapter, 'title' | 'description' | 'visible' | 'order'>>;
export type LearningLessonInput = Partial<
  Pick<LearningLesson, 'title' | 'description' | 'videoUrl' | 'visible' | 'isFree' | 'estimatedMinutes' | 'order'>
> & { chapterId?: string; resources?: LearningResource[] };

export async function getLearningTree(formationId: string): Promise<LearningTree> {
  const res = await apiGet<{ ok: boolean } & LearningTree>(`${BASE}/formations/${encodeURIComponent(formationId)}/tree`);
  return { chapters: res.chapters ?? [], lessons: res.lessons ?? [] };
}

export async function createChapter(formationId: string, input: LearningChapterInput): Promise<LearningChapter> {
  const res = await apiPost<{ ok: boolean; chapter: LearningChapter }>(`${BASE}/formations/${encodeURIComponent(formationId)}/chapters`, input);
  return res.chapter;
}

export async function updateChapter(chapterId: string, input: LearningChapterInput): Promise<LearningChapter> {
  const res = await apiPut<{ ok: boolean; chapter: LearningChapter }>(`${BASE}/chapters/${encodeURIComponent(chapterId)}`, input);
  return res.chapter;
}

export async function deleteChapter(chapterId: string): Promise<void> {
  await apiDelete(`${BASE}/chapters/${encodeURIComponent(chapterId)}`);
}

export async function reorderChapters(formationId: string, orderedChapterIds: string[]): Promise<void> {
  await apiPut(`${BASE}/formations/${encodeURIComponent(formationId)}/chapters/reorder`, { orderedChapterIds });
}

export async function createLesson(formationId: string, input: LearningLessonInput): Promise<LearningLesson> {
  const res = await apiPost<{ ok: boolean; lesson: LearningLesson }>(`${BASE}/formations/${encodeURIComponent(formationId)}/lessons`, input);
  return res.lesson;
}

export async function updateLesson(lessonId: string, input: LearningLessonInput): Promise<LearningLesson> {
  const res = await apiPut<{ ok: boolean; lesson: LearningLesson }>(`${BASE}/lessons/${encodeURIComponent(lessonId)}`, input);
  return res.lesson;
}

export async function deleteLesson(lessonId: string): Promise<void> {
  await apiDelete(`${BASE}/lessons/${encodeURIComponent(lessonId)}`);
}

export async function reorderLessons(formationId: string, orderedLessonIds: string[]): Promise<void> {
  await apiPut(`${BASE}/formations/${encodeURIComponent(formationId)}/lessons/reorder`, { orderedLessonIds });
}

export type AttendanceStatus = 'pending' | 'present' | 'absent';

export interface SessionParticipant {
  userId: string;
  name: string;
  status: AttendanceStatus;
  method: string | null;
  checkedInAt: string | null;
}

export interface ParticipantsResult {
  participants: SessionParticipant[];
  summary: { total: number; present: number; remaining: number };
}

export async function listSessionParticipants(sessionId: string): Promise<ParticipantsResult> {
  const res = await apiGet<{ ok: boolean } & ParticipantsResult>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/participants`);
  return { participants: res.participants ?? [], summary: res.summary ?? { total: 0, present: 0, remaining: 0 } };
}

export async function markAttendance(sessionId: string, userId: string, status: AttendanceStatus): Promise<void> {
  await apiPost(`${BASE}/sessions/${encodeURIComponent(sessionId)}/attendance`, { userId, status });
}

export async function scanAttendance(sessionId: string, token: string): Promise<{ userId: string; name: string; status: AttendanceStatus }> {
  const res = await apiPost<{ ok: boolean; participant: { userId: string; name: string; status: AttendanceStatus } }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/scan`,
    { token },
  );
  return res.participant;
}

export interface AttestationTemplate {
  id: string;
  name: string;
  html: string;
  variables: string[];
  active: boolean;
}

export async function getAttestationTemplate(): Promise<AttestationTemplate> {
  const res = await apiGet<{ ok: boolean; template: AttestationTemplate }>(`${BASE}/attestation-template`);
  return res.template;
}

export async function updateAttestationTemplate(input: { name?: string; html?: string }): Promise<AttestationTemplate> {
  const res = await apiPut<{ ok: boolean; template: AttestationTemplate }>(`${BASE}/attestation-template`, input);
  return res.template;
}

export async function previewAttestation(data?: Record<string, string>): Promise<{ html: string; prepared: boolean; generated: boolean }> {
  const res = await apiPost<{ ok: boolean; preview: { html: string; prepared: boolean; generated: boolean } }>(
    `${BASE}/attestation-template/preview`,
    { data },
  );
  return res.preview;
}

export type ReviewStatus = 'pending' | 'published' | 'rejected';
export type ReviewTargetType = 'formation' | 'service';
export type ReviewSourceType = 'client' | 'manual_institute';

export interface ModerationReview {
  id: string;
  targetType: ReviewTargetType;
  targetId: string | null;
  targetName: string;
  formationId: string | null;
  formationName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  authorName: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string | null;
  moderatedAt: string | null;
  sourceType: ReviewSourceType;
  isManual: boolean;
  sourceLabel: string;
}

export interface ReviewModerationResult {
  reviews: ModerationReview[];
  counts: { pending: number; published: number; rejected: number };
  countsByType: { formation: number; service: number };
}

export interface ManualReviewInput {
  targetType: ReviewTargetType;
  targetId: string;
  displayName: string;
  rating: number;
  comment?: string;
  status: 'pending' | 'published';
  /** Date de l'avis (ISO ou yyyy-mm-dd). Optionnel : par défaut la date du jour côté backend. */
  reviewDate?: string;
}

export async function listReviewsForModeration(params?: {
  status?: ReviewStatus;
  type?: ReviewTargetType;
  formationId?: string;
  serviceId?: string;
}): Promise<ReviewModerationResult> {
  const res = await apiGet<{ ok: boolean } & ReviewModerationResult>(`${BASE}/reviews`, {
    status: params?.status,
    type: params?.type,
    formationId: params?.formationId,
    serviceId: params?.serviceId,
  });
  return {
    reviews: res.reviews ?? [],
    counts: res.counts ?? { pending: 0, published: 0, rejected: 0 },
    countsByType: res.countsByType ?? { formation: 0, service: 0 },
  };
}

export async function moderateReview(reviewId: string, status: ReviewStatus): Promise<void> {
  await apiPatch(`${BASE}/reviews/${encodeURIComponent(reviewId)}`, { status });
}

export async function createManualReview(input: ManualReviewInput): Promise<ModerationReview> {
  const res = await apiPost<{ ok: boolean; review: ModerationReview }>(`${BASE}/reviews/manual`, input);
  return res.review;
}
