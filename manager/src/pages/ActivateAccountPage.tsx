import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, CheckCircle2, MailCheck } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { messageUtilisateur } from '@/lib/erreurs';

/**
 * ACTIVATION DU PREMIER ACCÈS — page PUBLIQUE (LOT 2C).
 *
 * ══ POURQUOI ELLE NE RESSEMBLE PAS TOUT À FAIT À UNE RÉINITIALISATION ═══════
 *
 * Elle en partage la mécanique : un lien tokenisé, deux champs, un envoi. Elle
 * en diffère sur un point que l'utilisateur ressent immédiatement — la personne
 * devant cet écran n'a JAMAIS eu de mot de passe ici. Lui dire « nouveau mot de
 * passe » l'inviterait à chercher l'ancien.
 *
 * Elle VALIDE donc le lien AVANT d'afficher le formulaire, et affiche le nom du
 * projet auquel l'accès est ouvert. Un lien mort se dit tout de suite, pas
 * après la saisie : découvrir qu'un lien a expiré au moment où l'on valide un
 * mot de passe qu'on vient de choisir est la façon la plus sûre de faire
 * abandonner quelqu'un.
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

export function ActivateAccountPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [état, setÉtat] = React.useState<'verification' | 'pret' | 'invalide' | 'fait'>('verification');
  const [profil, setProfil] = React.useState<{ name: string; projectName: string } | null>(null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Renvoi d'un lien — même surface, pour ne pas égarer qui arrive avec un lien mort.
  const [renvoiEmail, setRenvoiEmail] = React.useState('');
  const [renvoyé, setRenvoyé] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    if (!token) {
      setÉtat('invalide');
      return () => { vivant = false; };
    }
    void (async () => {
      try {
        const info = await api.describeActivation(token);
        if (!vivant) return;
        if (info.valid) {
          setProfil({ name: info.name ?? '', projectName: info.projectName ?? '' });
          setÉtat('pret');
        } else {
          setÉtat('invalide');
        }
      } catch {
        if (vivant) setÉtat('invalide');
      }
    })();
    return () => { vivant = false; };
  }, [token]);

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
      await api.activateAccount(token, password, confirm);
      setÉtat('fait');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(messageUtilisateur(err, 'Activation impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const demanderRenvoi = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.resendActivation(renvoiEmail.trim());
    } catch {
      /* la réponse est générique par construction : rien à distinguer ici */
    } finally {
      setRenvoyé(true);
      setBusy(false);
    }
  };

  return (
    <PublicShell>
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Activez votre accès</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profil?.projectName
            ? `Choisissez votre mot de passe pour ${profil.projectName}.`
            : 'Choisissez votre mot de passe pour administrer ce projet.'}
        </p>
      </div>

      {état === 'verification' && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
          Vérification du lien…
        </div>
      )}

      {état === 'invalide' && (
        renvoyé ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <MailCheck className="mx-auto h-10 w-10 text-primary" />
            <p className="text-sm">
              Si un compte en attente d’activation correspond à cette adresse, un nouveau lien
              vient d’être envoyé.
            </p>
            <Link to="/login" className="text-sm text-primary underline">Retour à la connexion</Link>
          </div>
        ) : (
          <form onSubmit={demanderRenvoi} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className="text-sm text-red-600">
              Ce lien d’activation est invalide, expiré ou déjà utilisé.
            </p>
            <Field label="Votre adresse email" hint="Nous vous renverrons un lien valable.">
              <Input
                type="email"
                value={renvoiEmail}
                onChange={(e) => setRenvoiEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                required
              />
            </Field>
            <Button type="submit" className="w-full" loading={busy} disabled={!renvoiEmail.trim()}>
              Recevoir un nouveau lien
            </Button>
            <p className="text-center">
              <Link to="/login" className="text-xs text-muted-foreground underline">
                Retour à la connexion
              </Link>
            </p>
          </form>
        )
      )}

      {état === 'fait' && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="text-sm">Compte activé. Redirection vers la connexion…</p>
          <Link to="/login" className="text-sm text-primary underline">Se connecter maintenant</Link>
        </div>
      )}

      {état === 'pret' && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          {profil?.name && (
            <p className="text-xs text-muted-foreground">
              Accès ouvert au nom de <span className="font-medium text-foreground">{profil.name}</span>.
            </p>
          )}
          <Field label="Mot de passe" hint="6 caractères minimum.">
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
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            loading={busy}
            disabled={!password || !confirm || Boolean(localError)}
          >
            Activer mon compte
          </Button>
        </form>
      )}
    </PublicShell>
  );
}

export default ActivateAccountPage;
