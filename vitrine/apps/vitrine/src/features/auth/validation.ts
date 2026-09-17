// RX-GO-2 — Validation auth PURE (miroir des règles backend : e-mail, mot de passe min 8 + lettre + chiffre).
// Le serveur reste l'autorité ; ceci n'est qu'un guidage instantané côté client.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailValid(email: string): boolean {
  return EMAIL_RE.test(String(email || '').trim());
}

/** Renvoie un message d'erreur, ou null si le mot de passe respecte la politique (8+ , lettre, chiffre). */
export function passwordError(password: string): string | null {
  const pw = String(password || '');
  if (pw.length < 8) return 'Au moins 8 caractères.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Doit contenir au moins une lettre et un chiffre.';
  return null;
}

/** Normalise un code de vérification : chiffres uniquement, 6 max. */
export function normalizeCode(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

export function isCodeComplete(code: string): boolean {
  return /^\d{6}$/.test(code);
}
