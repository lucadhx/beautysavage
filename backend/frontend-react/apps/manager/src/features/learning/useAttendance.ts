// C2 — Présence présentiel (manager) : participants + marquage + scan QR.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listSessionParticipants, markAttendance, scanAttendance, type AttendanceStatus } from '@bs/api-client';

export function useParticipants(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['attendance', sessionId],
    queryFn: () => listSessionParticipants(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}

export function useAttendanceMutations(sessionId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attendance', sessionId] });
  return {
    mark: useMutation({
      mutationFn: ({ userId, status }: { userId: string; status: AttendanceStatus }) => markAttendance(sessionId, userId, status),
      onSuccess: invalidate,
    }),
    scan: useMutation({
      mutationFn: (token: string) => scanAttendance(sessionId, token),
      onSuccess: invalidate,
    }),
  };
}
