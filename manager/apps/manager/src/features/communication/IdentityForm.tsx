// M4 — Formulaire de création d'identité (email + displayName). Aucun secret.
import { useState, type FormEvent } from 'react';
import { Button, Card } from '@bs/ui';

export interface IdentityFormProps {
  roleLabel: string;
  pending?: boolean;
  errorMessage?: string | null;
  onSubmit: (input: { email: string; displayName: string }) => void;
}

export function IdentityForm({ roleLabel, pending = false, errorMessage = null, onSubmit }: IdentityFormProps) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();
    if (!trimmedEmail || !trimmedName) return;
    onSubmit({ email: trimmedEmail, displayName: trimmedName });
  }

  const valid = email.trim().length > 3 && email.includes('@') && displayName.trim().length > 0;

  return (
    <Card>
      <form className="cc-form" onSubmit={handleSubmit} aria-label={`Créer une identité ${roleLabel}`}>
        <div className="cc-field">
          <label className="cc-label" htmlFor="cc-identity-email">Adresse e-mail expéditeur</label>
          <input
            id="cc-identity-email"
            className="cc-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`${roleLabel.toLowerCase()}@beautysavage.fr`}
          />
        </div>
        <div className="cc-field">
          <label className="cc-label" htmlFor="cc-identity-name">Nom affiché</label>
          <input
            id="cc-identity-name"
            className="cc-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`Beauty Savage ${roleLabel}`}
          />
        </div>
        {errorMessage ? <p className="cc-inline-error">{errorMessage}</p> : null}
        <div className="cc-actions">
          <Button type="submit" disabled={!valid || pending}>
            {pending ? 'Création…' : `Créer l'identité ${roleLabel}`}
          </Button>
        </div>
      </form>
    </Card>
  );
}
