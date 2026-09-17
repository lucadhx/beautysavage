// C1 — Catalogue Studio : hooks de données (TanStack Query). Même convention que usePlanning
// (M10) : useQuery + useMutation avec invalidation, staleTime 30s. L'état d'édition (draft,
// module actif) vit dans les composants éditeurs, pas ici.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listServices,
  getService,
  saveService,
  archiveService,
  duplicateService,
  listTrainings,
  getTraining,
  saveTraining,
  duplicateTraining,
  deleteTraining,
  listSessions,
  saveSession,
  deleteSession,
  generateSessionQr,
  getGiftCardsConfig,
  updateGiftCardsConfig,
  getGiftCardActiveTemplate,
  type CatalogueServiceInput,
  type CatalogueTrainingInput,
  type CatalogueSessionInput,
  type CatalogueGiftCardConfig,
} from '@bs/api-client';

const STALE = 30_000;

// ── Prestations ────────────────────────────────────────────────────────────────
export function useServicesList() {
  return useQuery({ queryKey: ['catalogue', 'services'], queryFn: () => listServices(), staleTime: STALE });
}

export function useServiceDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['catalogue', 'service', id],
    queryFn: () => getService(id as string),
    enabled: Boolean(id),
    staleTime: STALE,
  });
}

export function useServiceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalogue'] });
  return {
    save: useMutation({
      mutationFn: ({ input, id }: { input: CatalogueServiceInput; id?: string }) => saveService(input, id),
      onSuccess: invalidate,
    }),
    archive: useMutation({ mutationFn: (id: string) => archiveService(id), onSuccess: invalidate }),
    duplicate: useMutation({ mutationFn: (id: string) => duplicateService(id), onSuccess: invalidate }),
  };
}

// ── Formations ─────────────────────────────────────────────────────────────────
export function useTrainingsList() {
  return useQuery({ queryKey: ['catalogue', 'trainings'], queryFn: () => listTrainings(), staleTime: STALE });
}

export function useTrainingDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['catalogue', 'training', id],
    queryFn: () => getTraining(id as string),
    enabled: Boolean(id),
    staleTime: STALE,
  });
}

export function useTrainingMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalogue'] });
  return {
    save: useMutation({
      mutationFn: ({ input, id }: { input: CatalogueTrainingInput; id?: string }) => saveTraining(input, id),
      onSuccess: invalidate,
    }),
    duplicate: useMutation({ mutationFn: (id: string) => duplicateTraining(id), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => deleteTraining(id), onSuccess: invalidate }),
  };
}

// ── Sessions présentielles ───────────────────────────────────────────────────────
export function useSessionsList(formationId: string | undefined) {
  return useQuery({
    queryKey: ['catalogue', 'sessions', formationId],
    queryFn: () => listSessions(formationId as string),
    enabled: Boolean(formationId),
    staleTime: STALE,
  });
}

export function useSessionMutations(formationId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalogue', 'sessions', formationId] });
  return {
    save: useMutation({
      mutationFn: ({ input, sessionId }: { input: CatalogueSessionInput; sessionId?: string }) =>
        saveSession(formationId, input, sessionId),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (sessionId: string) => deleteSession(formationId, sessionId), onSuccess: invalidate }),
    qr: useMutation({
      mutationFn: ({ sessionId, regenerate }: { sessionId: string; regenerate?: boolean }) =>
        generateSessionQr(formationId, sessionId, regenerate ?? false),
      onSuccess: invalidate,
    }),
  };
}

// ── Cartes cadeaux ───────────────────────────────────────────────────────────────
export function useGiftCardConfig() {
  return useQuery({ queryKey: ['catalogue', 'gift-card-config'], queryFn: () => getGiftCardsConfig(), staleTime: STALE });
}

export function useGiftCardActiveTemplate() {
  return useQuery({
    queryKey: ['catalogue', 'gift-card-active-template'],
    queryFn: () => getGiftCardActiveTemplate(),
    staleTime: STALE,
    retry: false,
  });
}

export function useGiftCardConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CatalogueGiftCardConfig>) => updateGiftCardsConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogue', 'gift-card-config'] }),
  });
}
