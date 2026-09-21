import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, MailCheck, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { messageUtilisateur } from '@/lib/erreurs';

/**
 * Parcours PUBLIC « Mot de passe oublié » — deux écrans, même langage visuel
 * que la page de connexion (carte centrée, carte formulaire).
 *
 *  - /mot-de-passe-oublie : saisie de l'adresse → confirmation GÉNÉRIQUE
 *    (le backend répond la même chose que le compte existe ou non).
 *  - /reinitialiser-mot-de-passe?token=… : nouveau mot de passe + confirmation.
 *    Le token est invalide/expiré/déjà utilisé ? Le backend répond 400 avec un
 *    message actionnable — on propose de redemander un lien.
 */

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[var(--m-viewport-h)] items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        {children}
      </motion.div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(messageUtilisateur(err, 'Demande impossible pour le moment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recevez un lien de réinitialisation par email.
        </p>
      </div>

      {sent ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <MailCheck className="mx-auto h-10 w-10 text-primary" />
          <p className="text-sm">
            Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.
            Pensez à vérifier vos courriers indésirables.
          </p>
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-primary underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <Field label="Adresse email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              autoFocus
              required
            />
          </Field>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={busy} disabled={!email.trim()}>
            Envoyer le lien
          </Button>
          <p className="text-center">
            <Link to="/login" className="text-xs text-muted-foreground underline">
              Retour à la connexion
            </Link>
          </p>
        </form>
      )}
    </PublicShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const localError =
    password && password.length < 6
      ? 'Au moins 6 caractères.'
      : confirm && password !== confirm
        ? 'Les mots de passe ne correspondent pas.'
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (localError) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password, confirm);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      // Token invalide / expiré / déjà utilisé : message actionnable du backend.
      setError(messageUtilisateur(err, 'Réinitialisation impossible.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choisissez un nouveau mot de passe.</p>
      </div>

      {!token ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm text-red-600">Lien incomplet : le jeton de réinitialisation est absent.</p>
          <Link to="/mot-de-passe-oublie" className="text-sm text-primary underline">
            Redemander un lien
          </Link>
        </div>
      ) : done ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="text-sm">Mot de passe mis à jour. Redirection vers la connexion…</p>
          <Link to="/login" className="text-sm text-primary underline">
            Se connecter maintenant
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <Field label="Nouveau mot de passe" hint="6 caractères minimum.">
            <Input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              required
            />
          </Field>
          <Field label="Confirmation du mot de passe">
            <Input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Afficher les mots de passe
          </label>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          {error && (
            <div className="space-y-2">
              <p className="text-xs text-red-600">{error}</p>
              <Link to="/mot-de-passe-oublie" className="text-xs text-primary underline">
                Redemander un lien de réinitialisation
              </Link>
            </div>
          )}
          <Button type="submit" className="w-full" loading={busy} disabled={!password || !confirm || Boolean(localError)}>
            Réinitialiser le mot de passe
          </Button>
          <p className="text-center">
            <Link to="/login" className="text-xs text-muted-foreground underline">
              Retour à la connexion
            </Link>
          </p>
        </form>
      )}
    </PublicShell>
  );
}

export default ForgotPasswordPage;
