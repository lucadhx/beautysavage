// RX-BLOCKER-2 — Acceptation d'invitation manager (/manager/invitation/:token). Sans auth. Affiche e-mail +
// rôle, fait choisir le mot de passe, active le compte, redirige vers la connexion.
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ErrorState, FormField, LoadingState, TextInput } from '@bs/ui';
import { getManagerInvitation, acceptManagerInvitation, ApiError, type ManagerInvitationInfo } from '@bs/api-client';
import { ManagerAuthShell, passwordError } from './ManagerAuthShell';

type Load = { state: 'loading' } | { state: 'ok'; info: ManagerInvitationInfo } | { state: 'invalid' } | { state: 'expired' } | { state: 'used' } | { state: 'error' };

export function ManagerInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  const pwId = useId(); const cfId = useId();

  useEffect(() => {
    let active = true;
    if (!token) { setLoad({ state: 'invalid' }); return; }
    getManagerInvitation(token)
      .then((info) => { if (active) setLoad({ state: 'ok', info }); })
      .catch((e) => {
        const status = e instanceof ApiError ? (e.body as { status?: string })?.status : undefined;
        if (!active) return;
        setLoad({ state: status === 'expired' ? 'expired' : status === 'used' ? 'used' : status === 'invalid' ? 'invalid' : 'error' });
      });
    return () => { active = false; };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = passwordError(password, confirm);
    if (v) { setErr(v); return; }
    setSubmitting(true); setErr('');
    try { await acceptManagerInvitation(token as string, password, confirm); setDone(true); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Activation impossible.'); setSubmitting(false); }
  }

  if (load.state === 'loading') return <ManagerAuthShell title="Invitation"><LoadingState label="Vérification du lien…" /></ManagerAuthShell>;
  if (load.state !== 'ok') {
    const map = { invalid: 'Ce lien d’invitation est invalide.', expired: 'Ce lien d’invitation a expiré.', used: 'Cette invitation a déjà été utilisée.', error: 'Une erreur est survenue.' } as const;
    return <ManagerAuthShell title="Invitation"><ErrorState title={map[load.state]} /><p><Link className="bs-btn bs-btn--secondary" to="/login">Aller à la connexion</Link></p></ManagerAuthShell>;
  }
  if (done) {
    return <ManagerAuthShell title="Compte activé"><p className="ma__ok"><i className="bi bi-check-circle" aria-hidden="true" /> Votre compte est prêt.</p><Link className="bs-btn" to="/login">Se connecter</Link></ManagerAuthShell>;
  }
  return (
    <ManagerAuthShell title="Bienvenue">
      <p className="ma__meta">Compte : <strong>{load.info.email}</strong> · Rôle : {load.info.role === 'dev' ? 'Développeur' : 'Administrateur'}</p>
      <form className="ma__form" onSubmit={onSubmit}>
        <FormField label="Mot de passe" htmlFor={pwId} hint="Au moins 8 caractères, une lettre et un chiffre.">
          <TextInput id={pwId} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirmer le mot de passe" htmlFor={cfId}>
          <TextInput id={cfId} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        {err ? <ErrorState title={err} /> : null}
        <Button type="submit" disabled={submitting}>{submitting ? 'Activation…' : 'Activer mon compte'}</Button>
      </form>
    </ManagerAuthShell>
  );
}
