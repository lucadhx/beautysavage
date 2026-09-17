// C2 — Expérience apprenant (vitrine authentifiée) : hooks données.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listMyLearningFormations, getMyLearningFormation, completeLesson } from '@bs/api-client';

export function useMyLearningFormations() {
  return useQuery({
    queryKey: ['learning', 'my-formations'],
    queryFn: ({ signal }) => listMyLearningFormations(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useMyLearningFormation(formationId: string | undefined) {
  return useQuery({
    queryKey: ['learning', 'formation', formationId],
    queryFn: () => getMyLearningFormation(formationId as string),
    enabled: Boolean(formationId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCompleteLesson(formationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => completeLesson(lessonId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['learning', 'formation', formationId] }),
  });
}
