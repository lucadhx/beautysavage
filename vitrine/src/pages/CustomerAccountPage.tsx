import * as React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, LockKeyhole, MailCheck, UserPlus } from 'lucide-react';
import { useCustomer } from '@/context/CustomerContext';
import { customerApi, customerTokenStore } from '@/lib/api';
import { CustomerDashboard } from '@/components/account/CustomerDashboard';

export default function CustomerAccountPage() {
  const { customer, login, register, refresh, logout } = useCustomer();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = React.useState<'login' | 'register'>(location.pathname.includes('inscription') ? 'register' : 'login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [verificationCode, setVerificationCode] = React.useState('');
  const [message, setMessage] = React.useState('');
  // Une erreur (compte existant, mot de passe faux…) s'affiche en rouge ; une information, en neutre.
  const [messageTone, setMessageTone] = React.useState<'error' | 'info'>('info');
  const fail = (err: unknown, fallback: string) => { setMessageTone('error'); setMessage(err instanceof Error ? err.message : fallback); };
  const tell = (text: string) => { setMessageTone('info'); setMessage(text); setExistingAccount(false); };
  // Inscription sur une adresse déjà connue : l'encadré propose d'envoyer le lien d'accès.
  const [existingAccount, setExistingAccount] = React.useState(false);
  const [sendingLink, setSendingLink] = React.useState(false);

  React.useEffect(() => {
    setMode(location.pathname.includes('inscription') ? 'register' : 'login');
  }, [location.pathname]);

  /*
    RETOUR À LA FICHE — venue de « Connectez-vous pour réserver », la cliente
    retrouve la page qu'elle regardait dès que son compte peut acheter
    (connecté ET e-mail vérifié). Seuls les chemins internes sont suivis.
  */
  const navigate = useNavigate();
  const retour = params.get('retour') || '';
  const safeRetour = /^\/(?!\/)[^\s]*$/.test(retour) ? retour : '';
  const retourQuery = safeRetour ? `?retour=${encodeURIComponent(safeRetour)}` : '';
  React.useEffect(() => {
    if (customer?.emailVerified && safeRetour) navigate(safeRetour, { replace: true });
  }, [customer?.emailVerified, safeRetour, navigate]);


  React.useEffect(() => {
    const legacyToken = params.get('verification');
    if (!legacyToken) return;
    setVerificationCode(legacyToken);
    tell('Ancien lien détecté. Entrez le code reçu par e-mail pour finaliser la vérification.');
    params.delete('verification');
    setParams(params, { replace: true });
  }, [params, setParams]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (mode === 'login') {
        await login(email, password);
        setMessage('');
      } else {
        await register({ email, password });
        // Compte créé : direction la vérification du code, et nulle part ailleurs.
        navigate(`/verification-email${retourQuery}`, { replace: true });
      }
    } catch (err) {
      fail(err, mode === 'login' ? 'Connexion impossible' : 'Création du compte impossible');
      setExistingAccount(mode === 'register' && (err as { code?: string })?.code === 'CUSTOMER_EXISTS');
    }
  }

  async function sendAccessLink() {
    setSendingLink(true);
    try {
      const result = await customerApi.requestPasswordReset(email);
      tell(result.resetUrl ? `Lien envoyé à ${email}. Lien TEST : ${result.resetUrl}` : `C’est envoyé : ouvrez l’e-mail reçu à ${email} et choisissez votre mot de passe.`);
    } catch (err) {
      fail(err, 'Envoi impossible pour le moment');
    } finally {
      setSendingLink(false);
    }
  }

  async function forgottenPassword() {
    try {
      const result = await customerApi.requestPasswordReset(email);
      tell(result.resetUrl ? `${result.message} Lien TEST : ${result.resetUrl}` : result.message);
    } catch (err) {
      fail(err, 'Demande impossible');
    }
  }

  async function resendVerification() {
    try {
      const result = await customerApi.requestEmailVerification();
      tell(result.verificationCode ? `${result.message} Code TEST : ${result.verificationCode}` : result.message);
    } catch (err) {
      fail(err, 'Envoi impossible');
    }
  }

  async function confirmVerification(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await customerApi.verifyEmail(verificationCode.trim());
      customerTokenStore.set(result.token);
      tell(result.message);
      setVerificationCode('');
      await refresh();
    } catch (err) {
      fail(err, 'Vérification impossible');
    }
  }

  if (!customer) {
    return (
      <section className="flex min-h-screen items-center justify-center px-5 pb-20 pt-32">
        <div className="w-full max-w-md rounded-lg border p-6 shadow-2xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-primary) 14%, transparent)' }}>
            {mode === 'login' ? <LockKeyhole className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </div>
          <h1 className="mt-5 text-center text-3xl font-semibold">{mode === 'login' ? 'Connexion cliente' : 'Création du compte'}</h1>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
            Accédez à vos achats, factures, cartes cadeaux et formations BeautySavage.
          </p>
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              E-mail
              <input className="v-field rounded-md px-3 py-3" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setMessage(''); }} required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Mot de passe
              <input className="v-field rounded-md px-3 py-3" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setMessage(''); }} required />
            </label>
            <button className="rounded-md px-5 py-3 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
              {mode === 'login' ? 'Me connecter' : 'Créer mon compte'}
            </button>
          </form>
          <div className="mt-5 grid gap-2 text-center text-sm">
            {mode === 'login' ? (
              <>
                <button type="button" onClick={forgottenPassword} className="font-semibold" style={{ color: 'var(--v-muted-foreground)' }}>Mot de passe oublié</button>
                <Link to={`/inscription-client${retourQuery}`} className="font-semibold">Créer un compte client</Link>
              </>
            ) : (
              <Link to={`/connexion-client${retourQuery}`} className="font-semibold">J'ai déjà un compte</Link>
            )}
          </div>
          {message && (
            <p role={messageTone === 'error' ? 'alert' : undefined} data-testid="auth-message" data-tone={messageTone}
              className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
              style={messageTone === 'error' ? { borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' } : { borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>
              {messageTone === 'error' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="min-w-0">
                {message}
                {existingAccount && (
                  <span className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={sendAccessLink} disabled={sendingLink} data-testid="send-access-link"
                      className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: '#991b1b' }}>
                      {sendingLink ? 'Envoi…' : 'Recevoir mon lien d’accès'}
                    </button>
                    <Link to="/connexion-client" className="rounded-md border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: '#fecaca' }}>Me connecter</Link>
                  </span>
                )}
              </span>
            </p>
          )}
        </div>
      </section>
    );
  }

  const profile = (
    <section className="max-w-xl rounded-2xl border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="profile-tab">
      <h2 className="text-xl font-semibold">Profil</h2>
      <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{customer.email}</p>
      {customer.emailVerified ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--v-border)' }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
          <span>E-mail vérifié, achats autorisés.</span>
        </div>
      ) : (
        <form onSubmit={confirmVerification} className="mt-4 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 10%, transparent)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <MailCheck className="h-4 w-4" />
            <span>Vérification e-mail obligatoire</span>
          </div>
          <p className="mt-2" style={{ color: 'var(--v-muted-foreground)' }}>Entrez le code reçu par e-mail pour débloquer les achats.</p>
          <input className="v-field mt-3 w-full rounded-md px-3 py-3 text-center text-lg font-semibold tracking-[0.35em]" inputMode="numeric" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
          <button className="mt-3 w-full rounded-md px-4 py-2 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Vérifier mon e-mail</button>
          <button type="button" onClick={resendVerification} className="mt-3 w-full text-sm font-semibold">Renvoyer un code</button>
        </form>
      )}
      <button onClick={logout} className="mt-5 text-sm font-semibold">Se déconnecter</button>
      {message && <p className="mt-4 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
    </section>
  );

  const banner = !customer.emailVerified ? (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 8%, var(--v-surface))' }} data-testid="verify-banner">
      <span className="flex items-center gap-2"><MailCheck className="h-4 w-4" /> Confirmez votre e-mail pour pouvoir réserver et acheter.</span>
      <Link to="?onglet=profil" className="font-semibold underline">Saisir mon code</Link>
    </div>
  ) : null;

  return <CustomerDashboard firstName={customer.firstName} profile={profile} banner={banner} />;
}
