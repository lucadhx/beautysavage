/**
 * Accueil du module : hero rassurant + deux grandes cartes d'action, puis des
 * entrées secondaires (cibles, historique). Aucune sensation « admin Linux ».
 */
import { Copy, Rocket, LayoutGrid, History, ArrowRight, Link2 } from 'lucide-react';
import { Reveal, ActionCard } from './ui';
import { DuplicateArt, DeployArt, HeroGlow } from './illustrations';

export type LandingDestination = 'duplicate' | 'deploy' | 'targets' | 'history';

export function Landing({
  version,
  targetCount,
  onGo,
}: {
  version: string | null;
  targetCount: number;
  onGo: (d: LandingDestination) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card px-8 py-12 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-10 text-primary">
          <HeroGlow className="h-48 w-full" />
        </div>
        <Reveal>
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Rocket className="h-3.5 w-3.5" /> Publication de sites
            </span>
            <h1 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Déployez et gérez vos sites en quelques clics.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Dupliquez un projet, personnalisez-le puis publiez-le en ligne. Nous nous occupons de toute la technique —
              serveur, sécurité et mise en ligne — pour vous.
            </p>
            {version && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" /> Version actuelle <span className="font-mono text-foreground">{version}</span>
              </div>
            )}
          </div>
        </Reveal>
      </div>

      {/* Deux grandes cartes */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Reveal delay={0.05}>
          <ActionCard
            icon={Copy}
            art={<DuplicateArt className="h-full w-full" />}
            title="Dupliquer un projet"
            description="Créer une nouvelle copie de ce projet, prête à être personnalisée."
            cta="Commencer"
            onClick={() => onGo('duplicate')}
          />
        </Reveal>
        <Reveal delay={0.1}>
          <ActionCard
            icon={Rocket}
            art={<DeployArt className="h-full w-full" />}
            title="Déployer un site"
            description="Publier une nouvelle version en ligne, en toute sécurité."
            cta="Déployer"
            accent="emerald"
            onClick={() => onGo('deploy')}
          />
        </Reveal>
      </div>

      {/*
        Entrées secondaires.

        `minmax(0,1fr)` plutôt que `1fr` : un élément de grille vaut
        `min-width: auto` et refuse de descendre sous la largeur minimale de
        son contenu. Les deux cartes se posaient donc à 341 px dans un écran de
        320, et la page gagnait une barre de défilement horizontale.
      */}
      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Reveal delay={0.12}>
          <SecondaryCard
            icon={LayoutGrid}
            title="Mes sites"
            description={targetCount > 0 ? `${targetCount} destination${targetCount > 1 ? 's' : ''} configurée${targetCount > 1 ? 's' : ''}` : 'Aucune destination pour le moment'}
            onClick={() => onGo('targets')}
          />
        </Reveal>
        <Reveal delay={0.16}>
          <SecondaryCard
            icon={History}
            title="Historique"
            description="Retrouvez toutes vos mises en ligne."
            onClick={() => onGo('history')}
          />
        </Reveal>
      </div>
    </div>
  );
}

function SecondaryCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof LayoutGrid;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border border-border/70 bg-card p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground/70">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
