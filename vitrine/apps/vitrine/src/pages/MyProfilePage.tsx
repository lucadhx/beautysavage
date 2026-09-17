// RX4 — Mon profil (P9). Backend limité à prénom/nom (cf. audit §2.2) : édition minimale + demande de
// réinitialisation du mot de passe (flux reset). Adresse/téléphone/consentements = extension backend future.
import { useState, useEffect, useId } from 'react';
import type { FormEvent } from 'react';
import { Button, Card, FormField, Skeleton, TextInput } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { requestPasswordReset } from '@bs/api-client';
import { AccountShell, useUpdateProfile, useMyProfile } from '../features/account';

export function MyProfilePage() {
  const { user } = useAuth();
  const firstId = useId();
  const lastId = useId();
  const profile = useMyProfile();
  const update = useUpdateProfile();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saved, setSaved] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Préremplissage depuis GET /api/client/profile (RX4 S2 — source fiable).
  useEffect(() => {
    if (profile.data) {
      setFirstName(profile.data.firstName);
      setLastName(profile.data.lastName);
    }
  }, [profile.data]);

  const email = profile.data?.email || user?.email || '';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    update.mutate(
      { firstName: firstName.trim(), lastName: lastName.trim() },
      { onSuccess: () => setSaved(true) },
    );
  }

  async function onResetPassword() {
    if (!email) return;
    setResetSent(false);
    try {
      await requestPasswordReset(email);
    } finally {
      setResetSent(true);
    }
  }

  return (
    <AccountShell title="Mon profil">
      <Card>
        {profile.isPending ? (
          <Skeleton variant="block" height="150px" />
        ) : (
          <form className="bs-acc-form" onSubmit={onSubmit}>
            <FormField label="Prénom" htmlFor={firstId}>
              <TextInput id={firstId} value={firstName} maxLength={64} autoComplete="given-name"
                onChange={(e) => { setFirstName(e.target.value); setSaved(false); }} />
            </FormField>
            <FormField label="Nom" htmlFor={lastId}>
              <TextInput id={lastId} value={lastName} maxLength={64} autoComplete="family-name"
                onChange={(e) => { setLastName(e.target.value); setSaved(false); }} />
            </FormField>
            <FormField label="Adresse e-mail" hint="Pour modifier votre e-mail, contactez l'institut.">
              <TextInput value={email} readOnly disabled autoComplete="email" />
            </FormField>
            <div className="bs-acc-form__actions">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
              {saved ? <span style={{ color: 'var(--bs-color-success)', alignSelf: 'center' }}><i className="bi bi-check-circle" aria-hidden="true" /> Enregistré</span> : null}
              {update.isError ? <span style={{ color: 'var(--bs-color-danger)', alignSelf: 'center' }} role="alert">Échec de la mise à jour.</span> : null}
            </div>
          </form>
        )}
      </Card>

      <Card>
        <div className="bs-acc-form">
          <div>
            <strong>Mot de passe</strong>
            <p style={{ margin: '4px 0 0', color: 'var(--bs-color-muted)', fontSize: '0.88rem' }}>
              Recevez un e-mail pour choisir un nouveau mot de passe en toute sécurité.
            </p>
          </div>
          <div className="bs-acc-form__actions">
            <Button variant="secondary" onClick={onResetPassword} disabled={!email}>
              Modifier mon mot de passe
            </Button>
            {resetSent ? <span style={{ color: 'var(--bs-color-success)', alignSelf: 'center' }}><i className="bi bi-envelope-check" aria-hidden="true" /> E-mail envoyé</span> : null}
          </div>
        </div>
      </Card>
    </AccountShell>
  );
}
