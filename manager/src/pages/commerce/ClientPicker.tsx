import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { SearchInput } from './HomeFeaturedPanel';

export interface PickedClient {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
}

type SortKey = 'recent' | 'name' | 'name-desc' | 'oldest';

export const clientName = (c: PickedClient) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Client';
const initials = (c: PickedClient) => (clientName(c).split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * CHOISIR UN CLIENT — l'écran qui glisse à la place du formulaire de
 * réservation : recherche, tri, la liste des clients (contenu fantôme tant
 * qu'elle charge). Toucher un client le coche ; « Valider » le rapporte au
 * formulaire, « Retour » y revient sans rien changer.
 */
export function ClientPicker({ onBack, onPick, currentEmail }: {
  onBack: () => void;
  onPick: (client: PickedClient) => void;
  currentEmail?: string;
}) {
  const [clients, setClients] = React.useState<PickedClient[] | null>(null);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('recent');
  const [selected, setSelected] = React.useState<PickedClient | null>(null);
  const root = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    root.current?.scrollIntoView({ block: 'start' });
    let alive = true;
    api.commerceCustomers()
      .then((list) => {
        if (!alive) return;
        const rows = list as PickedClient[];
        setClients(rows);
        if (currentEmail) setSelected(rows.find((c) => norm(c.email || '') === norm(currentEmail)) || null);
      })
      .catch((err) => { if (alive) { setError(err instanceof Error ? err.message : 'Chargement impossible'); setClients([]); } });
    return () => { alive = false; };
  }, [currentEmail]);

  const shown = React.useMemo(() => {
    const words = norm(query).trim().split(/\s+/).filter(Boolean);
    const list = (clients || []).filter((c) => {
      const hay = norm(`${clientName(c)} ${c.email || ''} ${c.phone || ''}`);
      return words.every((w) => hay.includes(w));
    });
    const byName = (a: PickedClient, b: PickedClient) => clientName(a).localeCompare(clientName(b), 'fr', { sensitivity: 'base' });
    const byDate = (a: PickedClient, b: PickedClient) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    return [...list].sort(sort === 'name' ? byName : sort === 'name-desc' ? (a, b) => byName(b, a) : sort === 'oldest' ? byDate : (a, b) => byDate(b, a));
  }, [clients, query, sort]);

  return (
    <div ref={root} className="grid grid-cols-[minmax(0,1fr)] gap-4" data-testid="client-picker">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold hover:bg-muted" data-testid="client-picker-back-top">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
        <div className="min-w-0">
          <p className="font-semibold">Choisir un client</p>
          <p className="truncate text-xs text-muted-foreground">{clients === null ? 'Chargement…' : `${clients.length} client${clients.length > 1 ? 's' : ''} enregistré${clients.length > 1 ? 's' : ''}`}</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
        <SearchInput value={query} onChange={setQuery} placeholder="Nom, e-mail ou téléphone…" testId="client-search" />
        <CustomSelect
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          ariaLabel="Trier les clients"
          options={[
            { value: 'recent', label: 'Plus récents', description: 'Dernières inscriptions d’abord' },
            { value: 'oldest', label: 'Plus anciens', description: 'Premières inscriptions d’abord' },
            { value: 'name', label: 'Nom, de A à Z' },
            { value: 'name-desc', label: 'Nom, de Z à A' },
          ]}
        />
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-2" data-testid="client-list">
        {clients === null ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border p-3" data-testid="client-skeleton">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-3/5" /></div>
            </div>
          ))
        ) : shown.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Users className="h-6 w-6" />
            {query ? 'Aucun client ne correspond à cette recherche.' : 'Aucun client enregistré pour le moment.'}
          </div>
        ) : (
          shown.map((c) => {
            const active = selected?._id === c._id;
            return (
              <motion.button
                key={c._id}
                type="button"
                layout="position"
                onClick={() => setSelected(active ? null : c)}
                whileTap={{ scale: 0.985 }}
                aria-pressed={active}
                data-testid="client-row"
                className={cn(
                  'flex min-h-[64px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  active ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30 dark:bg-emerald-950/30' : 'bg-card hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <span className={cn('relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors', active ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground')}>
                  <AnimatePresence mode="wait" initial={false}>
                    {active ? (
                      <motion.span key="check" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                        <Check className="h-5 w-5" strokeWidth={3} />
                      </motion.span>
                    ) : (
                      <motion.span key="ini" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                        {initials(c)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{clientName(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(' · ') || 'Sans coordonnées'}</span>
                </span>
              </motion.button>
            );
          })
        )}
      </div>

      {/* Les deux boutons apparaissent une fois un client coché. */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="sticky -bottom-5 z-10 -mx-5 grid gap-2 border-t bg-card/95 px-5 py-3 backdrop-blur"
            data-testid="client-picker-actions"
          >
            <p className="flex min-w-0 items-center gap-2 text-sm"><UserRound className="h-4 w-4 shrink-0 text-emerald-600" /><span className="truncate"><span className="font-semibold">{clientName(selected)}</span>{selected.email ? ` · ${selected.email}` : ''}</span></p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button type="button" onClick={onBack} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-5 text-sm font-semibold hover:bg-muted" data-testid="client-picker-back">
                <ArrowLeft className="h-4 w-4" /> Retour
              </button>
              <button type="button" onClick={() => onPick(selected)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm" data-testid="client-picker-confirm">
                <Check className="h-4 w-4" /> Valider
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
