import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { customerApi } from '@/lib/api';

export default function CustomerPasswordResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = React.useState('');
  const [message, setMessage] = React.useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await customerApi.resetPassword({ token, password });
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Reinitialisation impossible');
    }
  }

  return (
    <section className="mx-auto min-h-screen max-w-md px-5 pb-24 pt-32 md:px-8">
      <h1 className="text-4xl font-semibold">Nouveau mot de passe</h1>
      <form onSubmit={submit} className="mt-8 rounded-lg border p-5 shadow-xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        {!token && <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Lien de reinitialisation manquant.</p>}
        <label className="block text-sm font-medium">
          Mot de passe
          <input className="v-field mt-2 w-full rounded-md px-3 py-3" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button disabled={!token} className="mt-6 w-full rounded-md px-5 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
          Mettre a jour
        </button>
        {message && <p className="mt-4 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
        <Link to="/espace-client" className="mt-4 inline-flex text-sm font-semibold">Retour connexion</Link>
      </form>
    </section>
  );
}
