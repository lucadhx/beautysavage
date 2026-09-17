// RX-GO-2 — Connexion React autonome (POST /auth/login). Afficher/masquer mot de passe, liens inscription /
// mot de passe oublié, prise en charge du 403 EMAIL_NOT_VERIFIED (proposer la vérification). Redirect sûr.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ErrorState, FormField, TextInput } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { login, ApiError } from '@bs/api-client';
import { useCart } from '../features/cart/CartProvider';
import { AuthShell, PasswordField } from '../features/auth/components';

// N'accepte qu'une cible interne (anti open-redirect) : commence par "/" mais pas "//".
function safeRedirect(raw: string | null, fallback: string): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return fallback;
}

export function LoginPage() {
  const { refresh } = useAuth();
  const { items } = useCart();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);

  const fallback = items.length > 0 ? '/checkout' : '/';
  const redirectTo = safeRedirect(params.get('redirect'), fallback);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setNeedsVerify(false);
    try {
      await login(email.trim(), password);
      await refresh();
      navigate(redirectTo);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerify(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Connexion impossible. Réessayez.');
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Connexion"
      subtitle="Ravis de vous revoir — accédez à votre espace beauté."
      icon="bi-person-hearts"
      footer={
        <>
          <span>Pas encore de compte ? <Link to="/inscription">Créer un compte</Link></span>
          <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <FormField label="E-mail" htmlFor="li-email" required>
          <TextInput id="li-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <PasswordField label="Mot de passe" value={password} onChange={setPassword} autoComplete="current-password" id="li-pw" />
        {needsVerify ? (
          <div className="bs-auth__notice bs-auth__notice--info" role="status">
            <i className="bi bi-envelope-exclamation" aria-hidden="true" />
            <div>
              Votre e-mail n’est pas encore vérifié.{' '}
              <Link to={`/verify-email?email=${encodeURIComponent(email.trim())}`}>Vérifier maintenant</Link>.
            </div>
          </div>
        ) : null}
        {error ? <ErrorState title="Échec de la connexion." detail={error} /> : null}
        <Button type="submit" className="bs-auth__submit" disabled={submitting}>
          <i className={`bi ${submitting ? 'bi-arrow-repeat bs-auth__spin' : 'bi-box-arrow-in-right'}`} aria-hidden="true" />
          {submitting ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </AuthShell>
  );
}
