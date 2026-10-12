import { Link } from 'react-router-dom';
import { ArrowRight, Image as ImageIcon } from 'lucide-react';
import { type CommerceProduct, type ServiceCollection } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';

/**
 * LES RAYONS DE LA PAGE « PRESTATIONS ».
 *
 * Quand l'institut range ses prestations en collections, la page les montre
 * d'abord sous forme de cartes ; « Voir les prestations » ouvre la collection.
 * Les prestations publiées rangées nulle part ne disparaissent pas : elles
 * forment une dernière carte, « Autres prestations ».
 */
export const OTHER_SLUG = 'autres-prestations';

export interface ServiceGroup {
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
  items: CommerceProduct[];
}

export function buildServiceGroups(services: CommerceProduct[], collections: ServiceCollection[]): ServiceGroup[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const groups: ServiceGroup[] = [];
  for (const c of collections) {
    const items = c.productIds.map((id) => byId.get(id)).filter(Boolean) as CommerceProduct[];
    items.forEach((s) => placed.add(s.id));
    if (items.length) groups.push({ slug: c.slug, title: c.title, description: c.description, coverUrl: c.coverUrl, items });
  }
  const others = services.filter((s) => !placed.has(s.id));
  if (groups.length && others.length) {
    groups.push({ slug: OTHER_SLUG, title: 'Autres prestations', description: 'Les prestations qui ne sont rangées dans aucune collection.', coverUrl: '', items: others });
  }
  return groups;
}

function groupCover(group: ServiceGroup) {
  return resolvePreviewMediaUrl(group.coverUrl || group.items[0]?.coverUrl || group.items[0]?.gallery?.[0] || '');
}

export function CollectionGrid({ groups }: { groups: ServiceGroup[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3" data-testid="collection-grid">
      {groups.map((group) => {
        const cover = groupCover(group);
        return (
          <Link
            key={group.slug}
            to={`/prestations/${group.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-lg border transition-transform hover:-translate-y-1"
            style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}
            data-testid="collection-card"
          >
            <div className="relative aspect-square w-full overflow-hidden sm:aspect-[16/10]" style={{ background: 'color-mix(in srgb, var(--v-foreground) 5%, var(--v-background))' }}>
              {cover ? (
                <img src={cover} alt={group.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              ) : (
                <div className="grid h-full place-items-center" style={{ color: 'var(--v-muted-foreground)' }}><ImageIcon className="h-8 w-8" /></div>
              )}
              <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:left-3 sm:top-3 sm:px-3 sm:py-1 sm:text-xs" style={{ background: 'var(--v-background)', color: 'var(--v-foreground)' }}>
                {group.items.length} prestation{group.items.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3 sm:gap-3 sm:p-5">
              <h2 className="text-base font-semibold leading-snug tracking-normal sm:text-2xl">{group.title}</h2>
              {group.description && <p className="line-clamp-2 text-sm leading-6 max-sm:!hidden" style={{ color: 'var(--v-muted-foreground)' }}>{group.description}</p>}
              <span
                className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold sm:gap-2 sm:px-5 sm:py-3 sm:text-sm"
                style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)', borderRadius: 'var(--v-radius)' }}
              >
                <span className="sm:hidden">Voir</span><span className="max-sm:hidden">Voir les prestations</span> <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function CollectionGridSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--v-border)' }}>
          <div className="aspect-square animate-pulse sm:aspect-[16/10]" style={{ background: 'color-mix(in srgb, var(--v-foreground) 8%, var(--v-background))' }} />
          <div className="grid gap-3 p-3 sm:p-5">
            <div className="h-6 w-2/3 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--v-foreground) 8%, var(--v-background))' }} />
            <div className="h-10 animate-pulse rounded" style={{ background: 'color-mix(in srgb, var(--v-foreground) 8%, var(--v-background))' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
