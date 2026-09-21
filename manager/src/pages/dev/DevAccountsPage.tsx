import * as React from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Plus, KeyRound, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { ProjectAccountView, Role } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { useResource, useAction } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card,
  CardContent,
  Input,
  Field,
  Button,
  Badge,
} from '@/components/ui/primitives';
import { Modal, ConfirmDialog } from '@/components/ui/dialog';

/**
 * LE FORMULAIRE, ET CE QUE `id` Y DÉCIDE.
 *
 * Sa présence distingue une MODIFICATION d'une CRÉATION, et c'est elle seule
 * qui décide du titre du modal, de la route appelée, et de l'obligation d'un
 * mot de passe. Le champ s'appelait `_id` et était rempli depuis `u._id` — une
 * clé que la liste ne rend plus depuis qu'elle sert la vue canonique du
 * backend (`id`). Toujours vide, il faisait donc lire CHAQUE modification
 * comme une création :
 *
 *   · le modal s'ouvrait sur « Nouveau compte » ;
 *   · « Enregistrer » restait grisé tant qu'aucun mot de passe n'était saisi,
 *     donc changer ADMIN ↔ DEV ne débloquait rien ;
 *   · et l'enregistrement partait créer un compte déjà existant, d'où
 *     « Un compte avec cet email existe déjà ».
 *
 * Un seul champ manquant, trois symptômes sans rapport apparent.
 */
interface EditingAccount {
  id?: string;
  email: string;
  name: string;
  role: Role;
  password: string;
}

const empty: EditingAccount = { email: '', name: '', role: 'ADMIN', password: '' };

export default function DevAccountsPage() {
  const { user } = useAuth();
  const { data, loading, reload } = useResource(() => api.listAccounts());
  /**
   * LES ACCÈS L.Y SOLUTION — chargés à part, et affichés à part.
   *
   * Les fondre dans la même liste que les comptes du projet obligerait chaque
   * ligne à se demander ce qu'elle est avant de savoir quels boutons montrer.
   * Deux sources, deux sections : la distinction est portée par la mise en
   * page, pas par une condition répétée.
   */
  const { data: externals } = useResource(() => api.listExternalPrincipals());
  const [editing, setEditing] = React.useState<EditingAccount | null>(null);
  const [toDelete, setToDelete] = React.useState<ProjectAccountView | null>(null);
  const { pending, run } = useAction();

  const save = async () => {
    if (!editing) return;
    /* Repris dans une constante : à l'intérieur du rappel, TypeScript ne peut
       plus garantir qu'une propriété facultative n'a pas changé entre-temps. */
    const id = editing.id;
    if (id) {
      await run(
        () =>
          api.updateAccount(id, {
            email: editing.email,
            name: editing.name,
            role: editing.role,
            ...(editing.password ? { password: editing.password } : {}),
          }),
        { success: 'Compte mis à jour' }
      );
    } else {
      await run(
        () =>
          api.createAccount({
            email: editing.email,
            name: editing.name,
            role: editing.role,
            password: editing.password,
          }),
        { success: 'Compte créé' }
      );
    }
    setEditing(null);
    reload();
  };

  const doDelete = async () => {
    /**
     * Cette garde lisait `toDelete._id`, absent de la vue canonique : elle
     * sortait donc TOUJOURS, et le bouton « Supprimer » du modal de
     * confirmation ne faisait rien — sans erreur, sans trace, sans rien.
     *
     * Elle reste, sous le bon nom : la liste ne contient que des comptes
     * locaux, mais une vue canonique peut décrire une identité fédérée, dont
     * l'identifiant est préfixé `panel:` et ne désigne aucun document ici.
     */
    if (!toDelete?.id || toDelete.principalType !== 'LOCAL_USER') return;
    await run(() => api.deleteAccount(toDelete.id), { success: 'Compte supprimé' });
    setToDelete(null);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Gestion des comptes"
        description="Créez et gérez les comptes administrateurs et développeurs."
        action={
          <Button onClick={() => setEditing({ ...empty })}>
            <Plus className="h-4 w-4" /> Nouveau compte
          </Button>
        }
      />

      {loading ? (
        <BrandLoader />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {data?.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-semibold">
                  {u.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  {/* `displayName` est déjà le repli du backend : nom, à défaut
                      l'email, à défaut « Compte sans nom ». Le refaire ici ferait
                      deux règles pour une seule question. */}
                  <p className="truncate font-medium">{u.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                </div>
                <Badge
                  className={
                    u.role === 'DEV'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-slate-100 text-slate-700'
                  }
                >
                  {u.role === 'DEV' && <ShieldCheck className="mr-1 h-3 w-3" />}
                  {u.role}
                </Badge>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setEditing({
                        id: u.id,
                        email: u.email,
                        /* Le formulaire édite le NOM. `displayName` peut être
                           l'email quand le nom est vide : le recopier tel quel
                           enregistrerait l'email en guise de nom. */
                        name: u.displayName === u.email ? '' : u.displayName,
                        role: u.role,
                        password: '',
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={u.id === String(user?._id ?? '')}
                    onClick={() => setToDelete(u)}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/*
        ══ ACCÈS L.Y SOLUTION ════════════════════════════════════════════════
        Une section SÉPARÉE, et volontairement dépourvue d'actions.

        Ce projet n'est pas propriétaire de ces identités : ni mot de passe, ni
        suppression, ni changement de rôle. Afficher ces boutons — même
        désactivés — laisserait croire que le geste existe quelque part ici.
        Il n'existe pas : il se fait au Panel.
      */}
      {externals && externals.length > 0 && (
        <div className="mt-8">
          <PageHeader
            title="Accès L.Y Solution"
            description="Identités administrées par le Panel. Ce projet ne détient ni leur mot de passe ni leurs droits."
          />
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {externals.map((p) => (
                <div key={p.panelUserId} className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                    {(p.displayName || p.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.displayName}</p>
                    <p className="truncate text-sm text-muted-foreground">{p.email}</p>
                  </div>
                  <Badge className="bg-purple-100 text-purple-700">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    {p.role}
                  </Badge>
                  <Badge className="bg-sky-100 text-sky-700">L.Y Solution</Badge>
                  {/*
                    L'ÉTAT MONTRÉ EST UN REFLET, DATÉ. Il n'autorise rien : un
                    accès est refusé parce que le Panel l'a dit à l'instant.
                    Afficher « actif » sans sa date le ferait lire comme une
                    garantie présente.
                  */}
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {p.enabled ? 'Synchronisé' : 'Accès révoqué'}
                    {p.lastSyncedAt
                      ? ` · ${new Date(p.lastSyncedAt).toLocaleDateString('fr-FR')}`
                      : ''}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Modifier le compte' : 'Nouveau compte'}
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Nom">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              />
            </Field>
            <Field label="Rôle">
              <div className="flex gap-2">
                {(['ADMIN', 'DEV'] as Role[]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setEditing({ ...editing, role })}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                      editing.role === role
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={editing.id ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}
            >
              <Input
                type="password"
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              <Button
                onClick={save}
                loading={pending}
                disabled={!editing.email || (!editing.id && !editing.password)}
              >
                <KeyRound className="h-4 w-4" /> Enregistrer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={doDelete}
        title="Supprimer ce compte ?"
        description={`Le compte ${toDelete?.email} sera définitivement supprimé.`}
        destructive
        confirmLabel="Supprimer"
        loading={pending}
      />
    </div>
  );
}
