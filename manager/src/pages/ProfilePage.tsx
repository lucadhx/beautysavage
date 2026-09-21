import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check, KeyRound, Mail, Save, ShieldCheck, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { isPanelPrincipal } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { RoleBadge } from '@/components/RoleBadge';
import { Card, CardContent, CardHeader, CardTitle, Input, Field, Button } from '@/components/ui/primitives';
import { messageUtilisateur } from '@/lib/erreurs';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: z.string().min(6, 'Au moins 6 caractères'),
    confirmPassword: z.string().min(1, 'Confirmation requise'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

type PasswordValues = z.infer<typeof passwordSchema>;

const nameSchema = z.object({ name: z.string().trim().min(1, 'Le nom est requis').max(80, 'Nom trop long') });
type NameValues = z.infer<typeof nameSchema>;

export default function ProfilePage() {
  const { user, updateUser } = useAuth();

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  const nameForm = useForm<NameValues>({
    resolver: zodResolver(nameSchema),
    values: { name: user?.name || '' },
  });

  const passwordForm = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const saveName = async ({ name }: NameValues) => {
    try {
      const updated = await api.updateProfile({ name });
      updateUser(updated);
      toast.success('Profil mis à jour');
      nameForm.reset({ name: updated.name });
    } catch (err) {
      toast.error(messageUtilisateur(err, 'Échec de la mise à jour'));
    }
  };

  const savePassword = async (values: PasswordValues) => {
    try {
      await api.changePassword(values.currentPassword, values.newPassword, values.confirmPassword);
      toast.success('Mot de passe modifié');
      passwordForm.reset();
    } catch (err) {
      toast.error(messageUtilisateur(err, 'Échec de la modification'));
    }
  };

  return (
    <div>
      <PageHeader title="Mon profil" description="Vos informations personnelles et votre sécurité." />

      {/* Carte d'identité */}
      <Card className="mb-6 overflow-hidden">
        <div className="h-20 w-full bg-primary/10" />
        <CardContent className="pt-0">
          <div className="-mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-end">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-card bg-primary text-3xl font-bold text-primary-foreground shadow-sm"
              aria-hidden
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="truncate text-xl font-bold">{user?.name || 'Sans nom'}</h2>
                {user?.role && <RoleBadge role={user.role} />}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{user?.email}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
        UNE IDENTITÉ L.Y SOLUTION N'A NI PROFIL NI MOT DE PASSE ICI (L12.B-UI).

        Les deux cartes qui suivent écrivent dans la base de CE projet. Une
        identité fédérée n'y a aucun document : les lui présenter produirait
        deux boutons qui échouent — le serveur les refuse déjà
        (`requireLocalPrincipal`) — et laisserait croire que ce projet peut
        changer un mot de passe dont il n'est pas propriétaire.

        On explique où le geste se fait, plutôt que d'afficher un formulaire
        mort.
      */}
      {isPanelPrincipal(user) ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Compte L.Y Solution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Votre identité est administrée depuis le Panel L.Y Solution. Votre nom, votre
              adresse et votre mot de passe s’y modifient — ce projet n’en détient aucune copie.
            </p>
          </CardContent>
        </Card>
      ) : (
      <div className="grid gap-6 md:grid-cols-2">
        {/* Informations éditables */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-4 w-4" /> Informations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={nameForm.handleSubmit(saveName)} className="space-y-4">
              <Field label="Nom affiché" error={nameForm.formState.errors.name?.message}>
                <Input placeholder="Votre nom" {...nameForm.register('name')} />
              </Field>
              {/*
                LE CHAMP EST ENVELOPPÉ : LE LIEN AU LIBELLÉ DOIT ÊTRE EXPLICITE.

                Le `<div class="relative">` sert à poser l'icône en absolu. Il
                recevait l'identifiant que `Field` destinait au champ : le
                libellé désignait donc un conteneur, et un lecteur d'écran
                annonçait « zone d'édition » sans dire laquelle. Le second
                enfant (`<p>`) aggravait le cas — deux enfants, et le clonage
                ne s'appliquait plus du tout. L'aide passe en `hint`, où elle
                est reliée par `aria-describedby`.
              */}
              <Field
                label="Adresse email"
                htmlFor="profil-email"
                hint="L'email ne peut être modifié que par un administrateur."
              >
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="profil-email" value={user?.email || ''} disabled readOnly className="pl-9" />
                </div>
              </Field>
              <Button
                type="submit"
                loading={nameForm.formState.isSubmitting}
                disabled={!nameForm.formState.isDirty}
              >
                {nameForm.formState.isDirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Mot de passe */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Changer le mot de passe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit(savePassword)} className="space-y-4">
              <Field label="Mot de passe actuel" error={passwordForm.formState.errors.currentPassword?.message}>
                <Input type="password" {...passwordForm.register('currentPassword')} />
              </Field>
              <Field label="Nouveau mot de passe" error={passwordForm.formState.errors.newPassword?.message}>
                <Input type="password" {...passwordForm.register('newPassword')} />
              </Field>
              <Field
                label="Confirmer le nouveau mot de passe"
                error={passwordForm.formState.errors.confirmPassword?.message}
              >
                <Input type="password" {...passwordForm.register('confirmPassword')} />
              </Field>
              <Button type="submit" loading={passwordForm.formState.isSubmitting}>
                Mettre à jour
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}
