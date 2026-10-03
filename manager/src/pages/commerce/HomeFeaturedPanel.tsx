import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Home, ImageOff, Loader2, Minus, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { Button } from '@/components/ui/primitives';
import { KIND_LABEL, cents, type CommerceProduct } from './CommerceShared';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * MISE EN AVANT SUR L'ACCUEIL.
 *
 * Deux temps, deux écrans :
 *  · sur la liste de la rubrique, un bandeau compact montre ce que l'accueil
 *    affiche (couverture + titre) et mène à la sélection ;
 *  · la page de sélection, dédiée, sépare ce qui est choisi (bouton « Retirer »)
 *    de ce qui peut l'être (bouton « Choisir »), avec une recherche.
 * Aucun plafond : l'institut met en avant autant de fiches qu'il le souhaite.
 * Chaque choix est enregistré tout de suite.
 */

export type FeaturedGroup = 'TRAINING' | 'SERVICE';

const GROUP = {
  TRAINING: {
    kinds: ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'],
    plural: 'formations',
    listPath: '/commerce/formations',
    back: 'Retour aux formations',
  },
  SERVICE: {
    kinds: ['SERVICE'],
    plural: 'prestations',
    listPath: '/commerce/prestations',
    back: 'Retour aux prestations',
  },
} as const;

export function featuredOf(products: CommerceProduct[]) {
  return products
    .filter((p) => p.homeFeatured)
    .sort((a, b) => (a.homeFeaturedRank ?? Infinity) - (b.homeFeaturedRank ?? Infinity));
}

/** Filtre plein texte : titre, sous-titre, description — sans accents ni casse. */
export function matchesSearch(product: CommerceProduct, query: string) {
  const norm = (value?: string) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = norm(query).trim();
  if (!q) return true;
  const haystack = norm(`${product.title} ${product.subtitle || ''} ${product.description || ''}`);
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

export function SearchInput({ value, onChange, placeholder, testId }: { value: string; onChange: (value: string) => void; placeholder: string; testId?: string }) {
  return (
    <label className="relative block w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function Cover({ product, className = '' }: { product: CommerceProduct; className?: string }) {
  const url = resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
  return (
    <div className={`relative overflow-hidden bg-muted ${className}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground"><ImageOff className="h-5 w-5" /></div>
      )}
    </div>
  );
}

/* ── Bandeau de la liste ───────────────────────────────────────────────── */

export function FeaturedStrip({ group, products, loading = false }: { group: FeaturedGroup; products: CommerceProduct[]; loading?: boolean }) {
  const cfg = GROUP[group];
  const chosen = featuredOf(products);
  if (loading) {
    return (
      <section className="rounded-xl border border-rose-200 bg-card p-4 shadow-sm dark:border-rose-900" data-testid="featured-strip-skeleton">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
        <div className="mt-3 flex gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-40 shrink-0" />)}</div>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-rose-200 bg-card p-4 shadow-sm dark:border-rose-900" data-testid="featured-strip">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-semibold"><Home className="h-4 w-4 text-rose-600" /> Mises en avant sur l'accueil</h2>
          <p className="text-sm text-muted-foreground">
            {chosen.length === 0
              ? `Aucune sélection : l'accueil affiche les trois premières ${cfg.plural} du catalogue.`
              : `${chosen.length} ${chosen.length > 1 ? cfg.plural : cfg.plural.slice(0, -1)} affichée${chosen.length > 1 ? 's' : ''} sur l'accueil, dans cet ordre.`}
          </p>
        </div>
        <Link
          to={`${cfg.listPath}/mise-en-avant`}
          className="inline-flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
          data-testid="featured-edit"
        >
          <Pencil className="h-4 w-4" /> Modifier la sélection
        </Link>
      </div>
      {chosen.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {chosen.map((p, index) => (
            <div key={p._id} className="w-40 shrink-0 overflow-hidden rounded-lg border bg-background" data-testid="featured-card">
              <div className="relative">
                <Cover product={p} className="aspect-[4/3]" />
                <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-[10px] font-bold text-white">{index + 1}</span>
              </div>
              <p className="truncate px-2 py-1.5 text-xs font-medium" title={p.title}>{p.title}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Page de sélection ─────────────────────────────────────────────────── */

export function HomeFeaturedSelectPage({ group }: { group: FeaturedGroup }) {
  const cfg = GROUP[group];
  const [products, setProducts] = React.useState<CommerceProduct[] | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    api.commerceProducts()
      .then((list) => {
        const own = (list as CommerceProduct[]).filter((p) => (cfg.kinds as readonly string[]).includes(p.kind));
        setProducts(own);
        setSelected(featuredOf(own).map((p) => p._id));
      })
      .catch((err) => setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Chargement impossible' }));
  }, [cfg.kinds]);

  const byId = new Map((products || []).map((p) => [p._id, p]));
  const candidates = (products || []).filter((p) => p.status === 'PUBLISHED' && !selected.includes(p._id) && matchesSearch(p, query));

  async function persist(next: string[], text: string) {
    const previous = selected;
    setSelected(next);
    setSaving(true);
    setMessage(null);
    try {
      await api.setHomeFeatured(group, next);
      setMessage({ tone: 'ok', text });
    } catch (err) {
      setSelected(previous);
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Enregistrement impossible' });
    } finally {
      setSaving(false);
    }
  }
  const move = (index: number, delta: number) => {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    void persist(next, 'Ordre mis à jour.');
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-6" data-testid="featured-select">
      <div>
        <Link to={cfg.listPath} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted" data-testid="featured-back">
          <ArrowLeft className="h-4 w-4" /> {cfg.back}
        </Link>
        <h1 className="mt-4 inline-flex items-center gap-2 text-2xl font-semibold tracking-tight"><Sparkles className="h-5 w-5 text-rose-600" /> Mise en avant des {cfg.plural}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Les {cfg.plural} choisies s'affichent sur la page d'accueil de la vitrine, dans l'ordre ci-dessous. Chaque changement est enregistré immédiatement.
        </p>
      </div>

      {products === null && !message && (
        <div className="grid gap-6" data-testid="featured-select-skeleton">
          <span role="status" className="sr-only">Chargement…</span>
          <section className="grid gap-3">
            <Skeleton className="h-6 w-64 max-w-full" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex overflow-hidden rounded-xl border">
                  <Skeleton className="min-h-[7rem] w-28 shrink-0 rounded-none" />
                  <div className="grid flex-1 content-start gap-2 p-3">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="mt-4 h-8 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="grid gap-3 border-t pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Skeleton className="h-6 w-72 max-w-full" />
              <Skeleton className="h-10 w-full sm:w-64" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex flex-col overflow-hidden rounded-xl border">
                  <Skeleton className="aspect-[4/3] w-full rounded-none" />
                  <div className="grid gap-2 p-3">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="mt-2 h-9 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {products && (
        <>
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Actuellement sur l'accueil <span className="font-normal text-muted-foreground">({selected.length})</span></h2>
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {selected.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Aucune {cfg.plural.slice(0, -1)} choisie : l'accueil affiche les trois premières du catalogue.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="featured-selected">
                {selected.map((id, index) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  return (
                    <article key={id} className="flex overflow-hidden rounded-xl border border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20" data-testid="featured-selected-card">
                      <div className="relative w-28 shrink-0">
                        <Cover product={p} className="h-full min-h-[7rem]" />
                        <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-rose-600 text-xs font-bold text-white">{index + 1}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-semibold">{p.title}</p>
                          <p className="text-xs text-muted-foreground">{KIND_LABEL[p.kind]} · {cents(p.price?.amountCents)}</p>
                        </div>
                        <div className="mt-auto flex items-center gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Monter" disabled={index === 0 || saving} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Descendre" disabled={index === selected.length - 1 || saving} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void persist(selected.filter((x) => x !== id), `« ${p.title} » retirée de l'accueil.`)}
                            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:bg-transparent dark:text-rose-200"
                            data-testid="featured-remove"
                          >
                            <Minus className="h-3.5 w-3.5" /> Retirer
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 border-t pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold">Choisir lesquelles mettre en avant</h2>
              <SearchInput value={query} onChange={setQuery} placeholder={`Rechercher une ${cfg.plural.slice(0, -1)}…`} testId="featured-search" />
            </div>
            <p className="text-xs text-muted-foreground">Seules les {cfg.plural} publiées peuvent être mises en avant.</p>
            {candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {query ? 'Aucun résultat pour cette recherche.' : `Toutes les ${cfg.plural} publiées sont déjà sur l'accueil.`}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="featured-candidates">
                {candidates.map((p) => (
                  <article key={p._id} className="flex flex-col overflow-hidden rounded-xl border bg-card" data-testid="featured-candidate">
                    <Cover product={p} className="aspect-[4/3] w-full" />
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{KIND_LABEL[p.kind]} · {cents(p.price?.amountCents)}</p>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void persist([...selected, p._id], `« ${p.title} » ajoutée à l'accueil.`)}
                        className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        data-testid="featured-choose"
                      >
                        <Plus className="h-4 w-4" /> Choisir
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {message && (
        <p
          role="status"
          className={`fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${message.tone === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}
          data-testid="featured-message"
        >
          {message.tone === 'ok' && <Check className="h-4 w-4" />} {message.text}
        </p>
      )}
    </div>
  );
}
