// RX-BLOCKER-2 — Réinitialisation mot de passe manager (/manager/reinitialiser-mot-de-passe/:token). Réutilise
// l'engine reset partagé (validate + complete) ; le backend route déjà l'expéditeur (support pour admin/dev).
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ErrorState, FormField, LoadingState, TextInput } from '@bs/ui';
import { validateResetToken, completePasswordReset, ApiError } from '@bs/api-client';
import { ManagerAuthShell, passwordError } from './ManagerAuthShell';

type State = 'loading' | 'valid' | 'invalid';

export function ManagerResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>('loading');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  const pwId = useId(); const cfId = useId();

  useEffect(() => {
    let active = true;
    const t = (token || '').trim();
    if (!t) { setState('invalid'); return; }
    validateResetToken(t)
      .then(() => { if (active) setState('valid'); })
      .catch(() => { if (active) setState('invalid'); });
    return () => { active = false; };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = passwordError(password, confirm);
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try { await completePasswordReset((token || '').trim(), password); setDone(true); }
    catch (e2) {
      // Token consommé/expiré entre-temps.
      if (e2 instanceof ApiError && /invalid|used|expired/i.test(String((e2.body as { error?: string })?.error))) {
        setState('invalid'); return;
      }
      setErr(e2 instanceof ApiError ? e2.message : 'Réinitialisation impossible.'); setBusy(false);
    }
  }

  if (state === 'loading') return <ManagerAuthShell title="Réinitialisation"><LoadingState label="Vérification du lien…" /></ManagerAuthShell>;
  if (done) return <ManagerAuthShell title="Mot de passe modifié"><p className="ma__ok"><i className="bi bi-check-circle" aria-hidden="true" /> C’est fait.</p><Link className="bs-btn" to="/login">Se connecter</Link></ManagerAuthShell>;
  if (state === 'invalid') {
    return <ManagerAuthShell title="Lien invalide ou expiré"><ErrorState title="Ce lien de réinitialisation n’est plus valide." detail="Il a peut-être expiré ou déjà été utilisé." /><p><Link className="bs-btn bs-btn--secondary" to="/mot-de-passe-oublie">Demander un nouveau lien</Link></p></ManagerAuthShell>;
  }
  return (
    <ManagerAuthShell title="Nouveau mot de passe">
      <form className="ma__form" onSubmit={onSubmit}>
        <FormField label="Mot de passe" htmlFor={pwId} hint="Au moins 8 caractères, une lettre et un chiffre.">
          <TextInput id={pwId} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirmer le mot de passe" htmlFor={cfId}>
          <TextInput id={cfId} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        {err ? <ErrorState title={err} /> : null}
        <Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Réinitialiser'}</Button>
      </form>
    </ManagerAuthShell>
  );
}
