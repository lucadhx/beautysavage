import { cn } from '@/lib/utils';

/**
 * CONTENU FANTÔME — la forme de ce qui arrive, qui pulse en fondu.
 *
 * Remplace les écrans blancs à loader central : la page garde sa structure
 * (titre, cartes, tableau) pendant le chargement, et le vrai contenu prend sa
 * place sans saut. Règle d'usage :
 *  · une PAGE qui charge          → <PageSkeleton /> (ou <BrandLoader />) ;
 *  · un TABLEAU dont les données arrivent → <TableSkeleton />, JAMAIS l'état
 *    vide : « Aucun élément » ne s'affiche qu'une fois la réponse reçue ;
 *  · un FORMULAIRE d'édition      → <FormSkeleton />.
 *
 * `animate-pulse` est un fondu d'opacité (pas de balayage) : discret, et
 * désactivé par Tailwind quand l'utilisateur demande moins d'animations.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

function Status({ label }: { label: string }) {
  return <span role="status" className="sr-only">{label}</span>;
}

export function TableSkeleton({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border', className)} data-testid="table-skeleton">
      <Status label="Chargement de la liste…" />
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className={cn('h-3', i === 0 ? 'w-40' : 'w-20')} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0" style={{ animationDelay: `${r * 80}ms` }}>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-3/5 max-w-sm" />
            <Skeleton className="h-2.5 w-2/5 max-w-xs" />
          </div>
          {Array.from({ length: Math.max(0, cols - 1) }, (_, c) => <Skeleton key={c} className="hidden h-3.5 w-20 sm:block" />)}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid gap-3 rounded-xl border p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 6, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn('grid gap-5 rounded-xl border p-5', className)} data-testid="form-skeleton">
      <Status label="Chargement…" />
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="grid gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export function PageSkeleton({ variant = 'table' }: { variant?: 'table' | 'form' }) {
  return (
    <div className="grid gap-6" data-testid="page-skeleton">
      <div className="grid gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      {variant === 'form' ? <FormSkeleton /> : (
        <>
          <CardsSkeleton />
          <TableSkeleton />
        </>
      )}
    </div>
  );
}
