import * as React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LockKeyhole, MailCheck, UserPlus } from 'lucide-react';
import { useCustomer } from '@/context/CustomerContext';
import { customerApi, customerTokenStore } from '@/lib/api';

export default function CustomerAccountPage() {
  const { customer, login, register, refresh, logout } = useCustomer();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = React.useState<'login' | 'register'>(location.pathname.includes('inscription') ? 'register' : 'login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [verificationCode, setVerificationCode] = React.useState('');
  const [orders, setOrders] = React.useState<unknown[]>([]);
  const [formations, setFormations] = React.useState<unknown[]>([]);
  const [giftCards, setGiftCards] = React.useState<unknown[]>([]);
  const [refunds, setRefunds] = React.useState<unknown[]>([]);
  const [submissions, setSubmissions] = React.useState<unknown[]>([]);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    setMode(location.pathname.includes('inscription') ? 'register' : 'login');
  }, [location.pathname]);

  React.useEffect(() => {
    if (!customer) return;
    customerApi.orders().then(setOrders).catch(() => null);
    customerApi.formations().then(setFormations).catch(() => null);
    customerApi.giftCards().then(setGiftCards).catch(() => null);
    customerApi.refundRequests().then(setRefunds).catch(() => null);
    customerApi.trainingSubmissions().then(setSubmissions).catch(() => null);
  }, [customer]);

  React.useEffect(() => {
    const legacyToken = params.get('verification');
    if (!legacyToken) return;
    setVerificationCode(legacyToken);
    setMessage('Ancien lien detecte. Entrez le code recu par e-mail pour finaliser la verification.');
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
        const result = await register({ email, password });
        setMessage(result.verificationCode
          ? `Compte cree. Code TEST de verification : ${result.verificationCode}`
          : 'Compte cree. Un code de verification vient de vous etre envoye.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Connexion impossible');
    }
  }

  async function forgottenPassword() {
    try {
      const result = await customerApi.requestPasswordReset(email);
      setMessage(result.resetUrl ? `${result.message} Lien TEST : ${result.resetUrl}` : result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Demande impossible');
    }
  }

  async function resendVerification() {
    try {
      const result = await customerApi.requestEmailVerification();
      setMessage(result.verificationCode ? `${result.message} Code TEST : ${result.verificationCode}` : result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Envoi impossible');
    }
  }

  async function confirmVerification(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await customerApi.verifyEmail(verificationCode.trim());
      customerTokenStore.set(result.token);
      setMessage(result.message);
      setVerificationCode('');
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Verification impossible');
    }
  }

  if (!customer) {
    return (
      <section className="flex min-h-screen items-center justify-center px-5 pb-20 pt-32">
        <div className="w-full max-w-md rounded-lg border p-6 shadow-2xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-primary) 14%, transparent)' }}>
            {mode === 'login' ? <LockKeyhole className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </div>
          <h1 className="mt-5 text-center text-3xl font-semibold">{mode === 'login' ? 'Connexion cliente' : 'Creation du compte'}</h1>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
            Accedez a vos achats, factures, cartes cadeaux et formations BeautySavage.
          </p>
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              E-mail
              <input className="v-field rounded-md px-3 py-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Mot de passe
              <input className="v-field rounded-md px-3 py-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="rounded-md px-5 py-3 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
              {mode === 'login' ? 'Me connecter' : 'Creer mon compte'}
            </button>
          </form>
          <div className="mt-5 grid gap-2 text-center text-sm">
            {mode === 'login' ? (
              <>
                <button type="button" onClick={forgottenPassword} className="font-semibold" style={{ color: 'var(--v-muted-foreground)' }}>Mot de passe oublie</button>
                <Link to="/inscription-client" className="font-semibold">Creer un compte client</Link>
              </>
            ) : (
              <Link to="/connexion-client" className="font-semibold">J'ai deja un compte</Link>
            )}
          </div>
          {message && <p className="mt-4 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>{message}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto min-h-screen max-w-5xl px-5 pb-24 pt-32 md:px-8">
      <h1 className="text-4xl font-semibold">Espace client</h1>
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <section className="rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <h2 className="text-xl font-semibold">Profil</h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{customer.email}</p>
          {customer.emailVerified ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--v-border)' }}>
              <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
              <span>E-mail verifie, achats autorises.</span>
            </div>
          ) : (
            <form onSubmit={confirmVerification} className="mt-4 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 10%, transparent)' }}>
              <div className="flex items-center gap-2 font-semibold">
                <MailCheck className="h-4 w-4" />
                <span>Verification e-mail obligatoire</span>
              </div>
              <p className="mt-2" style={{ color: 'var(--v-muted-foreground)' }}>Entrez le code recu par e-mail pour debloquer les achats.</p>
              <input className="v-field mt-3 w-full rounded-md px-3 py-3 text-center text-lg font-semibold tracking-[0.35em]" inputMode="numeric" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              <button className="mt-3 w-full rounded-md px-4 py-2 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Verifier mon e-mail</button>
              <button type="button" onClick={resendVerification} className="mt-3 w-full text-sm font-semibold">Renvoyer un code</button>
            </form>
          )}
          <button onClick={logout} className="mt-5 text-sm font-semibold">Se deconnecter</button>
          {message && <p className="mt-4 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
        </section>
        <Panel title="Achats" count={orders.length} items={orders} />
        <FormationsPanel items={formations} />
        <Panel title="Factures" count={orders.length} items={orders} />
        <Panel title="Cartes cadeaux" count={giftCards.length} items={giftCards} />
        <Panel title="Remboursements" count={refunds.length} items={refunds} />
        <Panel title="Evaluations" count={submissions.length} items={submissions} />
      </div>
    </section>
  );
}

function Panel({ id, title, count, items }: { id?: string; title: string; count: number; items: unknown[] }) {
  return (
    <section id={id} className="rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-6 text-3xl font-semibold">{count}</p>
      <div className="mt-4 grid gap-2">
        {items.slice(0, 3).map((item, index) => (
          <p key={index} className="truncate text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{labelFor(item)}</p>
        ))}
        {count === 0 && <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Rien pour le moment.</p>}
      </div>
    </section>
  );
}

function FormationsPanel({ items }: { items: unknown[] }) {
  return (
    <section id="formations" className="rounded-lg border p-5 lg:col-span-3" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Mes formations</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Apercu des formations en cours.</p>
        </div>
        <p className="text-3xl font-semibold">{items.length}</p>
      </div>
      {items.length === 0 && <p className="mt-4 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Aucune formation achetee pour le moment.</p>}
      {items.length > 0 && (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {items.slice(0, 3).map((item, index) => {
              const progress = trainingProgress(item as Record<string, any>);
              return (
                <div key={index} className="rounded-md border p-3" style={{ borderColor: 'var(--v-border)' }}>
                  <p className="truncate text-sm font-semibold">{labelFor(item)}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 16%, transparent)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--v-primary)' }} />
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{progress}% complete</p>
                </div>
              );
            })}
          </div>
          <Link
            to="/espace-client/formations"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
          >
            Acceder a mes formations <ArrowRight className="h-4 w-4" />
          </Link>
        </>
      )}
    </section>
  );
}

function trainingProgress(item: Record<string, any>) {
  const direct = Number(item.progressPercent ?? item.progress?.percent ?? item.progression?.percent);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(100, Math.round(direct));
  const completed = Number(item.completedModules ?? item.progress?.completedModules ?? 0);
  const total = Number(item.totalModules ?? item.progress?.totalModules ?? item.productSnapshot?.modulesCount ?? 0);
  if (total > 0) return Math.min(100, Math.round((completed / total) * 100));
  return item.status === 'VALIDATED' || item.completedAt ? 100 : 0;
}

function labelFor(item: unknown) {
  const value = item as Record<string, any>;
  return value.saleNumber || value.codeMasked || value.status || value.productSnapshot?.title || value.productId?.title || 'Element client';
}
