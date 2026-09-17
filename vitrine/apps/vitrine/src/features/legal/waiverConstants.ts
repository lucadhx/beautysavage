// RX3 S3 — Miroir EXACT des textes de renonciation backend (constants/consumerWaiver.js).
// Le backend valide par correspondance de texte (NFC) : ces chaînes DOIVENT rester identiques
// à la source backend, sinon `LEGAL_CONSENT_REQUIRED`. Ne pas « corriger » les accents.

export const CHECKOUT_CGV_TEXT = 'J ai lu et j accepte les CGV';

export const DISTANT_LEARNING_WAIVER_TEXT =
  'Je demande l acces immediat a la formation et renonce a mon droit de retractation de 14 jours';

export const PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT =
  'Je renonce a mon droit de retractation car la formation a lieu dans moins de 14 jours';

export const PRESENTIEL_WAIVER_WITHIN_7_TEXT = 'Je reconnais que la reservation est ferme et non remboursable';

export const RETRACTATION_DAYS = 14;

function normalizeRefundDays(value?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, parsed);
}

/** Renonciation présentielle requise si la session est dans la fenêtre rétractation/remboursement. */
export function isPresentielWaiverRequired(daysBeforeFormation: number, refundDays?: number): boolean {
  if (!Number.isFinite(daysBeforeFormation)) return false;
  return daysBeforeFormation < Math.max(RETRACTATION_DAYS, normalizeRefundDays(refundDays));
}
