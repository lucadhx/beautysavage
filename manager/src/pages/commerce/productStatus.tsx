import { Archive, Eye, EyeOff, PowerOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LE STATUT DE PUBLICATION D'UNE FICHE — un seul vocabulaire, une seule couleur
 * par état, partout (tableaux, éditeur, widget flottant).
 *
 *   PUBLISHED  Visible      œil          vert
 *   DRAFT      Brouillon    œil barré    orange
 *   DISABLED   Désactivée   « off »      rouge
 *   ARCHIVED   Archivée     archive      gris
 */
export type ProductStatus = 'PUBLISHED' | 'DRAFT' | 'DISABLED' | 'ARCHIVED';

export const PRODUCT_STATUS_META: Record<ProductStatus, { label: string; hint: string; icon: LucideIcon; badge: string; dot: string; solid: string }> = {
  PUBLISHED: {
    label: 'Visible',
    hint: 'Affichée sur la vitrine.',
    icon: Eye,
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    solid: 'bg-emerald-600 text-white',
  },
  DRAFT: {
    label: 'Brouillon',
    hint: 'Invisible tant que la fiche n’est pas prête.',
    icon: EyeOff,
    badge: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
    dot: 'bg-orange-500',
    solid: 'bg-orange-500 text-white',
  },
  DISABLED: {
    label: 'Désactivée',
    hint: 'Masquée temporairement.',
    icon: PowerOff,
    badge: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
    dot: 'bg-rose-500',
    solid: 'bg-rose-600 text-white',
  },
  ARCHIVED: {
    label: 'Archivée',
    hint: 'Conservée pour l’historique.',
    icon: Archive,
    badge: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    dot: 'bg-slate-400',
    solid: 'bg-slate-500 text-white',
  },
};

export const PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_META) as ProductStatus[];

export function productStatusMeta(status?: string) {
  return PRODUCT_STATUS_META[(status as ProductStatus) || 'DRAFT'] ?? PRODUCT_STATUS_META.DRAFT;
}

export function ProductStatusBadge({ status, className }: { status?: string; className?: string }) {
  const meta = productStatusMeta(status);
  const Icon = meta.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold', meta.badge, className)}
      data-status={status}
      data-testid="product-status-badge"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
