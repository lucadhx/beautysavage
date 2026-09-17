// C2 — Expérience apprenant (client, vitrine authentifiée). Lecture parcours + complétion leçon +
// token de présence. Accès gated côté serveur (Purchase).
import { API_BASE_URL } from '@bs/config';
import { apiGet, apiPost } from '../apiFetch';

const BASE = '/api/client/learning';

// C3 — URL de téléchargement de l'attestation (lien direct authentifié par cookie same-origin).
export function attestationDownloadUrl(formationId: string): string {
  return `${API_BASE_URL || ''}${BASE}/formations/${encodeURIComponent(formationId)}/attestation`;
}

export interface MyLearningFormation {
  formationId: string;
  name: string;
  coverImage: string;
  type: string;
  progressPct: number;
  startedAt: string | null;
  completedAt: string | null;
  lastLessonId: string | null;
}

export interface LearnerResource {
  id: string;
  name: string;
  type: 'pdf' | 'link' | 'document';
  url: string;
  description: string;
  order: number;
  visible: boolean;
}

export interface LearnerLesson {
  id: string;
  chapterId: string;
  title: string;
  description: string;
  videoUrl: string;
  resources: LearnerResource[];
  order: number;
  isFree: boolean;
  estimatedMinutes: number;
}

export interface LearnerChapter {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface LearnerProgress {
  completedLessonIds: string[];
  lastLessonId: string | null;
  formationPct: number;
  chapters: { chapterId: string; total: number; done: number; pct: number }[];
  completedAt: string | null;
}

export interface LearnerFormation {
  formation: { id: string; name: string; coverImage: string; accessUrl: string };
  chapters: LearnerChapter[];
  lessons: LearnerLesson[];
  progress: LearnerProgress;
}

export async function listMyLearningFormations(signal?: AbortSignal): Promise<MyLearningFormation[]> {
  const res = await apiGet<{ ok: boolean; formations: MyLearningFormation[] }>(`${BASE}/formations`, undefined);
  void signal;
  return res.formations ?? [];
}

export async function getMyLearningFormation(formationId: string): Promise<LearnerFormation> {
  return apiGet<{ ok: boolean } & LearnerFormation>(`${BASE}/formations/${encodeURIComponent(formationId)}`);
}

export async function completeLesson(lessonId: string): Promise<LearnerProgress> {
  const res = await apiPost<{ ok: boolean; progress: LearnerProgress }>(`${BASE}/lessons/${encodeURIComponent(lessonId)}/complete`);
  return res.progress;
}

export interface MyAttendance {
  status: string;
  token: string;
  payload: string;
}
export async function getMyAttendanceToken(sessionId: string): Promise<MyAttendance> {
  const res = await apiGet<{ ok: boolean; attendance: MyAttendance }>(`${BASE}/sessions/${encodeURIComponent(sessionId)}/attendance-token`);
  return res.attendance;
}
