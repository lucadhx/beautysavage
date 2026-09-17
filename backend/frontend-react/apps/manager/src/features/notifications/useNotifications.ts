// M9 — Hook du centre de notifications. TanStack Query (polling prudent, refetch au focus),
// mutations mark-read / mark-all / delete, et détection d'augmentation des non-lus pour
// déclencher le shake + le bandeau "+X". L'isolation admin/dev est garantie côté backend ;
// ici on ne fait que choisir le scope (endpoint).
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  type NotificationScope,
  type NotificationSummary,
} from '@bs/api-client';

const POLL_INTERVAL_MS = 45_000; // polling prudent (≠ agressif)
const STALE_MS = 30_000;
export const PULSE_VISIBLE_MS = 4_000;

/** Pur : un shake/bandeau ne se déclenche QUE si le nombre de non-lus augmente. */
export function shouldPulse(previous: number, next: number): boolean {
  return Number.isFinite(previous) && next > previous;
}

/** Pur : texte du bandeau pulse. Délai ≤ 0 → null (rien à afficher). */
export function pulseBannerText(delta: number): string | null {
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return `+${delta} notification${delta > 1 ? 's' : ''}`;
}

export interface UseNotificationsResult {
  notifications: NotificationSummary[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  /** Incrément des non-lus depuis le dernier poll (0 si pas d'augmentation). */
  pulseDelta: number;
  /** Compteur incrémenté à chaque augmentation — sert de clé pour relancer l'animation. */
  pulseTick: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  refetch: () => void;
}

export function useNotifications(scope: NotificationScope): UseNotificationsResult {
  const qc = useQueryClient();
  const queryKey = ['notifications', scope] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => listNotifications(scope, { limit: 50 }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });

  const unreadCount = query.data?.unreadCount ?? 0;
  const prevUnreadRef = useRef<number | null>(null);
  const [pulseDelta, setPulseDelta] = useState(0);
  const [pulseTick, setPulseTick] = useState(0);

  useEffect(() => {
    const prev = prevUnreadRef.current;
    if (prev !== null && shouldPulse(prev, unreadCount)) {
      setPulseDelta(unreadCount - prev);
      setPulseTick((t) => t + 1);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  const invalidate = () => void qc.invalidateQueries({ queryKey });

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(scope, id),
    onSuccess: invalidate,
  });
  const allMut = useMutation({
    mutationFn: () => markAllNotificationsRead(scope),
    onSuccess: invalidate,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteNotification(scope, id),
    onSuccess: invalidate,
  });

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount,
    isLoading: query.isLoading,
    isError: query.isError,
    pulseDelta,
    pulseTick,
    markRead: (id) => readMut.mutate(id),
    markAllRead: () => allMut.mutate(),
    remove: (id) => delMut.mutate(id),
    refetch: () => void query.refetch(),
  };
}
