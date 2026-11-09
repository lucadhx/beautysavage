import { Link } from 'react-router-dom';
import { BookOpen, Check } from 'lucide-react';
import type { CommerceProduct } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { formatEuro } from '@/components/GiftCardPayment';

/**
 * LE CONTENU D'UN PACK (repris de melinails) — chaque formation incluse
 * (visuel, titre, modules), sa valeur à l'unité, et ce que le pack fait
 * économiser. Chaque formation mène à sa propre fiche pour qui veut le détail.
 */
export function PackContents({ product }: { product: CommerceProduct }) {
  const items = product.pack?.items || [];
  if (!items.length) return null;
  const value = product.pack?.valueCents || items.reduce((s, i) => s + i.priceCents, 0);
  const saving = Math.max(0, value - product.price.amountCents);
  return (
    <section className="mb-7 rounded-lg border p-4 sm:p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="pack-contents">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Inclus dans le pack</p>
      <h2 className="mt-1.5 text-xl font-semibold leading-tight sm:text-2xl">
        {items.length} formations en ligne, un seul accès
      </h2>
      <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-3 rounded-md border p-3 sm:gap-4" style={{ borderColor: 'var(--v-border)' }} data-testid="pack-item">
            {item.coverUrl
              ? <img src={resolvePreviewMediaUrl(item.coverUrl)} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded object-cover sm:h-20 sm:w-20" />
              : <span className="grid h-16 w-16 shrink-0 place-items-center rounded sm:h-20 sm:w-20" style={{ background: 'var(--v-muted, #f4f4f5)' }}><BookOpen className="h-5 w-5" /></span>}
            <div className="min-w-0 flex-1">
              <Link to={`/catalogue/${item.slug}`} className="line-clamp-2 break-words text-[15px] font-semibold leading-snug hover:underline sm:text-base">{item.title}</Link>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                {item.moduleCount} module{item.moduleCount > 1 ? 's' : ''} · seule : <span className="line-through">{formatEuro(item.priceCents)}</span>
              </p>
            </div>
            <Check className="h-5 w-5 shrink-0" style={{ color: 'var(--v-accent)' }} aria-hidden="true" />
          </li>
        ))}
      </ul>
      {saving > 0 && (
        <p className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-4 text-sm" style={{ borderColor: 'var(--v-border)' }} data-testid="pack-saving">
          <span>Valeur à l’unité : <span className="line-through">{formatEuro(value)}</span></span>
          <span className="text-base font-semibold" style={{ color: '#047857' }}>Vous économisez {formatEuro(saving)}</span>
        </p>
      )}
    </section>
  );
}
