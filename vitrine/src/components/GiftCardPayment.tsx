import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Gift, Loader2, Plus, Wallet, X } from 'lucide-react';
import { customerApi, type WalletGiftCard } from '@/lib/api';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const formatEuro = (cents: number) => euro.format((cents || 0) / 100);

/** Une carte appliquée : son code, et ce qu'elle a de disponible. */
export type AppliedGiftCard = { code: string; codeMasked: string; availableCents: number };

/**
 * LA RÉPARTITION — chaque carte paie ce qu'elle peut, dans l'ordre où elle a
 * été ajoutée ; le reste part sur la carte bancaire. Calcul local : il suit le
 * total sans nouvel appel quand le panier change.
 */
export function splitPayment(totalCents: number, cards: AppliedGiftCard[]) {
  let remaining = Math.max(0, totalCents);
  const lines = cards.map((card) => {
    const debitCents = Math.min(card.availableCents, remaining);
    remaining -= debitCents;
    return { ...card, debitCents, leftOnCardCents: card.availableCents - debitCents };
  });
  return { lines, giftCents: totalCents - remaining, toPayCents: remaining };
}

/**
 * RÉGLER AVEC UNE CARTE CADEAU — saisir un code ou choisir une carte du
 * portefeuille ; chaque carte montre ce qu'elle débite et ce qu'il lui
 * restera. Les messages sont ceux qu'une cliente comprend, jamais un code
 * d'erreur.
 */
export function GiftCardPayment({ totalCents, cards, onChange }: {
  totalCents: number;
  cards: AppliedGiftCard[];
  onChange: (cards: AppliedGiftCard[]) => void;
}) {
  const [open, setOpen] = React.useState(cards.length > 0);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [wallet, setWallet] = React.useState<WalletGiftCard[]>([]);
  const split = splitPayment(totalCents, cards);

  React.useEffect(() => {
    customerApi.giftCards().then((list) => setWallet(list.filter((c) => c.status === 'ACTIVE' && c.code && c.availableCents > 0))).catch(() => null);
  }, []);
  React.useEffect(() => { if (cards.length) setOpen(true); }, [cards.length]);

  const usable = wallet.filter((w) => !cards.some((c) => c.code === w.code));
  const covered = split.toPayCents === 0 && totalCents > 0;

  async function apply(raw: string) {
    const value = raw.trim();
    if (!value) { setError('Saisissez le code inscrit sur votre carte cadeau.'); return; }
    if (covered) { setError('Votre commande est déjà entièrement réglée par carte cadeau.'); return; }
    setBusy(value);
    setError('');
    try {
      const result = await customerApi.checkGiftCard(value, split.toPayCents);
      if (cards.some((c) => c.code === result.code)) { setError('Cette carte est déjà appliquée.'); return; }
      onChange([...cards, { code: result.code, codeMasked: result.codeMasked, availableCents: result.availableCents }]);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cette carte ne peut pas être utilisée pour le moment.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3" data-testid="gift-card-payment">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 self-start text-sm font-semibold underline-offset-4 hover:underline" data-testid="gift-open">
          <Gift className="h-4 w-4" style={{ color: 'var(--v-accent)' }} /> J’ai une carte cadeau
        </button>
      ) : (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="grid gap-3 overflow-hidden">
          <p className="flex items-center gap-2 text-sm font-semibold"><Gift className="h-4 w-4" style={{ color: 'var(--v-accent)' }} /> Carte cadeau</p>

          <AnimatePresence initial={false}>
            {split.lines.map((line) => (
              <motion.div
                key={line.code}
                layout
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24 }}
                className="flex items-center gap-3 rounded-xl border p-3"
                style={{ borderColor: 'color-mix(in srgb, var(--v-accent) 45%, var(--v-border))', background: 'color-mix(in srgb, var(--v-accent) 9%, var(--v-surface))' }}
                data-testid="gift-applied"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'var(--v-accent)', color: 'var(--v-accent-foreground, #fff)' }}>
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs tracking-wider" style={{ color: 'var(--v-muted-foreground)' }}>{line.codeMasked}</span>
                  <span className="block text-sm font-semibold" data-testid="gift-debit">
                    {line.debitCents > 0 ? `${formatEuro(line.debitCents)} utilisés sur cette carte` : 'Pas utilisée : la commande est déjà réglée'}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--v-muted-foreground)' }} data-testid="gift-left">
                    {line.leftOnCardCents > 0 ? `Il vous restera ${formatEuro(line.leftOnCardCents)} sur la carte` : 'La carte sera entièrement utilisée'}
                  </span>
                </span>
                <button type="button" onClick={() => onChange(cards.filter((c) => c.code !== line.code))} aria-label="Retirer cette carte" className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-black/5">
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {!covered && (
            <>
              {usable.length > 0 && (
                <div className="grid gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--v-muted-foreground)' }}><Wallet className="h-3.5 w-3.5" /> Mes cartes cadeaux</p>
                  <div className="flex flex-wrap gap-2">
                    {usable.map((w) => (
                      <button key={w.id} type="button" disabled={Boolean(busy)} onClick={() => apply(w.code || '')}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:opacity-60"
                        style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="gift-wallet-chip">
                        {busy === w.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        {w.codeMasked} · {formatEuro(w.availableCents)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void apply(code); }}>
                <motion.input
                  animate={error ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                  transition={{ duration: 0.35 }}
                  className="v-field min-w-0 flex-1 rounded-md px-3 py-3 font-mono uppercase tracking-wider"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setError(''); }}
                  placeholder="BS-XXXXXX-XXXXXX"
                  aria-label="Code de la carte cadeau"
                  autoComplete="off"
                  data-testid="gift-code-input"
                />
                <button type="submit" disabled={Boolean(busy)} className="inline-flex min-w-[96px] items-center justify-center gap-2 rounded-md border-2 px-4 text-sm font-semibold disabled:opacity-60"
                  style={{ borderColor: 'var(--v-primary)' }} data-testid="gift-apply">
                  {busy && busy === code.trim() ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Appliquer'}
                </button>
              </form>
            </>
          )}
          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm" style={{ color: '#b91c1c' }} role="alert" data-testid="gift-error">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

/** Le récapitulatif : total, part des cartes cadeaux, et ce qu'il reste à payer. */
export function PaymentSummary({ totalCents, cards }: { totalCents: number; cards: AppliedGiftCard[] }) {
  const split = splitPayment(totalCents, cards);
  return (
    <div className="grid gap-2 text-sm" data-testid="payment-summary">
      <div className="flex justify-between"><span style={{ color: 'var(--v-muted-foreground)' }}>Total</span><span className="font-semibold tabular-nums">{formatEuro(totalCents)}</span></div>
      <AnimatePresence initial={false}>
        {split.giftCents > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex justify-between overflow-hidden" style={{ color: 'var(--v-accent)' }}>
            <span>Carte cadeau</span><span className="font-semibold tabular-nums" data-testid="summary-gift">− {formatEuro(split.giftCents)}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-1 flex items-end justify-between border-t pt-3" style={{ borderColor: 'var(--v-border)' }}>
        <span className="font-semibold">Reste à payer</span>
        <motion.span key={split.toPayCents} initial={{ scale: 1.12, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="text-2xl font-semibold tabular-nums" data-testid="summary-to-pay">
          {formatEuro(split.toPayCents)}
        </motion.span>
      </div>
      {split.toPayCents === 0 && totalCents > 0 && (
        <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Votre carte cadeau règle toute la commande : aucun paiement par carte bancaire.</p>
      )}
    </div>
  );
}
