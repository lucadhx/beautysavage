import { ArrowDown, ArrowUp, Info, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Company } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Button, Input } from '@/components/ui/primitives';
import { CommercePageFrame } from './CommerceShared';

/**
 * MENTIONS DE RÉSERVATION — ce que chaque cliente doit savoir AVANT de payer :
 * « Plus de 10 min de retard : rendez-vous annulé sans remboursement »,
 * « Paiement par carte bancaire uniquement »…
 *
 * Saisies UNE fois ici, pas fiche par fiche : elles s'affichent dans la
 * fenêtre de réservation de TOUTES les prestations et formations en
 * présentiel, avec l'adresse de l'institut. Elles vivent sur la fiche de
 * l'institut (`Company.bookingNotices`), comme son adresse.
 */
const MAX = 8;
const SUGGESTIONS = [
  'Plus de 10 min de retard : rendez-vous annulé sans remboursement.',
  'Paiement par carte bancaire uniquement.',
  'Merci d’arriver 5 minutes avant votre rendez-vous.',
  'Annulation gratuite jusqu’à 48 h avant le rendez-vous.',
];

export default function BookingNoticesPage() {
  const { data, loading, setData } = useResource(() => api.getCompany());
  const { run } = useAction();
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    const clean = { ...data, bookingNotices: (data.bookingNotices || []).map((n) => ({ ...n, text: n.text.trim() })).filter((n) => n.text) };
    const updated = await run(() => api.updateCompany(clean), { success: 'Mentions enregistrées' });
    setData(updated);
    return updated;
  });

  if (loading || !data) return <BrandLoader variant="form" />;

  const notices = data.bookingNotices || [];
  const set = (next: Company['bookingNotices']) => setData({ ...data, bookingNotices: next });
  const move = (i: number, delta: number) => {
    const next = [...notices];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    set(next);
  };
  const unused = SUGGESTIONS.filter((s) => !notices.some((n) => n.text.trim() === s));

  return (
    <CommercePageFrame
      title="Mentions de réservation"
      description="Les informations importantes que chaque cliente lit avant de payer, dans la fenêtre de réservation de toutes vos prestations et formations en présentiel. Elles se règlent une seule fois, ici."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3 rounded-xl border bg-card p-4 sm:p-5" data-testid="booking-notices-editor">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Vos mentions <span className="text-sm font-normal text-muted-foreground">({notices.length}/{MAX})</span></h2>
            <Button type="button" variant="outline" disabled={notices.length >= MAX} onClick={() => set([...notices, { text: '' }])} data-testid="booking-notice-add">
              <Plus className="h-4 w-4" /> Mention
            </Button>
          </div>
          {notices.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucune mention : la fenêtre de réservation n'affiche que l'adresse de l'institut.</p>}
          <ol className="grid gap-2">
            {notices.map((n, i) => (
              <li key={n._id || `new-${i}`} className="flex items-center gap-2" data-testid="booking-notice-row">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">{i + 1}</span>
                <Input value={n.text} maxLength={240} onChange={(e) => set(notices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="Ex. Paiement par carte bancaire uniquement." aria-label={`Mention ${i + 1}`} />
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border disabled:opacity-30" aria-label="Monter"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={i === notices.length - 1} onClick={() => move(i, 1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border disabled:opacity-30" aria-label="Descendre"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => set(notices.filter((_, j) => j !== i))} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700" aria-label={`Supprimer la mention ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
          {unused.length > 0 && notices.length < MAX && (
            <div className="grid gap-2 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Idées, à ajouter d'un clic puis à ajuster :</p>
              <div className="flex flex-wrap gap-2">
                {unused.map((s) => (
                  <button key={s} type="button" onClick={() => set([...notices, { text: s }])} className="rounded-full border px-3 py-1.5 text-left text-xs hover:bg-muted" data-testid="booking-notice-suggestion">+ {s}</button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="grid content-start gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aperçu dans la fenêtre de réservation</p>
          <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 text-sm">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800"><Info className="h-3.5 w-3.5" /> À savoir avant de réserver</p>
            <ul className="mt-2 grid gap-1.5 leading-6">
              {notices.filter((n) => n.text.trim()).map((n, i) => (
                <li key={i} className="flex gap-2"><span aria-hidden className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" /><span className="min-w-0">{n.text}</span></li>
              ))}
              {!notices.some((n) => n.text.trim()) && <li className="text-muted-foreground">Vos mentions s'afficheront ici.</li>}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">L'adresse de l'institut (Entreprise → Informations) s'affiche sous les mentions, avec le lien Google Maps.</p>
        </aside>
      </div>
      <FloatingSaveWidget state={state} onSave={save} />
    </CommercePageFrame>
  );
}
