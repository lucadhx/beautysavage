// RX-GO-2 — Vérification e-mail React (POST /auth/verify-email + resend). Code 6 chiffres, cooldown 30s,
// pose le cookie de session au succès → connecté. Réutilise les endpoints existants.
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ErrorState, FormField, TextInput } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { verifyEmail, resendVerification, ApiError } from '@bs/api-client';
import { AuthShell } from '../features/auth/components';
import { normalizeCode, isCodeComplete } from '../features/auth/validation';

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const email = (params.get('email') || '').trim();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(30);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) { if (timer.current) clearInterval(timer.current); return; }
    timer.current = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [cooldown]);

  if (!email) {
    return (
      <AuthShell title="Vérification de l’e-mail">
        <ErrorState title="Lien incomplet." detail="Reprenez la création de compte." />
        <Link className="bs-btn" to="/inscription" style={{ marginTop: 'var(--bs-space-2)' }}>Créer un compte</Link>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isCodeComplete(code) || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await verifyEmail(email, code);
      await refresh(); // le cookie est posé → recharge /auth/me
      navigate('/mon-compte');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible. Réessayez.');
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (cooldown > 0) return;
    setError('');
    try {
      const res = await resendVerification(email);
      setCooldown(res.resendAfterSeconds ?? 30);
    } catch (err) {
      // 429 : throttle → repartir sur retryAfterSeconds si fourni.
      const retry = err instanceof ApiError ? Number((err.body as { retryAfterSeconds?: number })?.retryAfterSeconds || 0) : 0;
      if (retry > 0) setCooldown(retry);
      else setError(err instanceof ApiError ? err.message : 'Envoi impossible. Réessayez.');
    }
  }

  return (
    <AuthShell title="Vérifiez votre e-mail" subtitle={`Un code à 6 chiffres a été envoyé à ${email}.`}>
      <form onSubmit={onSubmit}>
        <FormField label="Code de vérification" htmlFor="ve-code" required>
          <div className="bs-auth__code">
            <TextInput id="ve-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="••••••" />
          </div>
        </FormField>
        {error ? <ErrorState title="Vérification impossible." detail={error} /> : null}
        <Button type="submit" disabled={submitting || !isCodeComplete(code)}>
          {submitting ? 'Vérification…' : 'Confirmer'}
        </Button>
        <button type="button" className="bs-auth__resend" onClick={onResend} disabled={cooldown > 0}>
          <i className="bi bi-arrow-repeat" aria-hidden="true" />
          {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : 'Renvoyer le code'}
        </button>
      </form>
    </AuthShell>
  );
}
