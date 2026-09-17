// RX-BLOCKER-2 — Mot de passe oublié manager (/manager/mot-de-passe-oublie). Réutilise l'endpoint reset ; le
// backend route l'expéditeur (support pour admin/dev). Message neutre (anti-énumération).
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, TextInput } from '@bs/ui';
import { requestPasswordReset } from '@bs/api-client';
import { ManagerAuthShell } from './ManagerAuthShell';

export function ManagerForgotPasswordPage() {
  const emId = useId();
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); if (!email.trim() || busy) return;
    setBusy(true);
    try { await requestPasswordReset(email.trim()); } finally { setSent(true); }
  }
  return (
    <ManagerAuthShell title="Mot de passe oublié">
      {sent ? (
        <>
          <p className="ma__meta">Si un compte de gestion existe avec cet e-mail, un lien de réinitialisation vient d’être envoyé.</p>
          <Link className="bs-btn bs-btn--secondary" to="/login">Retour à la connexion</Link>
        </>
      ) : (
        <form className="ma__form" onSubmit={onSubmit}>
          <FormField label="Adresse e-mail" htmlFor={emId}>
            <TextInput id={emId} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Envoi…' : 'Envoyer le lien'}</Button>
          <p><Link className="ma__meta" to="/login">Retour à la connexion</Link></p>
        </form>
      )}
    </ManagerAuthShell>
  );
}
