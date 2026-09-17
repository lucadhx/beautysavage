import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createManualReview,
  listReviewsForModeration,
  listServices,
  listTrainings,
  moderateReview,
  type ManualReviewInput,
  type ReviewStatus,
  type ReviewTargetType,
} from '@bs/api-client';

export function useReviews(params?: { status?: ReviewStatus; type?: ReviewTargetType }) {
  return useQuery({
    queryKey: ['reviews', 'moderation', params?.status ?? 'all', params?.type ?? 'all'],
    queryFn: () => listReviewsForModeration(params),
    staleTime: 15_000,
  });
}

export function useReviewCatalog() {
  return useQuery({
    queryKey: ['reviews', 'catalog'],
    queryFn: async () => {
      const [services, formations] = await Promise.all([listServices(), listTrainings()]);
      return {
        services: services
          .filter(service => service.isActive !== false)
          .map(service => ({ id: service.id, name: service.name })),
        formations: formations.map(formation => ({ id: formation.id, name: formation.name })),
      };
    },
    staleTime: 60_000,
  });
}

export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) => moderateReview(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews', 'moderation'] }),
  });
}

export function useCreateManualReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualReviewInput) => createManualReview(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
}
