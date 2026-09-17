// RX4 S3 — Hooks des parcours tokenisés (TanStack). Pas d'auth : le token pilote l'accès.
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getDecisionFlow,
  confirmDecision,
  requestDecisionRefund,
  requestDecisionGiftCard,
  rescheduleFormationDecision,
  rescheduleServiceDecision,
  getRefundTracking,
} from '@bs/api-client';

export function useDecisionFlow(flowId: string | null, token: string | null) {
  return useQuery({
    queryKey: ['decision-flow', flowId, token],
    queryFn: () => getDecisionFlow(flowId as string, token as string),
    enabled: Boolean(flowId && token),
    retry: false,
    staleTime: 0,
  });
}

export function useConfirmDecision(flowId: string, token: string) {
  return useMutation({ mutationFn: () => confirmDecision(flowId, token) });
}
export function useRequestDecisionRefund(flowId: string, token: string) {
  return useMutation({ mutationFn: () => requestDecisionRefund(flowId, token) });
}
export function useRequestDecisionGiftCard(flowId: string, token: string) {
  return useMutation({ mutationFn: () => requestDecisionGiftCard(flowId, token) });
}
export function useRescheduleFormation(flowId: string, token: string) {
  return useMutation({
    mutationFn: (input: { chosenSessionId: string; acceptedCgv: boolean; renunciationText: string }) =>
      rescheduleFormationDecision(flowId, token, input),
  });
}
export function useRescheduleService(flowId: string, token: string) {
  return useMutation({
    mutationFn: (input: { chosenSlotStart: string; chosenSlotEnd: string }) =>
      rescheduleServiceDecision(flowId, token, input),
  });
}

export function useRefundTracking(token: string | null) {
  return useQuery({
    queryKey: ['refund-tracking', token],
    queryFn: () => getRefundTracking(token as string),
    enabled: Boolean(token),
    retry: false,
    staleTime: 0,
  });
}
