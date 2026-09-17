// RX4 S2 — Avis client (formations uniquement — le backend n'a pas d'avis prestation/produit).
// POST crée l'avis (gating serveur : formation possédée, un seul avis/user). Aucune lecture de statut côté
// client (modération C3 opaque). Le serveur fait foi.
import { apiPost } from '../apiFetch';

export interface SubmitReviewInput {
  rating: number; // 1..5
  comment?: string;
}

/**
 * POST /api/client/formations/:id/review — soumet une note (1..5) + commentaire optionnel.
 * Lève ApiError si non possédée ou déjà noté (409). Réponse backend minimale ({ ok:true }).
 */
export async function submitFormationReview(formationId: string, input: SubmitReviewInput): Promise<void> {
  await apiPost(`/api/client/formations/${encodeURIComponent(formationId)}/review`, {
    rating: input.rating,
    comment: input.comment ?? '',
  });
}
