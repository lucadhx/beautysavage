/**
 * Carte de destination (cible) réutilisable : mode « sélection » (assistant) et
 * mode « gestion » (page Mes sites). URL, version, dernier déploiement, état.
 */
import * as React from 'react';
import { Globe, Rocket, Trash2, Check, GitCommitHorizontal, Clock, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/utils';
import type { DeploymentTarget } from '@/types';

export function StateChip({ state }: { state: DeploymentTarget['state'] }) {
  const map: Record<DeploymentTarget['state'], { c: string; l: string }> = {
    NEW: { c: 'bg-slate-100 text-slate-600', l: 'Jamais publié' },
    DEPLOYING: { c: 'bg-blue-100 text-blue-700', l: 'Publication…' },
    DEPLOYED: { c: 'bg-emerald-100 text-emerald-700', l: 'En ligne' },
    FAILED: { c: 'bg-red-100 text-red-700', l: 'À republier' },
  };
  const m = map[state];
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', m.c)}>{m.l}</span>;
}

/**
 * ETAT DU CYCLE DE VIE - ce que la destination occupe encore sur le serveur.
 *
 * Volontairement distinct de `StateChip` : une destination peut avoir ete
 * « en ligne » avec succes ET etre videe aujourd'hui. Confondre les deux
 * laisserait croire qu'un site repond alors qu'il n'y a plus rien.
 */
export function LifecycleChip({ status }: { status: DeploymentTarget['lifecycleStatus'] }) {
  const map: Record<string, { c: string; l: string; t: string }> = {
    ACTIVE: { c: 'bg-emerald-100 text-emerald-700', l: 'En place', t: 'Fichiers, service et routage sont sur le serveur.' },
    DEPROVISIONING: { c: 'bg-amber-100 text-amber-800', l: 'Retrait en cours', t: 'Aucune autre operation n\u2019est possible.' },
    EMPTY: { c: 'bg-slate-100 text-slate-600', l: 'Videe', t: 'Plus rien sur le serveur ; le domaine repond 410. La fiche peut etre supprimee.' },
    DEPROVISION_FAILED: { c: 'bg-red-100 text-red-700', l: 'Retrait en echec', t: 'Le retrait s\u2019est interrompu ; il peut etre relance.' },
    DELETED: { c: 'bg-slate-100 text-slate-400', l: 'Supprimee', t: 'Fiche supprimee ; historique conserve.' },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <span title={m.t} className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', m.c)}>
      {m.l}
    </span>
  );
}

/** PROD se voit d\u2019un coup d\u2019\u0153il : la couleur est une information, pas un decor. */
export function EnvironmentChip({ environment }: { environment: DeploymentTarget['environment'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        environment === 'PROD' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600',
      )}
    >
      {environment}
    </span>
  );
}

export function TargetCard({
  target,
  mode = 'manage',
  selected = false,
  onSelect,
  onDeploy,
  onDeprovision,
  onDelete,
}: {
  target: DeploymentTarget;
  mode?: 'manage' | 'select';
  selected?: boolean;
  onSelect?: () => void;
  onDeploy?: () => void;
  onDeprovision?: () => void;
  onDelete?: () => void;
}) {
  const clickable = mode === 'select';
  const Wrapper: React.ElementType = clickable ? 'button' : 'div';
  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onSelect : undefined}
      className={cn(
        'group relative w-full rounded-2xl border bg-card p-5 text-left transition-all',
        'shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        clickable && 'hover:border-primary/40 hover:shadow-[0_8px_24px_-16px_rgba(16,24,40,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border/70'
      )}
    >
      {selected && (
        <span className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground/70">
          <Globe className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{target.name}</span>
            <EnvironmentChip environment={target.environment} />
            <StateChip state={target.state} />
            <LifecycleChip status={target.lifecycleStatus} />
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">{target.host}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          {/*
            « aucune version » ne veut PAS dire « rien de deploye ».
            Une destination reprise d'avant le registre n'a jamais eu de hash
            tout en servant reellement un domaine : l'ecran annoncait un
            serveur vide devant un serveur plein, et cachait le seul bouton
            qui permettait de le nettoyer. Le backend tranche desormais.
          */}
          {target.currentVersion ? (
            <span className="font-mono">{target.currentVersion}</span>
          ) : target.versionUnknown ? (
            <span title="Cette destination occupe encore le serveur ; sa version n'a jamais ete enregistree.">
              version inconnue (heritee)
            </span>
          ) : (
            'aucune version'
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {target.lastDeployedAt ? formatDateTime(target.lastDeployedAt) : 'jamais publié'}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5">
          {target.type === 'subdomain' ? 'sous-domaine' : 'domaine'}
        </span>
      </div>

      {target.lifecycleStatus === 'DEPROVISION_FAILED' && target.lastError?.message && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Retrait interrompu
          {target.lastError.step ? ` a l\u2019etape « ${target.lastError.step} »` : ''}
          {' : '}{target.lastError.message}
          {target.lastError.code ? ` (${target.lastError.code})` : ''}
        </p>
      )}

      {mode === 'manage' && (
        /*
          CE QUE L'ECRAN PROPOSE VIENT DU BACKEND.

          `canDeploy`, `canDeprovision` et `canDelete` sont calcules par les
          memes gardes qui refuseront l'appel. L'ecran les AFFICHE, il ne les
          redecide pas - une seconde table de regles finirait par diverger de
          la premiere, et c'est l'interface qui aurait tort.
        */
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onDeprovision}
              disabled={!target.canDeprovision}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
              title={target.canDeprovision
                ? 'Arrete le service, libere le port, retire le routage et supprime les fichiers.'
                : `Indisponible : la destination est ${target.lifecycleLabel}.`}
            >
              <PowerOff className="h-3.5 w-3.5" />
              {target.lifecycleStatus === 'DEPROVISION_FAILED' || target.lifecycleStatus === 'DEPROVISIONING'
                ? 'Reprendre le retrait'
                : 'Retirer le deploiement'}
            </button>

            {/*
              Visible en PERMANENCE, actif seulement sur une destination videe.
              Le cacher laisserait croire que la suppression n'existe pas ;
              l'activer plus tot referait le defaut corrige - une fiche
              supprimee alors que le serveur porte encore service, port et
              fichiers, sans plus rien pour dire qu'il reste a nettoyer.
            */}
            <button
              type="button"
              onClick={onDelete}
              disabled={!target.canDelete}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              title={target.canDelete
                ? 'Supprime la fiche ; historique et audit conserves.'
                : 'Disponible seulement une fois la destination videe.'}
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </button>
          </div>

          <button
            type="button"
            onClick={onDeploy}
            disabled={!target.canDeploy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Rocket className="h-3.5 w-3.5" />
            {target.lifecycleStatus === 'EMPTY' ? 'Redeployer' : 'Deployer ici'}
          </button>
        </div>
      )}

    </Wrapper>
  );
}

export default TargetCard;
