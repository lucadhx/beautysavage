// FORMATION-EVALUATION — api-client INSTITUT (définition + console Résultats + diplôme).
import { apiGet, apiPut, apiPost } from '../apiFetch';
import { API_BASE_URL } from '@bs/config';

const BASE = '/api/gestion/evaluation';

export type QuestionType = 'true_false' | 'quiz';
export type QuizMode = 'single' | 'multiple';
export type DeliverableType = 'photo_before_after' | 'video';

export interface EvalAnswer { _id?: string; text: string; correct: boolean; order?: number }
export interface EvalQuestion {
  _id?: string; type: QuestionType; prompt: string; required: boolean; order?: number;
  correctBoolean?: boolean; mode?: QuizMode; answers?: EvalAnswer[];
}
export interface EvalSection { _id?: string; title: string; description?: string; order?: number; questions: EvalQuestion[] }
export interface EvalDeliverable {
  _id?: string; type: DeliverableType; title: string; description?: string; required: boolean;
  order?: number; maxDurationSeconds?: number | null;
}
export interface EvaluationDefinitionData {
  formationId: string; active: boolean; version: number;
  sections: EvalSection[]; deliverables: EvalDeliverable[];
}

export interface EvaluationResultRow {
  id: string; client: string; clientEmail: string; formationId: string; formation: string;
  submittedAt: string | null; status: 'submitted' | 'accepted' | 'refused'; attemptNumber: number;
}
export interface EvaluationResultDetail {
  id: string; client: string; clientEmail: string; formation: string;
  status: string; attemptNumber: number; submittedAt: string | null;
  score: { total: number; correct: number; wrong: number; percent: number };
  sections: Array<{
    id: string; title: string; description?: string;
    questions: Array<{
      id: string; type: QuestionType; prompt: string; required: boolean; correct: boolean;
      correctBoolean?: boolean; mode?: QuizMode;
      answers?: Array<{ id: string; text: string; correct: boolean }>;
      clientAnswer: { booleanValue: boolean | null; selectedAnswerIds: string[] } | null;
    }>;
  }>;
  deliverables: Array<{ id: string; type: DeliverableType; title: string; description?: string; files: Array<{ kind: string; url: string; mime: string }> }>;
  decisions: Array<{ decision: string; comment: string; attemptNumber: number; reviewer: string; createdAt: string; certificateId: string }>;
  certificate: { id: string; certificateNumber: string; issuedAt: string } | null;
}

export async function getEvaluationDefinition(formationId: string): Promise<EvaluationDefinitionData> {
  const res = await apiGet<{ ok: boolean; definition: EvaluationDefinitionData }>(`${BASE}/formations/${encodeURIComponent(formationId)}/definition`);
  return res.definition;
}

export async function saveEvaluationDefinition(formationId: string, input: { active: boolean; sections: EvalSection[]; deliverables: EvalDeliverable[] }): Promise<EvaluationDefinitionData> {
  const res = await apiPut<{ ok: boolean; definition: EvaluationDefinitionData }>(`${BASE}/formations/${encodeURIComponent(formationId)}/definition`, input);
  return res.definition;
}

export async function listEvaluationResults(filters: { formationId?: string; status?: string; from?: string; to?: string } = {}): Promise<EvaluationResultRow[]> {
  const params: Record<string, string> = {};
  if (filters.formationId) params.formationId = filters.formationId;
  if (filters.status) params.status = filters.status;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  const res = await apiGet<{ ok: boolean; results: EvaluationResultRow[] }>(`${BASE}/results`, Object.keys(params).length ? params : undefined);
  return res.results ?? [];
}

export async function getEvaluationResult(attemptId: string): Promise<EvaluationResultDetail> {
  const res = await apiGet<{ ok: boolean; result: EvaluationResultDetail }>(`${BASE}/results/${encodeURIComponent(attemptId)}`);
  return res.result;
}

export async function acceptEvaluationResult(attemptId: string, comment: string): Promise<{ certificate: { id: string; certificateNumber: string } }> {
  const res = await apiPost<{ ok: boolean; certificate: { id: string; certificateNumber: string } }>(`${BASE}/results/${encodeURIComponent(attemptId)}/accept`, { comment });
  return { certificate: res.certificate };
}

export async function refuseEvaluationResult(attemptId: string, comment: string): Promise<{ newAttempt: { id: string; attemptNumber: number } }> {
  const res = await apiPost<{ ok: boolean; newAttempt: { id: string; attemptNumber: number } }>(`${BASE}/results/${encodeURIComponent(attemptId)}/refuse`, { comment });
  return { newAttempt: res.newAttempt };
}

export function managerCertificateUrl(certificateId: string): string {
  return `${API_BASE_URL}${BASE}/certificates/${encodeURIComponent(certificateId)}`;
}
