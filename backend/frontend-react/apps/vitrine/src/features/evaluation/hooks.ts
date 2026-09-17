// FORMATION-EVALUATION — Hooks parcours client (vitrine).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getClientEvaluation, createEvaluationAttempt, saveEvaluationAnswers,
  uploadEvaluationDeliverable, submitEvaluationAttempt, type ClientEvaluationState
} from '@bs/api-client';

export function useClientEvaluation(formationId: string) {
  return useQuery<ClientEvaluationState>({
    queryKey: ['client-evaluation', formationId],
    queryFn: () => getClientEvaluation(formationId),
    enabled: Boolean(formationId),
    refetchOnWindowFocus: false
  });
}

export function useEvaluationActions(formationId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['client-evaluation', formationId] });
  return {
    start: useMutation({ mutationFn: () => createEvaluationAttempt(formationId), onSuccess: () => invalidate() }),
    saveAnswers: useMutation({
      mutationFn: (v: { attemptId: string; answers: Parameters<typeof saveEvaluationAnswers>[1] }) => saveEvaluationAnswers(v.attemptId, v.answers)
    }),
    upload: useMutation({
      mutationFn: (v: { attemptId: string; deliverableId: string; kind: string; file: File }) =>
        uploadEvaluationDeliverable(v.attemptId, v.deliverableId, v.kind, v.file),
      onSuccess: () => invalidate()
    }),
    submit: useMutation({ mutationFn: (attemptId: string) => submitEvaluationAttempt(attemptId), onSuccess: () => invalidate() })
  };
}
