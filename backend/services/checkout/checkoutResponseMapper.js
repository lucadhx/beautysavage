// services/checkout/checkoutResponseMapper.js
// Sprint F1 — Mapping erreur → réponse HTTP du checkout. Centralise les formes de réponse
// publiques pour garantir des statuts/payloads IDENTIQUES après extraction. Aucune logique
// métier ; pur mapping (les effets de bord — log serveur — restent côté facade/handler).

// Précondition (legal/offer) : l'erreur est déjà normalisée (status/code fixés) par
// checkoutValidationService. On reflète exactement la réponse de l'ancien handler.
export function mapCheckoutValidationError(error) {
  return {
    status: Number(error?.status) || 400,
    body: {
      ok: false,
      error: error?.message || 'Consentement légal requis.',
      code: error?.code || 'LEGAL_CONSENT_REQUIRED'
    }
  };
}

// Échec de finalisation (générique) : statut sûr (400–599 sinon 500), payload identique.
// `shouldLog` indique si l'ancien handler aurait loggé (>= 500) — le log reste à l'appelant.
export function mapCheckoutFinalizationError(error) {
  const status = Number(error?.status || 0);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  return {
    status: safeStatus,
    shouldLog: safeStatus >= 500,
    body: {
      ok: false,
      error: error?.message || 'Finalisation impossible.',
      code: error?.code || null
    }
  };
}
