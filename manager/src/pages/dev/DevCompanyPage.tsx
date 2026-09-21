import { ExternalLink, Link as LinkIcon, Lock, RefreshCw, Type } from 'lucide-react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { api } from '@/lib/api';
import { useResource, useAction } from '@/hooks/useResource';
import { usePollWhile } from '@/hooks/useContractJourney';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDateTime } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  EmptyState,
} from '@/components/ui/primitives';

/**
 * ENTREPRISE DÉVELOPPEUR — administrée depuis le Panel, consultée ici.
 *
 * ── POURQUOI CETTE PAGE NE S'ÉDITE PLUS ─────────────────────────────────────
 * Elle était le formulaire d'une identité que le Panel publie désormais. Deux
 * formulaires modifiaient donc deux vérités, et rien ne disait laquelle
 * l'emportait : un projet a fini par signer son site d'un nom que le Panel ne
 * connaissait pas. Une seule autorité, une seule saisie.
 *
 * Ce qui s'affiche ici est la DERNIÈRE configuration reçue, conservée
 * localement : elle reste lisible même quand le Panel est injoignable, avec sa
 * date d'application et sa provenance — de quoi constater la convergence, ou
 * constater qu'elle n'a pas eu lieu.
 */
export default function DevCompanyPage() {
  const { data, loading, refresh } = useResource(() => api.getPanelConnection());
  const { pending, run } = useAction();

  /**
   * L'ÉCRAN SUIT LE PANEL SANS QU'ON RECHARGE LA PAGE.
   *
   * Cette page ne lisait sa donnée qu'au montage. Une identité modifiée puis
   * publiée depuis le Panel n'apparaissait donc qu'après un rechargement
   * manuel — un miroir qui ne reflète qu'au premier regard n'est pas un
   * miroir. Le sondage est SILENCIEUX : les valeurs précédentes restent à
   * l'écran pendant la requête et sont remplacées d'un coup, sans clignotement
   * ni perte de position.
   *
   * Revenir sur l'onglet rafraîchit immédiatement — c'est le geste typique :
   * on publie dans le Panel, on revient ici.
   */
  usePollWhile(true, () => refresh(), 10_000);

  /**
   * Et si l'on ne veut pas attendre : demander au projet de resynchroniser
   * MAINTENANT, puis relire. La cadence automatique reste la règle ; ceci
   * n'est qu'un raccourci, jamais un passage obligé.
   */
  const resynchroniser = async () => {
    try {
      await run(() => api.syncPanelNow(), { success: 'Synchronisation demandée' });
      await refresh();
    } catch { /* le toast dit ce qui bloque */ }
  };

  if (loading) return <BrandLoader />;

  const company = data?.company ?? null;
  const identity = company?.identity ?? null;
  const panelUrl = data?.pairing?.panelUrl ?? null;
  const references = company?.references ?? [];
  const signer = company?.signer ?? null;

  const ouvrirPanel = panelUrl ? (
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
        title="Entreprise développeur"
        description="Informations de l'agence affichées dans le pied de page du site."
        action={ouvrirPanel}
      />

      {/* Le bandeau dit QUI décide, et où aller pour modifier. Sans lui, une
          page en lecture seule ressemble à une page en panne. */}
      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">Configuration administrée depuis le Panel</p>
            <p className="text-muted-foreground">
              Cette identité est publiée par le Panel et ne se modifie plus ici. Les
              changements apparaissent automatiquement à la prochaine synchronisation.
            </p>
          </div>
        </div>
        {ouvrirPanel}
      </div>

      {!company ? (
        <EmptyState
          icon={Lock}
          title="Aucune identité reçue"
          description={
            panelUrl
              ? "Le Panel n'a encore publié aucune entreprise développeur. Renseignez-la depuis le Panel : elle apparaîtra ici, et dans le pied de page du site."
              : "Ce projet n'est relié à aucun Panel. L'entreprise développeur est administrée depuis le Panel qui opère le projet."
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Identité</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Ligne label="Nom" valeur={identity?.name} />
                <Ligne label="Slogan" valeur={identity?.tagline} />
                <Ligne label="Raison sociale" valeur={identity?.legalName} />
                <Ligne label="Site" valeur={company.domains?.websiteUrl} lien />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Signataire des contrats</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {signer ? (
                  <>
                    <Ligne label="Prénom" valeur={signer.firstName} />
                    <Ligne label="Nom" valeur={signer.lastName} />
                    <Ligne label="Fonction" valeur={signer.jobTitle} />
                    <Ligne label="E-mail" valeur={signer.email} />
                  </>
                ) : (
                  /* Ce n'est pas un détail : sans signataire, la validation d'un
                     contrat sera refusée — autant le dire ici. */
                  <p className="text-muted-foreground">
                    Aucun signataire publié. Tant qu'il manque, la validation d'un contrat
                    sera refusée.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Références</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {references.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Aucune référence publiée.</p>
                ) : (
                  references.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                        {r.type === 'LINK' ? <LinkIcon className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}
                        {r.type === 'LINK' ? 'Lien' : 'Texte'}
                      </span>
                      <span className="font-medium">{r.name || '—'}</span>
                      <span className="ml-auto truncate text-muted-foreground">{r.value || '—'}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Logo</CardTitle></CardHeader>
              <CardContent>
                {company.branding?.logoUrl ? (
                  <img
                    src={company.branding.logoUrl}
                    alt=""
                    className="max-h-32 w-full rounded-lg object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Aucun logo publié.</p>
                )}
              </CardContent>
            </Card>

            {/* La provenance et la date : de quoi distinguer « à jour » de
                « jamais rattrapé ». */}
            <Card>
              <CardHeader><CardTitle>Synchronisation</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Ligne label="Source" valeur={company.source === 'BOOTSTRAP' ? 'Appairage' : 'Synchronisation'} />
                <Ligne label="Version" valeur={company.version ? `v${company.version}` : null} />
                <Ligne
                  label="Appliquée le"
                  valeur={company.appliedAt ? formatDateTime(company.appliedAt) : null}
                />
                <Ligne label="Environnement" valeur={company.environment} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** Une donnée reçue — jamais un champ de saisie. */
function Ligne({ label, valeur, lien }: { label: string; valeur?: string | null; lien?: boolean }) {
  const vide = !valeur || !String(valeur).trim();
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {vide ? (
        <span className="text-muted-foreground">—</span>
      ) : lien ? (
        <a
          href={String(valeur)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-right underline underline-offset-2"
        >
          {valeur}
        </a>
      ) : (
        <span className="text-right">{valeur}</span>
      )}
    </div>
  );
}
