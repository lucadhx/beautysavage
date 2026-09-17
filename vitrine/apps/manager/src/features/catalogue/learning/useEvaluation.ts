// FORMATION-EVALUATION — Hook d'édition de la définition d'évaluation d'une formation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEvaluationDefinition, saveEvaluationDefinition,
  type EvaluationDefinitionData, type EvalSection, type EvalDeliverable
} from '@bs/api-client';

export function useEvaluationDefinition(formationId: string) {
  return useQuery<EvaluationDefinitionData>({
    queryKey: ['evaluation', 'definition', formationId],
    queryFn: () => getEvaluationDefinition(formationId),
    enabled: Boolean(formationId),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
}

export function useEvaluationDefinitionSave(formationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { active: boolean; sections: EvalSection[]; deliverables: EvalDeliverable[] }) =>
      saveEvaluationDefinition(formationId, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['evaluation', 'definition', formationId] }); }
  });
}
