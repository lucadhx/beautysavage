// RX-GO-2 — Connexion manager React (réutilise POST /auth/login). Remplace le placeholder : les rôles
// admin/dev accèdent au manager ; un rôle client est refusé. Aucun métier nouveau.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Button, ErrorState } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { login, ApiError } from '@bs/api-client';

export function ManagerLoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await login(email.trim(), password);
      if (res.role !== 'admin' && res.role !== 'dev') {
        setError('Cet espace est réservé aux gestionnaires.');
        setSubmitting(false);
        return;
      }
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible. Réessayez.');
      setSubmitting(false);
    }
  }

  return (
    <section style={{ maxWidth: 420, margin: '0 auto', padding: 'var(--bs-space-4) var(--bs-space-2)' }}>
      <Card>
        <h1 style={{ marginTop: 0 }}>Connexion — Gestion</h1>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--bs-space-3)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>E-mail</span>
            <input className="bs-input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Mot de passe</span>
            <input className="bs-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? <ErrorState title="Échec de la connexion." detail={error} /> : null}
          <Button type="submit" disabled={submitting}>{submitting ? 'Connexion…' : 'Se connecter'}</Button>
          {/* RX-BLOCKER-2 — reset manager (e-mail envoyé par le support) */}
          <Link to="/mot-de-passe-oublie" style={{ textAlign: 'center', fontSize: '0.9rem' }}>Mot de passe oublié ?</Link>
        </form>
      </Card>
    </section>
  );
}
