// RX-GO-2 — Inscription React (réutilise POST /auth/signup ; aucun métier nouveau). Validation instantanée
// (miroir politique backend : 8+ / lettre / chiffre) ; envoie un code de vérification puis redirige.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ErrorState, FormField, TextInput } from '@bs/ui';
import { signup, ApiError } from '@bs/api-client';
import { AuthShell, PasswordField, friendlyAuthError } from '../features/auth/components';
import { isEmailValid, passwordError } from '../features/auth/validation';

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const pwErr = touched ? passwordError(password) : null;
  const matchErr = touched && confirm && password !== confirm ? 'Les mots de passe ne correspondent pas.' : null;
  const emailErr = touched && email && !isEmailValid(email) ? 'Adresse e-mail invalide.' : null;
  const canSubmit = isEmailValid(email) && !passwordError(password) && password === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await signup(email.trim(), password, confirm);
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      // 409 EMAIL_NOT_VERIFIED_PENDING : le compte existe mais l'e-mail n'est pas confirmé → aller vérifier.
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED_PENDING') {
        navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(friendlyAuthError(err, 'Inscription impossible. Réessayez.'));
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Rejoignez Beauty Savage pour réserver et suivre vos formations."
      footer={<span>Déjà un compte ? <Link to="/connexion">Se connecter</Link></span>}
    >
      <form onSubmit={onSubmit} noValidate>
        <FormField label="E-mail" htmlFor="su-email" required error={emailErr}>
          <TextInput id="su-email" type="email" autoComplete="email" value={email} invalid={Boolean(emailErr)}
            onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <PasswordField label="Mot de passe" value={password} onChange={setPassword} autoComplete="new-password"
          hint="8 caractères minimum, avec au moins une lettre et un chiffre." error={pwErr} id="su-pw" />
        <PasswordField label="Confirmer le mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password"
          error={matchErr} id="su-confirm" />
        {error ? <ErrorState title="Échec de l’inscription." detail={error} /> : null}
        <Button type="submit" disabled={submitting || (touched && !canSubmit)}>
          {submitting ? 'Création…' : 'Créer mon compte'}
        </Button>
        <p className="bs-note" style={{ fontSize: '0.8rem', color: 'var(--bs-color-muted)', margin: 0 }}>
          En créant un compte, vous acceptez nos <Link to="/cgv">CGV</Link> et notre{' '}
          <Link to="/confidentialite">politique de confidentialité</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
