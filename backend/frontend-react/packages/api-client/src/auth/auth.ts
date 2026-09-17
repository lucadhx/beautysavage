// Authentification client léger (R2C). Le cookie de session (HttpOnly) est posé par le backend ;
// React n'écrit JAMAIS de token. getSession/logout vivent dans ../endpoints (réexportés via l'index).
import { apiPost } from '../apiFetch';
import type { Role } from '../types';

export interface LoginResponse {
  ok: boolean;
  role?: Role;
  currentMode?: string;
  mustChangePassword?: boolean;
  /** Cas admin (onboarding) — non utilisé côté client vitrine. */
  blocked?: boolean;
  reason?: string;
}

/** POST /auth/login — pose le cookie de session. Lève ApiError (401) si identifiants invalides. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { email, password });
}

// RX-GO-2 — Écrans auth React autonomes. Réutilise les endpoints existants (aucun métier nouveau).

export interface SignupResponse {
  ok: boolean;
  email: string;
  /** Expiration du code de vérification (10 min). */
  expiresAt?: string;
  /** Délai avant de pouvoir renvoyer un code (30 s). */
  resendAfterSeconds?: number;
}

/** POST /auth/signup — crée le compte (client) et envoie le code de vérification. */
export async function signup(email: string, password: string, passwordConfirm: string): Promise<SignupResponse> {
  return apiPost<SignupResponse>('/auth/signup', { email, password, passwordConfirm });
}

export interface VerifyEmailResponse {
  ok: boolean;
  role?: Role;
  currentMode?: string;
  mustChangePassword?: boolean;
}

/** POST /auth/verify-email — confirme l'e-mail via code 6 chiffres ; pose le cookie de session au succès. */
export async function verifyEmail(email: string, code: string): Promise<VerifyEmailResponse> {
  return apiPost<VerifyEmailResponse>('/auth/verify-email', { email, code });
}

export interface ResendVerificationResponse {
  ok: boolean;
  email?: string;
  resendAfterSeconds?: number;
}

/** POST /auth/resend-verification — renvoie un code (cooldown 30 s ; 429 throttle avec retryAfterSeconds). */
export async function resendVerification(email: string): Promise<ResendVerificationResponse> {
  return apiPost<ResendVerificationResponse>('/auth/resend-verification', { email });
}

export interface ValidateResetResponse {
  ok: boolean;
  expiresAt?: string;
}

/** POST /auth/password-reset/validate — vérifie l'état d'un token de reset (avant d'afficher le formulaire). */
export async function validateResetToken(token: string): Promise<ValidateResetResponse> {
  return apiPost<ValidateResetResponse>('/auth/password-reset/validate', { token });
}

/** POST /auth/password-reset/complete — pose le nouveau mot de passe (min 8). Invalide les sessions. */
export async function completePasswordReset(token: string, password: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/auth/password-reset/complete', { token, password });
}
