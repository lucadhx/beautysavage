import { Lock, ExternalLink, RefreshCw, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { TeamMember } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { usePollWhile } from '@/hooks/useContractJourney';
import { PageHeader } from '@/components/layout/PageHeader';
import { BrandLoader } from '@/components/ui/BrandLoader';
import {
  Card, CardContent, CardHeader, CardTitle, Button, EmptyState,
} from '@/components/ui/primitives';
import { TeamMemberCard } from '@/components/dev/TeamMemberCard';

/**
 * ÉQUIPE DE L'AGENCE — administrée depuis le Panel, consultée ici.
 *
 * ── POURQUOI CETTE PAGE NE S'ÉDITE PLUS ─────────────────────────────────────
 * Chaque projet tenait sa propre liste, éditée sur place. Deux projets opérés
 * par la même agence pouvaient donc annoncer deux équipes différentes, et un
 * départ devait être répercuté autant de fois qu'il y avait de projets. Le
 * Panel publie désormais une liste unique.
 *
 * Ce qui s'affiche ici est la DERNIÈRE liste reçue, conservée localement :
 * elle reste lisible même quand le Panel est injoignable.
 *
 * ── AUCUN REPLI ─────────────────────────────────────────────────────────────
 * Sans Panel appairé, ou sans entreprise publiée, la page est VIDE. Afficher
 * quelqu'un que l'autorité ne connaît pas serait pire que n'afficher
 * personne : un client appellerait un numéro qui n'est plus le bon.
 */
export default function DevTeamPage() {
  const { data, loading, refresh } = useResource(() => api.getPanelConnection());
  const { pending, run } = useAction();

  // Le Panel publie, cette page suit — sans qu'on recharge quoi que ce soit.
  usePollWhile(true, () => refresh(), 10_000);

  const resynchroniser = async () => {
    try {
      await run(() => api.syncPanelNow(), { success: 'Synchronisation demandée' });
      await refresh();
    } catch { /* le toast dit ce qui bloque */ }
  };

  if (loading) return <BrandLoader />;

  const company = data?.company ?? null;
  const panelUrl = data?.pairing?.panelUrl ?? null;
  const membres: TeamMember[] = company?.team ?? [];
  const affiches = membres.filter((m) => m.active !== false);

  const actions = panelUrl ? (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={resynchroniser} loading={pending}>
        <RefreshCw className="h-4 w-4" /> Resynchroniser
      </Button>
      <Button variant="outline" onClick={() => window.open(panelUrl, '_blank', 'noopener,noreferrer')}>
        <ExternalLink className="h-4 w-4" /> Ouvrir le Panel
      </Button>
    </div>
  ) : undefined;

  return (
    <div className="pb-20">
      <PageHeader
        title="Équipe"
        description="Les personnes affichées sur la page Support de ce projet."
        action={actions}
      />

      {/* Le bandeau dit QUI décide, et où aller pour modifier. Sans lui, une
          page en lecture seule ressemble à une page en panne. */}
      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">Configuration administrée depuis le Panel</p>
            <p className="text-muted-foreground">
              Cette équipe est publiée par le Panel et ne se modifie plus ici. Les
              changements apparaissent automatiquement à la prochaine synchronisation.
            </p>
          </div>
        </div>
      </div>

      {affiches.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun membre publié"
          description={
            panelUrl
              ? "Le Panel n'a publié aucun membre d'équipe. Renseignez-les depuis le Panel : ils apparaîtront ici, et sur la page Support."
              : "Ce projet n'est relié à aucun Panel. L'équipe est administrée depuis le Panel qui opère le projet."
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...affiches]
              .sort((a, b) => a.order - b.order)
              .map((m, i) => <TeamMemberCard key={`${m.email ?? ''}-${i}`} member={m} />)}
          </div>

          {/* Un membre retiré de l'affichage reste publié : le dire évite de
              croire à une perte de données. */}
          {membres.length > affiches.length ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Retirés de l'affichage</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {membres.length - affiches.length} personne(s) sont publiées mais
                  masquées : elles n'apparaissent pas sur la page Support.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
