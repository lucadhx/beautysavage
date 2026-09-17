// Dictionnaire codes erreur backend → action UX (cf. rapports 135 / 148).
// Règle : ne JAMAIS se fier au texte `error` ; mapper le `code`.

export type ErrorUxKind =
  | 'state_page' // page d'état plein écran (maintenance / contrat / suspension)
  | 'logout' // forcer déconnexion
  | 'role_denied' // écran refus de rôle
  | 'inline' // erreur inline (formulaire / checkout)
  | 'retry' // re-fetch puis retry transparent
  | 'redirect_payment' // rediriger vers paiement / chemin 0 €
  | 'toast' // toast + CTA adapté
  | 'login' // rediriger vers login
  | 'onboarding'; // onboarding contrat (login manager bloqué)

export interface ErrorUxEntry {
  ux: ErrorUxKind;
  message: string;
}

export const ERROR_CODE_UX: Record<string, ErrorUxEntry> = {
  MAINTENANCE: { ux: 'state_page', message: 'Le site est en maintenance.' },
  CONTRACT_INACTIVE: { ux: 'state_page', message: 'Le contrat n’est pas actif.' },
  SITE_SUSPENDED: { ux: 'state_page', message: 'Le site est suspendu.' },
  SUSPENDED_ADMIN_LOGOUT: { ux: 'logout', message: 'Session suspendue, reconnexion requise.' },
  FORBIDDEN_GESTION_ROLE: { ux: 'role_denied', message: 'Accès réservé.' },
  LEGAL_CONSENT_REQUIRED: { ux: 'inline', message: 'Veuillez accepter les conditions.' },
  CHECKOUT_AMOUNT_MISMATCH: { ux: 'retry', message: 'Le montant a changé, nouvelle tentative…' },
  AMOUNT_TOO_LOW: { ux: 'redirect_payment', message: 'Montant insuffisant.' },
  PAYMENT_REQUIRED: { ux: 'redirect_payment', message: 'Paiement requis.' },
  SESSION_FULL: { ux: 'toast', message: 'Cette session est complète.' },
  ALREADY_PURCHASED: { ux: 'toast', message: 'Déjà acheté.' },
  OFFER_ACCESS_UNAVAILABLE: { ux: 'toast', message: 'Offre indisponible.' },
  OFFER_BALANCE_UNSUPPORTED: { ux: 'toast', message: 'Offre indisponible.' },
};

/** Résout l'action UX d'un code erreur ; `inline` par défaut. */
export function resolveErrorUx(code: string | undefined | null): ErrorUxEntry {
  if (code && ERROR_CODE_UX[code]) return ERROR_CODE_UX[code];
  return { ux: 'inline', message: 'Une erreur est survenue.' };
}
