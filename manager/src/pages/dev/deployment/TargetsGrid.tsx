/**
 * « Mes sites » : grandes cartes de destinations (DEMO, PRODUCTION…) avec état,
 * version, dernier déploiement et action « Déployer ici ». Création guidée d'une
 * nouvelle destination à partir de son URL complète.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Plus, ArrowLeft, Globe, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { DeploymentTarget } from '@/types';
import { Button, Input, Label } from '@/components/ui/primitives';
import { useAction } from '@/hooks/useResource';
import { Reveal, Panel, AdvancedDisclosure } from './ui';
import { TargetCard } from './TargetCard';
import { RemovalDialog } from './RemovalDialog';

export function TargetsGrid({
  targets,
  reload,
  onDeploy,
  onBack,
  sessionId,
  onConnect,
  connecting,
}: {
  targets: DeploymentTarget[];
  reload: () => Promise<void>;
  onDeploy: (targetId: string) => void;
  onBack: () => void;
  /** Session serveur ouverte, s'il y en a une : le retrait l'exige. */
  sessionId?: string | null;
  /** Ouvrir une session serveur — la fenêtre de retrait en a besoin. */
  onConnect?: (creds: {
    host: string; username: string; password: string;
  }) => Promise<boolean>;
  connecting?: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  /** La destination visee par une modale de retrait ou de suppression. */
  const [removing, setRemoving] = React.useState<{ mode: 'deprovision' | 'delete'; target: DeploymentTarget } | null>(null);

  /*
    ── `confirm()` A DISPARU, ET LA SUPPRESSION DIRECTE AVEC LUI ──────────────

    Un `confirm()` du navigateur pose une question sans montrer de reponse : ni
    le port, ni le service, ni la taille, ni le nombre de medias qui vont
    disparaitre. Une fiche etait donc supprimee d'un clic alors que le serveur
    portait encore un service PM2 detenant son port, une configuration Nginx et
    des fichiers - sans plus rien pour dire qu'il restait a nettoyer.

    Les deux gestes passent desormais par une fenetre dediee qui montre
    l'inventaire REEL et exige la saisie exacte du nom d'hote.
  */

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Accueil
        </button>
        <Button onClick={() => setAdding((a) => !a)} variant={adding ? 'outline' : 'default'}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {adding ? 'Annuler' : 'Nouvelle destination'}
        </Button>
      </div>

      {adding && (
        <Reveal>
          <NewTargetForm
            onCreated={async () => {
              setAdding(false);
              await reload();
            }}
          />
        </Reveal>
      )}

      {targets.length === 0 && !adding ? (
        <Reveal>
          <Panel className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground/60">
              <Globe className="h-6 w-6" />
            </div>
            <h3 className="mt-3 font-semibold">Aucune destination</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ajoutez une destination pour publier votre site.</p>
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Nouvelle destination
            </Button>
          </Panel>
        </Reveal>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {targets.map((t, i) => (
            <Reveal key={t.id} delay={i * 0.04}>
              <TargetCard
                target={t}
                mode="manage"
                onDeploy={() => onDeploy(t.id)}
                onDeprovision={() => setRemoving({ mode: 'deprovision', target: t })}
                onDelete={() => setRemoving({ mode: 'delete', target: t })}
              />
            </Reveal>
          ))}
        </div>
      )}

      {removing && (
        <RemovalDialog
          mode={removing.mode}
          target={removing.target}
          sessionId={sessionId ?? null}
          onConnect={onConnect}
          connecting={connecting}
          onCancel={() => setRemoving(null)}
          /**
           * ── LE SUCCÈS NE DÉPEND PLUS D'UN RAFRAÎCHISSEMENT ────────────────
           *
           * La fenêtre se fermait au succès, et le parent enchaînait sur un
           * `reload()`. Deux conséquences : l'opérateur ne voyait jamais le
           * rapport de ce qu'il venait de faire, et une liste qui ne se
           * rechargeait pas transformait une suppression RÉUSSIE en incident.
           *
           * La fenêtre reste donc ouverte sur son verdict. La liste se
           * rafraîchit en arrière-plan ; si elle échoue, on le dit sans
           * toucher au verdict — le serveur, lui, a bien supprimé.
           */
          onDone={async (message) => {
            toast.success(message);
            try {
              await reload();
            } catch {
              toast.message('Destination supprimée. La liste n’a pas pu être actualisée — '
                + 'elle le sera au prochain chargement.');
            }
          }}
          onClosed={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

export function NewTargetForm({ onCreated }: { onCreated: (t: DeploymentTarget) => void }) {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  /**
   * AUCUNE VALEUR PAR DEFAUT.
   *
   * L'environnement etait un selecteur de l'assistant de deploiement, avec
   * PROD preselectionne : un clic de trop publiait en production. Il appartient
   * a la DESTINATION, il est choisi ici, et il devient immuable. Le laisser
   * vide oblige a le choisir - c'est le but.
   */
  const [environment, setEnvironment] = React.useState<'TEST' | 'PROD' | ''>('');
  const [dbName, setDbName] = React.useState('');
  const [sshHost, setSshHost] = React.useState('');
  const [sshUser, setSshUser] = React.useState('root'); // préconfiguré, masqué en avancé
  const { pending, run } = useAction();

  const submit = async () => {
    if (!name.trim() || !url.trim()) return toast.error('Nom et adresse complète requis.');
    if (environment !== 'TEST' && environment !== 'PROD') {
      return toast.error('Choisissez l’environnement : il appartient à la destination et ne changera plus.');
    }
    const t = await run(
      () =>
        api.deployment.createTarget({
          name: name.trim(),
          url: url.trim(),
          environment,
          dbName: dbName.trim() || undefined,
          sshHost: sshHost.trim() || undefined,
          sshUser: sshUser.trim() || undefined,
        }),
      { success: 'Destination ajoutée.' }
    );
    onCreated(t);
  };

  return (
    <Panel className="mb-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Plus className="h-4 w-4" /> Nouvelle destination
      </div>
      <div className="space-y-3">
        <div>
          <Label>Nom</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Démo, Production…" />
        </div>
        <div>
          <Label>Adresse complète du site</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mon-site.fr" />
          <p className="mt-1 text-xs text-muted-foreground">Saisissez simplement l’adresse web complète. Nous déduisons le reste.</p>
        </div>
        <div>
          {/*
            L'ENVIRONNEMENT SE CHOISIT ICI, UNE FOIS POUR TOUTES.

            Aucune option n'est présélectionnée : il faut le choisir. Il
            décide de la base, de l'isolation des médias et de l'unicité de la
            destination active — et il ne changera plus.
          */}
          <Label>Environnement</Label>
          <div className="mt-1 inline-flex rounded-xl bg-muted p-1">
            {(['TEST', 'PROD'] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEnvironment(e)}
                className={cn(
                  'rounded-lg px-4 py-1.5 text-sm font-medium transition',
                  environment === e
                    ? (e === 'PROD' ? 'bg-red-600 text-white shadow-sm' : 'bg-background shadow-sm')
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {e === 'PROD' ? 'Production' : 'Test'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Immuable après création. Une seule destination active par environnement.
          </p>
        </div>
        <div>
          <Label>Adresse du serveur (facultatif)</Label>
          <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="203.0.113.10" />
          <p className="mt-1 text-xs text-muted-foreground">
            L’IP ou le nom de votre serveur. Elle sera pré-remplie au moment de publier.
          </p>
        </div>
        <AdvancedDisclosure>
          <div>
            <Label>Nom de la base (facultatif)</Label>
            <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="prod_base" />
          </div>
          <div>
            <Label>Utilisateur du serveur</Label>
            <Input value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="root" />
            <p className="mt-1 text-xs text-muted-foreground">Laissez « root » sauf indication contraire de votre hébergeur.</p>
          </div>
        </AdvancedDisclosure>
        <Button onClick={submit} loading={pending} className="w-full">
          <Plus className="h-4 w-4" /> Ajouter la destination
        </Button>
      </div>
    </Panel>
  );
}

export default TargetsGrid;
