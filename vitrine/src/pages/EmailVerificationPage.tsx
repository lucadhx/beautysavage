import * as React from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2, MailCheck, RotateCw } from 'lucide-react';
import { useCustomer } from '@/context/CustomerContext';
import { customerApi, customerTokenStore } from '@/lib/api';

const LENGTH = 6;

/**
 * VÉRIFIER SON E-MAIL — la seule page accessible à un compte non vérifié.
 * Six cases pour le code reçu par e-mail (collage accepté), un renvoi, et la
 * possibilité de changer de compte. Vérifiée, la cliente repart là où elle
 * allait (ou dans son espace).
 */
export default function EmailVerificationPage() {
  const { customer, loading, refresh, signOutNow } = useCustomer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const retour = params.get('retour') || '';
  const target = /^\/(?!\/)[^\s]*$/.test(retour) && !retour.startsWith('/verification-email') ? retour : '/espace-client';
  const [digits, setDigits] = React.useState<string[]>(Array(LENGTH).fill(''));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [done, setDone] = React.useState(false);
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);

  if (!loading && !customer) return <Navigate to="/connexion-client" replace />;
  if (!loading && customer?.emailVerified && !done) return <Navigate to={target} replace />;

  const code = digits.join('');

  async function submit(value = code) {
    if (value.length !== LENGTH) { setError('Saisissez les 6 chiffres reçus par e-mail.'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      const result = await customerApi.verifyEmail(value);
      customerTokenStore.set(result.token);
      setDone(true);
      await refresh();
      window.setTimeout(() => navigate(target, { replace: true }), 1300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code incorrect. Vérifiez-le et réessayez.');
      setDigits(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setAt(i: number, raw: string) {
    const only = raw.replace(/\D/g, '');
    if (only.length > 1) {
      const next = only.slice(0, LENGTH).split('');
      const filled = [...next, ...Array(LENGTH - next.length).fill('')];
      setDigits(filled);
      inputs.current[Math.min(next.length, LENGTH - 1)]?.focus();
      if (next.length === LENGTH) void submit(next.join(''));
      return;
    }
    const next = [...digits];
    next[i] = only;
    setDigits(next);
    setError('');
    if (only && i < LENGTH - 1) inputs.current[i + 1]?.focus();
    if (next.every(Boolean)) void submit(next.join(''));
  }

  async function resend() {
    setError(''); setInfo('');
    try {
      const r = await customerApi.requestEmailVerification();
      setInfo(r.verificationCode ? `${r.message} Code TEST : ${r.verificationCode}` : r.message || 'Un nouveau code vient de vous être envoyé.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible pour le moment.');
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center px-4 pb-16 pt-28" data-testid="verify-page">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-2xl border p-6 text-center shadow-2xl sm:p-8" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></motion.span>
              <h1 className="mt-4 text-2xl font-semibold">Adresse confirmée</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Bienvenue ! Vous pouvez maintenant réserver et acheter.</p>
            </motion.div>
          ) : (
            <motion.div key="form">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-accent) 18%, transparent)', color: 'var(--v-accent)' }}><MailCheck className="h-7 w-7" /></span>
              <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">Vérifiez votre e-mail</h1>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
                Nous avons envoyé un code à 6 chiffres à <strong style={{ color: 'var(--v-foreground)' }}>{customer?.email}</strong>. Saisissez-le pour activer votre compte.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-6">
                <motion.div animate={error ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }} transition={{ duration: 0.35 }} className="flex justify-center gap-1.5 sm:gap-2">
                  {digits.map((d, i) => (
                    <input key={i} ref={(el) => { inputs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={LENGTH}
                      onChange={(e) => setAt(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus(); }}
                      aria-label={`Chiffre ${i + 1}`} data-testid="otp-digit"
                      className="v-field h-12 w-10 rounded-lg text-center text-xl font-semibold sm:h-14 sm:w-12" />
                  ))}
                </motion.div>
                <AnimatePresence>
                  {error && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" data-testid="otp-error"
                      className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                    </motion.p>
                  )}
                </AnimatePresence>
                {info && <p className="mt-4 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--v-border)' }}>{info}</p>}
                <button disabled={busy} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md font-semibold disabled:opacity-70" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="otp-submit">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Vérifier mon e-mail
                </button>
              </form>
              <button type="button" onClick={resend} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold"><RotateCw className="h-4 w-4" /> Renvoyer un code</button>
              <p className="mt-6 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                Pas le bon compte ? <button type="button" onClick={() => { signOutNow(); navigate('/connexion-client', { replace: true }); }} className="font-semibold underline">Utiliser une autre adresse</button>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
