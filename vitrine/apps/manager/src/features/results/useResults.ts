// FORMATION-EVALUATION — Hooks console Résultats (TanStack Query).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listEvaluationResults, getEvaluationResult, acceptEvaluationResult, refuseEvaluationResult,
  type EvaluationResultRow, type EvaluationResultDetail
} from '@bs/api-client';

const STALE = 30_000;

export function useEvaluationResults(filters: { status?: string } = {}) {
  return useQuery<EvaluationResultRow[]>({
    queryKey: ['evaluation', 'results', filters],
    queryFn: () => listEvaluationResults(filters),
    staleTime: STALE,
    refetchOnWindowFocus: false
  });
}

export function useEvaluationResult(attemptId: string | undefined) {
  return useQuery<EvaluationResultDetail>({
    queryKey: ['evaluation', 'result', attemptId],
    queryFn: () => getEvaluationResult(attemptId as string),
    enabled: Boolean(attemptId),
    staleTime: STALE,
    refetchOnWindowFocus: false
  });
}

export function useEvaluationDecision(attemptId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['evaluation', 'result', attemptId] });
    void qc.invalidateQueries({ queryKey: ['evaluation', 'results'] });
  };
  const accept = useMutation({
    mutationFn: (comment: string) => acceptEvaluationResult(attemptId, comment),
    onSuccess: invalidate
  });
  const refuse = useMutation({
    mutationFn: (comment: string) => refuseEvaluationResult(attemptId, comment),
    onSuccess: invalidate
  });
  return { accept, refuse };
}
