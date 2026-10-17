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

/**
 * CARTE DE COLLECTION — une photo pleine, voilée de noir en bas, le nom posé
 * dessus en police de titre. Plus de bouton plein : toute la carte s'ouvre.
 */
export function CollectionGrid({ groups }: { groups: ServiceGroup[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3" data-testid="collection-grid">
      {groups.map((group) => {
        const cover = groupCover(group);
        return (
          <Link
            key={group.slug}
            to={`/prestations/${group.slug}`}
            className="group relative block aspect-[4/5] overflow-hidden rounded-xl ring-1 ring-black/10 sm:aspect-[4/3] sm:rounded-2xl"
            style={{ background: 'var(--v-menu-background)' }}
            data-testid="collection-card"
          >
            {cover ? (
              <img src={cover} alt={group.title} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]" />
            ) : (
              <div className="absolute inset-0 grid place-items-center" style={{ color: 'color-mix(in srgb, var(--v-menu-foreground) 50%, transparent)' }}><ImageIcon className="h-8 w-8" /></div>
            )}
            <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0) 70%)' }} />
            <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-black backdrop-blur sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
              {group.items.length} prestation{group.items.length > 1 ? 's' : ''}
            </span>
            <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-5">
              <h2 className="text-[1.05rem] font-semibold leading-tight tracking-normal sm:text-2xl" style={{ fontFamily: 'var(--font-heading)' }}>{group.title}</h2>
              {group.description && <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/75 max-sm:!hidden">{group.description}</p>}
              <span className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] sm:mt-3 sm:text-xs" style={{ color: 'var(--v-accent)' }}>
                Découvrir <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1 sm:h-3.5 sm:w-3.5" />
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
        <div key={i} className="aspect-[4/5] animate-pulse rounded-xl sm:aspect-[4/3] sm:rounded-2xl" style={{ background: 'color-mix(in srgb, var(--v-foreground) 8%, var(--v-background))' }} />
      ))}
    </div>
  );
}
