import { FormSkeleton, PageSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

/**
 * ATTENTE D'UNE PAGE — du CONTENU FANTÔME, plus un logo au centre d'un écran vide.
 *
 * Le logo animé au milieu d'une page blanche faisait disparaître toute la
 * structure pendant le chargement : l'œil perdait ses repères, puis tout
 * apparaissait d'un coup. La page montre désormais la FORME de ce qui arrive
 * (titre, cartes, tableau ou formulaire), en fondu pulsé — voir `Skeleton.tsx`.
 *
 * Le nom est conservé : ses 50 et quelques usages décrivent toujours « la page
 * charge », et c'est ce composant qui décide à quoi ressemble cette attente.
 *
 *   variant="page"  — une page entière (titre + cartes + tableau), défaut ;
 *   variant="form"  — une page d'édition (titre + formulaire) ;
 *   variant="list"  — une zone de liste au sein d'une page déjà affichée.
 */
export function BrandLoader({
  className,
  label = 'Chargement…',
  variant = 'page',
}: {
  className?: string;
  label?: string;
  variant?: 'page' | 'form' | 'list';
}) {
  return (
    <div className={cn('w-full', className)} aria-busy="true">
      <span role="status" className="sr-only">{label}</span>
      {variant === 'list' ? <TableSkeleton rows={5} /> : variant === 'form' ? (
        <div className="grid gap-6">
          <PageSkeletonHeader />
          <FormSkeleton />
        </div>
      ) : <PageSkeleton />}
    </div>
  );
}

function PageSkeletonHeader() {
  return (
    <div className="grid gap-2">
      <div className="h-7 w-64 max-w-full animate-pulse rounded-md bg-muted" />
      <div className="h-3.5 w-96 max-w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
