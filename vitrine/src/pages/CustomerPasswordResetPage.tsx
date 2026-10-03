import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { customerApi, customerTokenStore } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';

/**
 * CHOISIR SON MOT DE PASSE — depuis le lien reçu par e-mail : « Votre espace
 * client est prêt » (compte ouvert par l'institut, `bienvenue=1`) ou « mot de
 * passe oublié ». Le lien prouve l'adresse : une fois le mot de passe choisi,
 * la cliente est connectée et arrive dans son espace, sans code OTP.
 */
export default function CustomerPasswordResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useCustomer();
  const token = params.get('token') || '';
  const welcome = params.get('bienvenue') === '1';
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError('Choisissez au moins 8 caractères.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await customerApi.resetPassword({ token, password });
      setDone(true);
      if (result.token) {
        customerTokenStore.set(result.token);
        await refresh();
        window.setTimeout(() => navigate('/espace-client', { replace: true }), 1300);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lien invalide ou expiré.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto min-h-screen max-w-md px-4 pb-24 pt-28 sm:px-5 md:px-8 md:pt-32" data-testid="password-page">
      <h1 className="text-3xl font-semibold sm:text-4xl">{welcome ? 'Bienvenue !' : 'Nouveau mot de passe'}</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
        {welcome ? 'Votre espace client a été créé lors de votre réservation. Choisissez votre mot de passe pour y accéder.' : 'Choisissez un nouveau mot de passe pour votre espace client.'}
      </p>
      {done ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mt-8 grid justify-items-center rounded-2xl border p-6 text-center" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="password-done">
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }} className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></motion.span>
          <p className="mt-3 text-lg font-semibold">Mot de passe enregistré</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Ouverture de votre espace client…</p>
        </motion.div>
      ) : (
        <form onSubmit={submit} className="mt-8 rounded-2xl border p-5 shadow-xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          {!token && <p className="mb-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Lien manquant : ouvrez le lien reçu par e-mail.</p>}
          <label className="block text-sm font-medium">
            Mot de passe
            <input className="v-field mt-2 w-full rounded-md px-3 py-3" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} data-testid="new-password" />
          </label>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>8 caractères minimum.</p>
          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }} data-testid="password-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          <button disabled={!token || busy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="password-submit">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {welcome ? 'Activer mon espace' : 'Enregistrer'}
          </button>
          <Link to="/connexion-client" className="mt-4 inline-flex text-sm font-semibold">Retour à la connexion</Link>
        </form>
      )}
    </section>
  );
}
