import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, Download, Gift, Loader2, Plus } from 'lucide-react';
import { customerApi, type WalletGiftCard } from '@/lib/api';
import { formatEuro } from '@/components/GiftCardPayment';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const STATUS: Record<WalletGiftCard['status'], string> = {
  ACTIVE: 'Utilisable',
  EMPTY: 'Entièrement utilisée',
  VOID: 'Annulée',
  EXPIRED: 'Expirée',
};
const ORIGIN: Record<WalletGiftCard['origin'], string> = { BOUGHT: 'Achetée par vous', RECEIVED: 'Reçue', ADDED: 'Ajoutée' };

/**
 * MES CARTES CADEAUX — chaque carte avec son code (copiable), son solde, ce
 * qui a déjà été utilisé, et son PDF. Une carte reçue sur papier s'ajoute en
 * saisissant son code.
 */
export function GiftCardWallet() {
  const [cards, setCards] = React.useState<WalletGiftCard[] | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => { customerApi.giftCards().then(setCards).catch(() => setCards([])); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError('Saisissez le code inscrit sur la carte.'); return; }
    setBusy(true); setError('');
    try { setCards(await customerApi.addGiftCardToWallet(code)); setCode(''); setAdding(false); }
    catch (err) { setError(err instanceof Error ? err.message : 'Cette carte ne peut pas être ajoutée.'); }
    finally { setBusy(false); }
  }

  const usable = (cards ?? []).filter((c) => c.status === 'ACTIVE' && c.balanceCents > 0);
  const totalAvailable = usable.reduce((s, c) => s + c.balanceCents, 0);

  return (
    <section id="cartes-cadeaux" className="rounded-lg border p-5 lg:col-span-3" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="gift-wallet">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Gift className="h-5 w-5" style={{ color: 'var(--v-accent)' }} /> Mes cartes cadeaux</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
            {usable.length ? `${formatEuro(totalAvailable)} à utiliser sur ${usable.length} carte${usable.length > 1 ? 's' : ''}.` : 'Utilisez le code d’une carte au moment de payer.'}
          </p>
        </div>
        <button type="button" onClick={() => { setAdding((v) => !v); setError(''); }} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }} data-testid="wallet-add-open">
          <Plus className="h-4 w-4" /> Ajouter une carte
        </button>
      </div>

      <AnimatePresence>
        {adding && (
          <motion.form onSubmit={add} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 grid gap-2 overflow-hidden">
            <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>On vous a offert une carte ? Saisissez son code pour la retrouver ici.</p>
            <div className="flex gap-2">
              <input className="v-field min-w-0 flex-1 rounded-md px-3 py-3 font-mono uppercase tracking-wider" value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} placeholder="BS-XXXXXX-XXXXXX" autoComplete="off" data-testid="wallet-code" />
              <button disabled={busy} className="inline-flex min-w-[96px] items-center justify-center rounded-md px-4 text-sm font-semibold disabled:opacity-60" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="wallet-add">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ajouter'}
              </button>
            </div>
            {error && <p className="text-sm" style={{ color: '#b91c1c' }} role="alert">{error}</p>}
          </motion.form>
        )}
      </AnimatePresence>

      {cards === null ? (
        <div className="mt-5 h-40 animate-pulse rounded-2xl" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 10%, transparent)' }} />
      ) : cards.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed p-5 text-center text-sm" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }}>Aucune carte cadeau pour le moment.</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card, i) => <WalletCard key={card.id} card={card} index={i} />)}
        </div>
      )}
    </section>
  );
}

function WalletCard({ card, index }: { card: WalletGiftCard; index: number }) {
  const [copied, setCopied] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const active = card.status === 'ACTIVE' && card.balanceCents > 0;
  const ratio = card.initialAmountCents ? Math.max(0, Math.min(1, card.balanceCents / card.initialAmountCents)) : 0;

  async function copy() {
    if (!card.code) return;
    try { await navigator.clipboard.writeText(card.code); } catch { /* presse-papiers refusé : le code reste lisible */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} className="grid gap-3" data-testid="wallet-card" data-status={card.status}>
      <div className="relative overflow-hidden rounded-2xl p-5 shadow-sm"
        style={{
          background: active
            ? 'linear-gradient(135deg, var(--v-primary), color-mix(in srgb, var(--v-accent) 70%, var(--v-primary)))'
            : 'linear-gradient(135deg, color-mix(in srgb, var(--v-muted-foreground) 40%, var(--v-surface)), color-mix(in srgb, var(--v-muted-foreground) 20%, var(--v-surface)))',
          color: active ? 'var(--v-primary-foreground)' : 'var(--v-foreground)',
        }}>
        <span className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20" style={{ background: 'currentColor' }} />
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">Carte cadeau</span>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur" data-testid="wallet-status">{STATUS[card.status]}</span>
        </div>
        <p className="mt-5 text-3xl font-semibold tabular-nums" data-testid="wallet-balance">{formatEuro(card.balanceCents)}</p>
        <p className="text-xs opacity-80">sur {formatEuro(card.initialAmountCents)}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
          <motion.div className="h-full rounded-full bg-white/90" initial={{ width: 0 }} animate={{ width: `${ratio * 100}%` }} transition={{ duration: 0.8, delay: 0.2 + index * 0.06 }} />
        </div>
        <button type="button" onClick={copy} disabled={!card.code} className="mt-4 flex w-full items-center justify-between gap-2 rounded-lg bg-black/15 px-3 py-2 text-left transition hover:bg-black/25 disabled:cursor-default" data-testid="wallet-code-copy">
          <span className="font-mono text-sm tracking-wider" data-testid="wallet-code-value">{card.code || card.codeMasked}</span>
          {card.code && (copied ? <span className="inline-flex items-center gap-1 text-xs font-semibold"><Check className="h-3.5 w-3.5" /> Copié</span> : <Copy className="h-4 w-4 opacity-80" />)}
        </button>
        {!card.code && <p className="mt-1.5 text-[11px] opacity-80">Le code complet figure sur le PDF de la carte.</p>}
      </div>

      <div className="grid gap-1 px-1 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
        <p>{ORIGIN[card.origin]} le {dateFmt.format(new Date(card.createdAt))}{card.recipientName ? ` · pour ${card.recipientName}` : ''}{card.origin === 'RECEIVED' && card.senderName ? ` · de la part de ${card.senderName}` : ''}</p>
        <div className="flex flex-wrap gap-3">
          {card.pdfUrl && <a href={card.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--v-foreground)' }}><Download className="h-3.5 w-3.5" /> PDF</a>}
          {card.usage.length > 0 && (
            <button type="button" onClick={() => setHistory((v) => !v)} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--v-foreground)' }}>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${history ? 'rotate-180' : ''}`} /> Utilisations ({card.usage.length})
            </button>
          )}
        </div>
        <AnimatePresence>
          {history && (
            <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid gap-1 overflow-hidden pt-1">
              {card.usage.map((u, i) => (
                <li key={i} className="flex justify-between gap-2"><span>{dateFmt.format(new Date(u.at))}{u.reason ? ` · ${u.reason}` : ''}</span><span className="font-semibold tabular-nums">− {formatEuro(u.amountCents)}</span></li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}
