// FORMATION-EVALUATION — api-client CLIENT (questionnaire → rendus → soumission → diplôme).
// Le client ne reçoit JAMAIS de correction (la projection backend les retire).
import { apiGet, apiPost, apiPut } from '../apiFetch';
import { API_BASE_URL } from '@bs/config';
import { ApiError } from '../types';

const BASE = '/api/client/evaluation';

// Upload multipart autonome (le transport JSON apiPost ne gère pas FormData). credentials:'include',
// pas de Content-Type manuel (le navigateur pose la boundary multipart), erreurs normalisées.
async function uploadMultipart<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE_URL ? `${API_BASE_URL}${path}` : path, { method: 'POST', credentials: 'include', body: form });
  } catch (cause) {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Erreur réseau.', body: cause });
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  if (!response.ok) {
    const p = (parsed && typeof parsed === 'object' ? parsed : {}) as { code?: string; error?: string; message?: string };
    throw new ApiError({ status: response.status, code: p.code ?? null, message: p.message || p.error || `HTTP ${response.status}`, body: parsed });
  }
  return parsed as T;
}

export interface ClientEvalAnswer { id: string; text: string; order?: number }
export interface ClientEvalQuestion {
  id: string; type: 'true_false' | 'quiz'; prompt: string; required: boolean; order?: number;
  mode?: 'single' | 'multiple'; answers?: ClientEvalAnswer[];
}
export interface ClientEvalSection { id: string; title: string; description?: string; questions: ClientEvalQuestion[] }
export interface ClientEvalDeliverable {
  id: string; type: 'photo_before_after' | 'video'; title: string; description?: string;
  required: boolean; maxDurationSeconds?: number | null;
}
export interface ClientEvalDefinition { formationId: string; active: boolean; version: number; sections: ClientEvalSection[]; deliverables: ClientEvalDeliverable[] }

export interface ClientAttemptAnswer { questionId: string; sectionId: string | null; type: string; booleanValue: boolean | null; selectedAnswerIds: string[] }
export interface ClientAttemptDeliverable { deliverableId: string; type: string; files: Array<{ kind: string; url: string; mime: string; size: number }> }
export interface ClientAttempt {
  id: string; attemptNumber: number; status: 'in_progress' | 'submitted' | 'accepted' | 'refused';
  answers: ClientAttemptAnswer[]; deliverables: ClientAttemptDeliverable[];
  questionnaireCompletedAt: string | null; submittedAt: string | null;
}
export interface ClientEvaluationState {
  hasEvaluation: boolean; completed: boolean;
  definition: ClientEvalDefinition | null; attempt: ClientAttempt | null;
  decisions: Array<{ decision: string; comment: string; attemptNumber: number; createdAt: string }>;
  certificate: { id: string; certificateNumber: string; issuedAt: string } | null;
}

export async function getClientEvaluation(formationId: string): Promise<ClientEvaluationState> {
  return apiGet<ClientEvaluationState & { ok: boolean }>(`${BASE}/formations/${encodeURIComponent(formationId)}`);
}

export async function createEvaluationAttempt(formationId: string): Promise<ClientAttempt> {
  const res = await apiPost<{ ok: boolean; attempt: ClientAttempt }>(`${BASE}/formations/${encodeURIComponent(formationId)}/attempt`);
  return res.attempt;
}

export async function saveEvaluationAnswers(attemptId: string, answers: Array<{ questionId: string; type: string; booleanValue?: boolean | null; selectedAnswerIds?: string[] }>): Promise<ClientAttempt> {
  const res = await apiPut<{ ok: boolean; attempt: ClientAttempt }>(`${BASE}/attempts/${encodeURIComponent(attemptId)}/answers`, { answers });
  return res.attempt;
}

export async function uploadEvaluationDeliverable(attemptId: string, deliverableId: string, kind: string, file: File): Promise<{ kind: string; url: string }> {
  const form = new FormData();
  form.append('deliverableId', deliverableId);
  form.append('kind', kind);
  form.append('file', file);
  const res = await uploadMultipart<{ ok: boolean; file: { kind: string; url: string } }>(`${BASE}/attempts/${encodeURIComponent(attemptId)}/deliverables`, form);
  return res.file;
}

export interface SubmitResult { ok: boolean; attempt?: ClientAttempt; missingQuestions?: string[]; missingDeliverables?: string[]; error?: string }
export async function submitEvaluationAttempt(attemptId: string): Promise<SubmitResult> {
  return apiPost<SubmitResult>(`${BASE}/attempts/${encodeURIComponent(attemptId)}/submit`);
}

export function clientCertificateUrl(certificateId: string): string {
  return `${API_BASE_URL}${BASE}/certificates/${encodeURIComponent(certificateId)}`;
}
