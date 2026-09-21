import { LifeBuoy, ExternalLink, Code2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { Reference } from '@/types';
import { useResource } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { TeamMemberCard } from '@/components/dev/TeamMemberCard';

/**
 * SUPPORT — qui s'occupe de ce site, et comment le joindre.
 *
 * ── D'OÙ VIENNENT CES INFORMATIONS ──────────────────────────────────────────
 * D'une SEULE source : la configuration publiée par le Panel. Cette page lisait
 * auparavant deux collections locales — l'entreprise développeur et l'équipe —
 * que chaque projet éditait pour son compte. Deux projets opérés par la même
 * agence pouvaient donc afficher deux numéros différents, et un déménagement
 * devait être répercuté autant de fois qu'il y avait de projets.
 *
 * ── « À JOUR » VEUT DIRE : LE DERNIER ÉTAT CONVERGÉ ─────────────────────────
 * Cette page n'interroge JAMAIS le Panel. Elle lit la copie que le pont a fait
 * converger dans ce projet. C'est délibéré : les coordonnées de l'agence
 * doivent rester lisibles quand le Panel est arrêté ou injoignable. Le pont
 * fait converger, l'écran affiche ce qui a convergé.
 *
 * Le mot « publication » a disparu d'ici avec le geste qu'il désignait : on
 * n'attend plus qu'une agence « publie » son entreprise, elle l'enregistre et
 * la convergence suit.
 *
 * ── AUCUN REPLI, AUCUNE VALEUR INVENTÉE ─────────────────────────────────────
 * Sans Panel appairé, la page affiche un état vide. Un contact inventé serait
 * pire que pas de contact du tout : le client appellerait un numéro qui n'est
 * plus le bon en croyant joindre son agence.
 */
export default function SupportInfoPage() {
  /**
   * LA SOURCE EST L'ENTREPRISE, PAS L'ÉTAT DE CONNEXION.
   *
   * Cette page demandait `/panel-connection/status` — une route réservée aux
   * comptes DEV. Un client qui ouvrait « Aide » recevait donc un 403, et
   * l'écran en concluait « ce projet n'est relié à aucun Panel », exactement là
   * où il venait chercher le téléphone de son agence.
   */
  /**
   * `live: 'panel-company'` — l'écran se revalide quand le backend l'annonce.
   *
   * ══ LE DÉFAUT QUE CETTE OPTION FERME ══════════════════════════════════════
   *
   * Le Panel enregistre, livre, et ce backend persiste en quelques dizaines de
   * millisecondes. Cette page, elle, chargeait UNE fois au montage : le nouveau
   * numéro de téléphone de l'agence n'apparaissait qu'après un rechargement —
   * précisément là où le client vient le chercher.
   *
   * La revalidation est SILENCIEUSE : pas d'écran de chargement, pas de toast.
   * Quelqu'un en train de lire ne doit pas voir la page clignoter.
   *
   * Et si le flux tombe, rien n'est perdu : la donnée est persistée, un
   * rechargement la montre. Le canal évite le rechargement, il n'en dépend pas.
   */
  const { data, loading } = useResource(
    () => api.getPanelCompany(),
    [],
    { live: 'panel-company' },
  );

  if (loading) return <BrandLoader />;

  const company = data?.company ?? null;
  const identity = company?.identity ?? null;
  const nom = (identity?.name ?? '').trim();
  /**
   * Le DESCRIPTEUR canonique d'abord, l'URL historique ensuite : le
   * descripteur porte les dimensions (donc pas de saut de mise en page) et
   * l'empreinte, qui change quand le logo change. Sans lui — Panel antérieur —
   * l'URL suffit. Sans l'un ni l'autre, aucun logo : jamais celui du client.
   */
  const logoDescriptor = company?.branding?.logo?.url
    ? company.branding.logo
    : (company?.branding?.logoUrl ? { url: company.branding.logoUrl, width: null, height: null } : null);
  const logo = logoDescriptor?.url ?? null;
  const references = [...(company?.references ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const equipe = (company?.team ?? []).filter((m) => m.active !== false);

  // Sans NOM, il n'y a pas d'entreprise à présenter. Le reste (logo, slogan,
  // références) n'a aucun sens seul.
  if (!nom) {
    return (
      <div>
        <PageHeader
          title="Support"
          description="Coordonnées et informations de l'équipe qui gère votre site."
        />
        <EmptyState
          icon={LifeBuoy}
          title="Aucune information de support"
          description={
            data?.paired
              ? "L'entreprise qui opère ce projet n'a pas encore renseigné ses coordonnées. Elles apparaîtront ici automatiquement."
              : "Ce projet n'est relié à aucun Panel. Les coordonnées de support viennent du Panel qui l'opère."
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Support"
        description="Coordonnées et informations de l'équipe qui gère votre site."
      />

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col items-center gap-4 border-b border-border p-8 text-center sm:flex-row sm:text-left">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted">
            {logo ? (
              /* L'adresse est ABSOLUE : le Panel l'a résolue en publiant,
                 parce que c'est un autre serveur qui sert l'image. */
              <img
                src={logo}
                alt={nom}
                width={logoDescriptor?.width ?? undefined}
                height={logoDescriptor?.height ?? undefined}
                className="h-full w-full object-contain"
                /* Média absent : on retombe proprement sur l'icône, plutôt
                   que de laisser une image cassée dans l'écran de support. */
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <Code2 className="h-9 w-9 text-muted-foreground" />
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold">{nom}</h2>
            {identity?.tagline ? (
              <p className="mt-1 text-muted-foreground">{identity.tagline}</p>
            ) : null}
          </div>
        </div>

        <CardContent>
          {references.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {references.map((r, i) => <ReferenceRow key={i} reference={r as Reference} />)}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune information de contact renseignée.
            </p>
          )}
        </CardContent>
      </Card>

      {equipe.length > 0 ? (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Users className="h-4 w-4" /> Personnes
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...equipe]
              .sort((a, b) => a.order - b.order)
              .map((m, i) => <TeamMemberCard key={`${m.email ?? ''}-${i}`} member={m} />)}
          </div>
        </div>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Pour toute demande technique (bug, évolution, suspension…), contactez l'équipe ci-dessus.
      </p>
    </div>
  );
}

/** Une référence de l'entreprise : cliquable si c'est une adresse absolue. */
function ReferenceRow({ reference }: { reference: Reference }) {
  const valeur = (reference.value ?? '').trim();
  // Un lien relatif pointerait sur le site du client : on ne rend cliquable
  // que ce qui désigne vraiment une adresse externe.
  const cliquable = reference.type === 'LINK' && /^https?:\/\//i.test(valeur);

  const contenu = (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3 transition hover:bg-muted">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <i className={`bi ${reference.icon}`} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{reference.name}</p>
        <p className="truncate font-medium">{valeur || '—'}</p>
      </div>
      {cliquable ? <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
    </div>
  );

  return cliquable
    ? <a href={valeur} target="_blank" rel="noreferrer">{contenu}</a>
    : contenu;
}
