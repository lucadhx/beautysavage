// RX-GO-2 — Réinitialisation mot de passe React. Valide le token (POST /auth/password-reset/validate) avant
// d'afficher le formulaire, puis POST /auth/password-reset/complete. Réutilise les endpoints existants.
import { useState, useEffect, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, ErrorState, LoadingState } from '@bs/ui';
import { validateResetToken, completePasswordReset, ApiError } from '@bs/api-client';
import { AuthShell, PasswordField, friendlyAuthError } from '../features/auth/components';
import { passwordError } from '../features/auth/validation';

type TokenState = 'checking' | 'valid' | 'invalid';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) { setTokenState('invalid'); return; }
    validateResetToken(token)
      .then(() => { if (active) setTokenState('valid'); })
      .catch(() => { if (active) setTokenState('invalid'); });
    return () => { active = false; };
  }, [token]);

  const pwErr = touched ? passwordError(password) : null;
  const matchErr = touched && confirm && password !== confirm ? 'Les mots de passe ne correspondent pas.' : null;
  const canSubmit = !passwordError(password) && password === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await completePasswordReset(token, password);
      setDone(true);
    } catch (err) {
      // Token consommé/expiré entre-temps.
      if (err instanceof ApiError && /invalid|used|expired/i.test(String(err.body && (err.body as { error?: string }).error))) {
        setTokenState('invalid');
        return;
      }
      setError(friendlyAuthError(err, 'Réinitialisation impossible. Réessayez.'));
      setSubmitting(false);
    }
  }

  if (tokenState === 'checking') return <AuthShell title="Réinitialisation"><LoadingState label="Vérification du lien…" /></AuthShell>;

  if (tokenState === 'invalid') {
    return (
      <AuthShell title="Lien invalide ou expiré" footer={<Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link>}>
        <ErrorState title="Ce lien de réinitialisation n’est plus valide." detail="Il a peut-être expiré ou déjà été utilisé." />
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Mot de passe réinitialisé" footer={<Link to="/connexion">Se connecter</Link>}>
        <div className="bs-auth__notice bs-auth__notice--ok" role="status">
          <i className="bi bi-check2-circle" aria-hidden="true" />
          <div>Votre mot de passe a bien été mis à jour. Connectez-vous avec votre nouveau mot de passe.</div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choisir un nouveau mot de passe">
      <div className="bs-auth__notice bs-auth__notice--info">
        <i className="bi bi-shield-check" aria-hidden="true" />
        <div>Lien validé. Choisissez un nouveau mot de passe.</div>
      </div>
      <form onSubmit={onSubmit}>
        <PasswordField label="Nouveau mot de passe" value={password} onChange={setPassword} autoComplete="new-password"
          hint="8 caractères minimum, avec au moins une lettre et un chiffre." error={pwErr} id="rp-pw" />
        <PasswordField label="Confirmer le mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password"
          error={matchErr} id="rp-confirm" />
        {error ? <ErrorState title="Échec." detail={error} /> : null}
        <Button type="submit" disabled={submitting || (touched && !canSubmit)}>
          {submitting ? 'Enregistrement…' : 'Réinitialiser mon mot de passe'}
        </Button>
      </form>
    </AuthShell>
  );
}
