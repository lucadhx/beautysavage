// C2 — Learning Studio (manager) : hooks données (TanStack). Arbre chapitres/leçons + mutations.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getLearningTree,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  type LearningChapterInput,
  type LearningLessonInput,
} from '@bs/api-client';

export function useLearningTree(formationId: string | undefined) {
  return useQuery({
    queryKey: ['learning', 'tree', formationId],
    queryFn: () => getLearningTree(formationId as string),
    enabled: Boolean(formationId),
    staleTime: 30_000,
  });
}

export function useLearningMutations(formationId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['learning', 'tree', formationId] });
  return {
    createChapter: useMutation({ mutationFn: (input: LearningChapterInput) => createChapter(formationId, input), onSuccess: invalidate }),
    updateChapter: useMutation({ mutationFn: ({ id, input }: { id: string; input: LearningChapterInput }) => updateChapter(id, input), onSuccess: invalidate }),
    deleteChapter: useMutation({ mutationFn: (id: string) => deleteChapter(id), onSuccess: invalidate }),
    reorderChapters: useMutation({ mutationFn: (ids: string[]) => reorderChapters(formationId, ids), onSuccess: invalidate }),
    createLesson: useMutation({ mutationFn: (input: LearningLessonInput) => createLesson(formationId, input), onSuccess: invalidate }),
    updateLesson: useMutation({ mutationFn: ({ id, input }: { id: string; input: LearningLessonInput }) => updateLesson(id, input), onSuccess: invalidate }),
    deleteLesson: useMutation({ mutationFn: (id: string) => deleteLesson(id), onSuccess: invalidate }),
    reorderLessons: useMutation({ mutationFn: (ids: string[]) => reorderLessons(formationId, ids), onSuccess: invalidate }),
  };
}
