import * as React from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useManagerTheme } from '@/context/ManagerThemeContext';
import { useSiteStatus } from '@/context/SiteStatusContext';
import { useCompany } from '@/context/CompanyContext';
import { useRoleAppearance } from '@/context/RoleAppearanceContext';
import { Button, Input, Field } from '@/components/ui/primitives';
import { FederatedLoginBlock } from '@/components/FederatedLoginBlock';
import { TestAccountSwitcher } from '@/components/TestAccountSwitcher';
import { api, isRateLimited, messageTropDeTentatives } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import type { PublicBootstrap, User } from '@/types';
import { messageUtilisateur } from '@/lib/erreurs';

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { user, login, setSession } = useAuth();
  const { reload: reloadTheme } = useManagerTheme();
  const { reload: reloadStatus } = useSiteStatus();
  const { reload: reloadCompany } = useCompany();
  const { reload: reloadRoles } = useRoleAppearance();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const [identity, setIdentity] = React.useState<PublicBootstrap | null>(null);

  React.useEffect(() => {
    api
      .getPublicBootstrap()
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, []);

  const companyName = identity?.company?.name?.trim();
  // Résolution canonique même-origine — JAMAIS la backendUrl publique (réseau) :
  // un tunnel ngrok périmé ou un domaine pas encore déployé cassait le logo.
  const companyLogo = resolvePreviewMediaUrl(identity?.company?.logos?.header);
  const devCompany = identity?.devCompany;
  const devLogo = resolvePreviewMediaUrl(devCompany?.logo);

  if (user) return <Navigate to="/" replace />;

  const finishLogin = async (u: User) => {
    await Promise.all([reloadTheme(), reloadStatus(), reloadCompany(), reloadRoles()]);
    toast.success(`Connecté en tant que ${u.name || u.email}`);
    navigate('/');
  };

  const onSubmit = async (values: FormValues) => {
    try {
      await login(values.email, values.password);
      await Promise.all([reloadTheme(), reloadStatus(), reloadCompany(), reloadRoles()]);
      toast.success('Connexion réussie');
      navigate('/');
    } catch (err) {
      /**
       * LE 429 A SA PROPRE PHRASE : « échec de la connexion » accuserait des
       * identifiants que le serveur n'a même pas regardés.
       */
      if (isRateLimited(err)) {
        toast.error(messageTropDeTentatives(err));
      } else {
        toast.error(messageUtilisateur(err, 'Échec de la connexion'));
      }
    }
  };

  /**
   * LA SESSION LOCALE OUVERTE PAR LE WIDGET DE RECETTE.
   *
   * L'écran ne connaît pas le mécanisme — il ne sait que ce qu'il faut faire
   * d'une session : la poser, recharger ce qui en dépend, et naviguer. Le
   * chemin fédéré, lui, ne repasse jamais par ici : il quitte la page et revient
   * par `/connexion/ly-solution/retour`.
   */
  const openLocalSession = async (token: string, u: User) => {
    setSession(token, u);
    await finishLogin(u);
  };

  return (
    <div className="flex min-h-[var(--m-viewport-h)] items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-4xl flex-col items-center justify-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        {/* Login form */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex flex-col items-center text-center">
            {companyLogo ? (
              <img
                src={companyLogo}
                alt={companyName || 'Logo'}
                className="mb-4 h-14 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Car className="h-7 w-7" />
              </div>
            )}
            <h1 className="text-2xl font-bold">{companyName || 'Manager'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Accéder à l'interface de gestion</p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" placeholder="admin@mail.com" autoFocus {...register('email')} />
            </Field>
            <Field label="Mot de passe" error={errors.password?.message}>
              <Input type="password" placeholder="••••••••" {...register('password')} />
            </Field>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Se connecter
            </Button>
            <p className="text-center">
              {/*
                « Mot de passe oublié » concerne UNIQUEMENT les comptes de ce
                projet. Il est donc à l'intérieur du formulaire local, sous le
                bouton local — et jamais dans le bloc L.Y Solution, dont les
                mots de passe se réinitialisent sur le Panel.
              */}
              <Link to="/mot-de-passe-oublie" className="text-xs text-muted-foreground underline hover:text-foreground">
                Mot de passe oublié ?
              </Link>
            </p>
          </form>

          {/*
            L'ACCÈS DE L'ÉQUIPE TECHNIQUE — hors du formulaire, et c'est le
            point. Le composant s'efface de lui-même si le projet n'est pas
            appairé : un projet autonome garde un écran de connexion inchangé.
          */}
          <FederatedLoginBlock redirectPath="/" />

          {devCompany?.name && (
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>Solution développée par {devCompany.name}</span>
              {devLogo && (
                <img
                  src={devLogo}
                  alt={devCompany.name}
                  className="h-5 w-auto max-w-[80px] object-contain"
                />
              )}
            </div>
          )}
        </motion.div>

        {/*
          LA CONNEXION RAPIDE — ENVIRONNEMENT TEST, et rien d'autre.

          Elle vit dans son propre composant, à CÔTÉ du formulaire et jamais
          dedans : le vrai login ne dépend d'elle en rien, et elle disparaît
          entièrement quand le serveur ne répond pas « TEST ». Le composant rend
          `null` — il n'y a donc aucune adresse de compte dans le DOM à masquer.
        */}
        <TestAccountSwitcher onLocalSession={openLocalSession} redirectPath="/" />
      </div>
    </div>
  );
}
