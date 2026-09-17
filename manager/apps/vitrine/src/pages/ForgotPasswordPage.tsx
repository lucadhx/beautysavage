// RX-GO-2 — Mot de passe oublié React (POST /auth/password-reset/request). Réponse toujours « succès »
// (le backend ne révèle pas l'existence du compte). Réutilise l'endpoint existant.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, TextInput } from '@bs/ui';
import { requestPasswordReset } from '@bs/api-client';
import { AuthShell } from '../features/auth/components';
import { isEmailValid } from '../features/auth/validation';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isEmailValid(email) || submitting) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Vérifiez votre boîte e-mail" footer={<Link to="/connexion">Retour à la connexion</Link>}>
        <div className="bs-auth__notice bs-auth__notice--ok" role="status">
          <i className="bi bi-envelope-check" aria-hidden="true" />
          <div>Si un compte existe avec cette adresse, un lien de réinitialisation vient d’être envoyé.</div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Saisissez votre e-mail : nous vous enverrons un lien de réinitialisation."
      footer={<Link to="/connexion">Retour à la connexion</Link>}
    >
      <form onSubmit={onSubmit}>
        <FormField label="E-mail" htmlFor="fp-email" required>
          <TextInput id="fp-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={submitting || !isEmailValid(email)}>
          {submitting ? 'Envoi…' : 'Envoyer le lien'}
        </Button>
      </form>
    </AuthShell>
  );
}
