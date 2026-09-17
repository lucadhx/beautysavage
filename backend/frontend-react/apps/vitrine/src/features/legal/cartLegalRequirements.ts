// RX3 S3 — Moteur légal front (PUR) : dérive les consentements à afficher par item de panier et
// construit le payload (legal.acceptedCgv + consumerWaivers[] + refundPolicySnapshots{}). Le BACKEND
// reste autorité et re-dérive/refuse (LEGAL_CONSENT_REQUIRED) ; ici on présente les bonnes cases.
import type { CartItem } from '../cart/cartTypes';
import { isFormationItem } from '../cart/cartTypes';
import {
  CHECKOUT_CGV_TEXT,
  DISTANT_LEARNING_WAIVER_TEXT,
  PRESENTIEL_WAIVER_WITHIN_7_TEXT,
  PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
  isPresentielWaiverRequired,
} from './waiverConstants';

const DAY_MS = 86_400_000;

export type LegalRequirementId = 'cgv' | 'distanciel' | 'presentiel';

export interface LegalRequirement {
  id: LegalRequirementId;
  /** Libellé lisible de la case. */
  label: string;
  /** Texte juridique EXACT envoyé au backend (waivers) — jamais reformulé. */
  text: string;
  waiverType?: 'legal' | 'institut';
  formationIds: string[];
}

export type LegalAcceptState = Partial<Record<LegalRequirementId, boolean>>;

/** Dérive les consentements requis à partir des lignes de panier (formations). CGV toujours en tête. */
export function buildLegalRequirements(items: CartItem[], now: Date = new Date()): LegalRequirement[] {
  const reqs: LegalRequirement[] = [
    { id: 'cgv', label: 'J’accepte les conditions générales de vente.', text: CHECKOUT_CGV_TEXT, formationIds: [] },
  ];
  const formations = items.filter(isFormationItem);

  const distancielIds = formations.filter((f) => f.formationType === 'distanciel').map((f) => f.refId);
  if (distancielIds.length) {
    reqs.push({
      id: 'distanciel',
      label: 'Je demande l’accès immédiat à la formation en ligne et je renonce à mon droit de rétractation après accès.',
      text: DISTANT_LEARNING_WAIVER_TEXT,
      waiverType: 'legal',
      formationIds: [...new Set(distancielIds)],
    });
  }

  const presentielConcerned = formations.filter((f) => {
    if (f.formationType !== 'presentiel' || !f.sessionStartAt) return false;
    const days = (new Date(f.sessionStartAt).getTime() - now.getTime()) / DAY_MS;
    return isPresentielWaiverRequired(days, f.refundDays);
  });
  if (presentielConcerned.length) {
    const minDays = Math.min(
      ...presentielConcerned.map((f) => (new Date(f.sessionStartAt as string).getTime() - now.getTime()) / DAY_MS),
    );
    const within7 = minDays < 7;
    reqs.push({
      id: 'presentiel',
      label: 'J’accepte les conditions liées au rendez-vous daté sélectionné.',
      text: within7 ? PRESENTIEL_WAIVER_WITHIN_7_TEXT : PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
      waiverType: within7 ? 'legal' : 'institut',
      formationIds: [...new Set(presentielConcerned.map((f) => f.refId))],
    });
  }
  return reqs;
}

/** Vrai si TOUS les consentements requis sont cochés (bloque le paiement sinon). */
export function isLegalComplete(reqs: LegalRequirement[], accepted: LegalAcceptState): boolean {
  return reqs.every((r) => accepted[r.id] === true);
}

export interface CartLegalPayload {
  legal: { acceptedCgv: boolean };
  consumerWaivers: Array<{ type?: 'legal' | 'institut'; text: string; accepted: true; formationIds: string[] }>;
  refundPolicySnapshots: Record<string, { waiverType: 'legal' | 'institut' | null; waiverText: string; acceptedAt: string | null }>;
}

/** Construit les fragments légaux du checkoutState panier à partir de l'état coché. */
export function buildCartLegalPayload(
  reqs: LegalRequirement[],
  accepted: LegalAcceptState,
  acceptedAt: string,
): CartLegalPayload {
  const legal = { acceptedCgv: accepted.cgv === true };
  const consumerWaivers = reqs
    .filter((r) => r.id !== 'cgv' && accepted[r.id] === true)
    .map((r) => ({ type: r.waiverType, text: r.text, accepted: true as const, formationIds: r.formationIds }));

  const refundPolicySnapshots: CartLegalPayload['refundPolicySnapshots'] = {};
  for (const r of reqs) {
    if (r.id === 'cgv') continue;
    for (const fid of r.formationIds) {
      refundPolicySnapshots[fid] = {
        waiverType: r.waiverType ?? null,
        waiverText: r.text,
        acceptedAt: accepted[r.id] ? acceptedAt : null,
      };
    }
  }
  return { legal, consumerWaivers, refundPolicySnapshots };
}
