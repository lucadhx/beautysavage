// RX4 — Hooks données de l'espace client (TanStack Query). Lecture partagée par le dashboard et les
// sous-pages : le cache évite les refetch entre écrans du hub.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listMyBookings,
  getBookingRefundEligibility,
  cancelMyBooking,
  listMyGiftCards,
  getMyGiftCard,
  listMySales,
  getMyProfile,
  updateMyProfile,
  submitFormationReview,
  type SubmitReviewInput,
} from '@bs/api-client';

const STALE = 30_000;

export function useMyBookings() {
  return useQuery({
    queryKey: ['account', 'bookings'],
    queryFn: ({ signal }) => listMyBookings(signal),
    staleTime: STALE,
    retry: false,
  });
}

/** Éligibilité remboursement d'une réservation (chargée à l'ouverture du parcours d'annulation). */
export function useBookingRefundEligibility(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['account', 'booking-refund-eligibility', bookingId],
    queryFn: () => getBookingRefundEligibility(bookingId as string),
    enabled: Boolean(bookingId),
    staleTime: 0,
    retry: false,
  });
}

/** Annulation d'une réservation. Rafraîchit la liste des rendez-vous au succès. */
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => cancelMyBooking(bookingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account', 'bookings'] }),
  });
}

export function useMyGiftCards() {
  return useQuery({
    queryKey: ['account', 'gift-cards'],
    queryFn: ({ signal }) => listMyGiftCards(signal),
    staleTime: STALE,
    retry: false,
  });
}

export function useMyGiftCard(cardId: string | undefined) {
  return useQuery({
    queryKey: ['account', 'gift-card', cardId],
    queryFn: () => getMyGiftCard(cardId as string),
    enabled: Boolean(cardId),
    staleTime: STALE,
    retry: false,
  });
}

export function useMySales() {
  return useQuery({
    queryKey: ['account', 'sales'],
    queryFn: ({ signal }) => listMySales(signal),
    staleTime: STALE,
    retry: false,
  });
}

/** Profil client (RX4 S2 : GET /api/client/profile — source fiable du prénom pour l'accueil). */
export function useMyProfile() {
  return useQuery({
    queryKey: ['account', 'profile'],
    queryFn: ({ signal }) => getMyProfile(signal),
    staleTime: 60_000,
    retry: false,
  });
}

/** Soumission d'un avis formation. Pas d'invalidation (backend sans lecture de statut). */
export function useSubmitReview() {
  return useMutation({
    mutationFn: (input: { formationId: string } & SubmitReviewInput) =>
      submitFormationReview(input.formationId, { rating: input.rating, comment: input.comment }),
  });
}

// Prénom édité en session (fallback S1 quand GET profil indisponible). Persisté localement pour l'accueil.
const FIRST_NAME_KEY = 'bs.account.firstName';

export function readStoredFirstName(): string {
  try {
    return localStorage.getItem(FIRST_NAME_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredFirstName(value: string): void {
  try {
    if (value) localStorage.setItem(FIRST_NAME_KEY, value);
    else localStorage.removeItem(FIRST_NAME_KEY);
  } catch {
    /* stockage indisponible : accueil retombe sur l'e-mail */
  }
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstName?: string; lastName?: string }) => updateMyProfile(input),
    onSuccess: (profile) => {
      writeStoredFirstName(profile.firstName);
      qc.setQueryData(['account', 'profile'], profile);
    },
  });
}
