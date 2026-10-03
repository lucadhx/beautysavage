import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock, FileText, Gift, Loader2, XCircle } from 'lucide-react';
import { customerApi, customerTokenStore, type CheckoutStatus } from '@/lib/api';
import { useSiteData } from '@/context/SiteDataContext';
import { resolvePreviewMediaUrl } from '@/lib/media';

type State = 'CHECKING' | 'PAID' | 'PROCESSING' | 'FAILED' | 'EXPIRED' | 'SLOW' | 'NO_SESSION' | 'NEED_LOGIN';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const POLL_MS = 2000;
const MAX_WAIT_MS = 90_000;

/**
 * RETOUR DE PAIEMENT — la cliente ne lit « confirmé » que lorsque la vente
 * est RÉELLEMENT enregistrée chez nous.
 *
 * La page interroge le serveur (`/customer/checkout/status`), qui demande
 * lui-même à Stripe et finalise la vente si le webhook n'est pas encore
 * arrivé. Une commande réglée entièrement par carte cadeau n'a pas de session
 * Stripe : elle se retrouve par son numéro (`?commande=`).
 *
 * Pendant la vérification, le logo de la maison attend en gris ; il prend ses
 * couleurs quand le paiement est confirmé.
 */
export default function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') || '';
  const saleNumber = params.get('commande') || '';
  const [state, setState] = React.useState<State>(sessionId || saleNumber ? 'CHECKING' : 'NO_SESSION');
  const [order, setOrder] = React.useState<CheckoutStatus | null>(null);

  React.useEffect(() => {
    if (!sessionId && !saleNumber) return undefined;
    // Sans session cliente sur ce site, le serveur ne dira rien : on le dit tout de suite.
    if (!customerTokenStore.get()) { setState('NEED_LOGIN'); return undefined; }
    let alive = true;
    let timer = 0;
    const started = Date.now();
    const tick = async () => {
      try {
        const status = await customerApi.checkoutStatus(sessionId, saleNumber);
        if (!alive) return;
        setOrder(status);
        if (status.state === 'PAID') {
          setState('PAID');
          // La facture Stripe est émise quelques secondes après le paiement : on la guette encore un peu.
          const waitingInvoice = !status.invoiceUrl && (status.cardAmountCents ?? status.totalCents) > 0 && Date.now() - started < 30_000;
          if (waitingInvoice && alive) timer = window.setTimeout(tick, POLL_MS);
          return;
        }
        if (status.state === 'FAILED' || status.state === 'EXPIRED') { setState(status.state); return; }
        if (status.state === 'PROCESSING') { setState('PROCESSING'); return; }
      } catch (err) {
        // Session cliente expirée : inutile d'attendre, la commande est dans l'espace client.
        if (/session client/i.test(err instanceof Error ? err.message : '')) { if (alive) setState('NEED_LOGIN'); return; }
        // Réseau : on réessaie jusqu'au plafond.
      }
      if (!alive) return;
      if (Date.now() - started > MAX_WAIT_MS) { setState('SLOW'); return; }
      timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [sessionId, saleNumber]);

  const view = {
    CHECKING: { title: 'Confirmation de votre paiement…', text: 'Nous vérifions votre paiement. Ne fermez pas cette page, cela ne prend que quelques secondes.' },
    PAID: { title: 'Merci, c’est confirmé !', text: 'Votre commande est enregistrée. Un e-mail de confirmation est en route ; vos rendez-vous, formations, cartes cadeaux et factures sont dans votre espace client.' },
    PROCESSING: { title: 'Paiement en cours de traitement', text: 'Votre moyen de paiement demande un délai. Votre commande est enregistrée et sera confirmée par e-mail dès réception du paiement.' },
    FAILED: { title: 'Le paiement n’a pas abouti', text: 'Aucun montant n’a été débité. Vous pouvez réessayer depuis la fiche ou votre panier.' },
    EXPIRED: { title: 'La page de paiement a expiré', text: 'Aucun montant n’a été débité. Vous pouvez relancer votre commande.' },
    SLOW: { title: 'Confirmation plus longue que prévu', text: 'Si votre paiement a été accepté, votre commande est enregistrée automatiquement et vous recevrez un e-mail. Vous la retrouverez aussi dans votre espace client.' },
    NO_SESSION: { title: 'Merci pour votre commande', text: 'Retrouvez-la, avec sa facture, dans votre espace client.' },
    NEED_LOGIN: { title: 'Merci pour votre commande', text: 'Connectez-vous à votre espace client pour voir sa confirmation et sa facture. Si votre paiement a été accepté, la commande est enregistrée et un e-mail de confirmation vous est envoyé.' },
  }[state];

  const gift = order?.giftCardAmountCents || 0;
  const card = order ? (order.cardAmountCents ?? order.totalCents) : 0;

  return (
    <section className="mx-auto grid min-h-screen max-w-2xl content-start px-5 pb-24 pt-32 md:px-8">
      <div className="rounded-2xl border p-6 text-center sm:p-8" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }} data-testid="payment-result" data-state={state} aria-live="polite">
        <BrandMark state={state} />
        <motion.h1 key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 text-3xl font-semibold">{view.title}</motion.h1>
        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>{view.text}</p>

        {order && state === 'PAID' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mx-auto mt-6 grid max-w-sm gap-2 rounded-xl border p-4 text-left text-sm" style={{ borderColor: 'var(--v-border)' }} data-testid="payment-recap">
            <div className="flex justify-between"><span style={{ color: 'var(--v-muted-foreground)' }}>Commande</span><span className="font-semibold">{order.saleNumber}</span></div>
            <div className="flex justify-between"><span style={{ color: 'var(--v-muted-foreground)' }}>Total</span><span className="font-semibold tabular-nums">{formatter.format(order.totalCents / 100)}</span></div>
            {gift > 0 && (order.giftCards?.length ? order.giftCards : [{ codeMasked: '', amountCents: gift }]).map((g, i) => (
              <div key={i} className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-start gap-1.5">
                  <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v-accent)' }} />
                  <span className="min-w-0">
                    <span className="block">Carte cadeau</span>
                    {g.codeMasked && <span className="block font-mono text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{g.codeMasked}</span>}
                  </span>
                </span>
                <span className="whitespace-nowrap font-semibold tabular-nums">− {formatter.format(g.amountCents / 100)}</span>
              </div>
            ))}
            {(order.balanceDueCents ?? 0) > 0 && (
              <div className="flex justify-between font-medium" data-testid="payment-balance">
                <span>À régler sur place</span>
                <span className="tabular-nums">{formatter.format((order.balanceDueCents ?? 0) / 100)}</span>
              </div>
            )}
            {gift > 0 && (
              <div className="flex justify-between border-t pt-2" style={{ borderColor: 'var(--v-border)' }}>
                <span style={{ color: 'var(--v-muted-foreground)' }}>Payé par carte bancaire</span>
                <span className="font-semibold tabular-nums">{formatter.format(card / 100)}</span>
              </div>
            )}
          </motion.div>
        )}

        {state !== 'CHECKING' && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {state === 'PAID' && order?.invoiceUrl && (
              <a href={order.invoiceUrl} target="_blank" rel="noreferrer" data-testid="payment-invoice" className="inline-flex items-center gap-2 rounded-md border px-5 py-3 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>
                <FileText className="h-4 w-4" /> Ma facture
              </a>
            )}
            {state === 'PAID' && order && !order.invoiceUrl && (order.cardAmountCents ?? order.totalCents) > 0 && (
              <span className="inline-flex items-center gap-2 rounded-md border px-5 py-3 text-sm" style={{ borderColor: 'var(--v-border)', color: 'var(--v-muted-foreground)' }} data-testid="payment-invoice-pending">
                <Loader2 className="h-4 w-4 animate-spin" /> Facture en cours d’émission
              </span>
            )}
            <Link to="/espace-client" className="rounded-md px-5 py-3 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
              Mon espace client
            </Link>
            <Link to="/" className="rounded-md border px-5 py-3 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>
              Retour à l'accueil
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * LE LOGO DE LA MAISON — gris et respirant pendant la vérification, il se
 * colore d'un coup quand le paiement est confirmé, entouré d'une onde. Sans
 * logo configuré, une coche colorée prend sa place.
 */
function BrandMark({ state }: { state: State }) {
  const { data } = useSiteData();
  const logo = resolvePreviewMediaUrl(data?.company?.logos?.header, data?.network?.backendUrl);
  const [failed, setFailed] = React.useState(false);
  const paid = state === 'PAID' || state === 'NO_SESSION';
  const bad = state === 'FAILED' || state === 'EXPIRED';

  if (bad) return <XCircle className="mx-auto h-14 w-14" style={{ color: '#b91c1c' }} />;
  if (state === 'PROCESSING') return <Clock className="mx-auto h-14 w-14" style={{ color: 'var(--v-accent)' }} />;
  if (state === 'SLOW' || state === 'NEED_LOGIN') return <AlertTriangle className="mx-auto h-14 w-14" style={{ color: 'var(--v-accent)' }} />;

  return (
    <div className="relative mx-auto grid h-28 w-28 place-items-center" data-testid="brand-mark" data-paid={paid || undefined}>
      {paid && [0, 1].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full" style={{ border: '2px solid var(--v-accent)' }}
          initial={{ scale: 0.7, opacity: 0.7 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 1.4, delay: 0.15 + i * 0.35, ease: 'easeOut' }} />
      ))}
      {logo && !failed ? (
        <motion.img
          src={logo}
          alt={data?.company?.name || ''}
          onError={() => setFailed(true)}
          className="relative max-h-24 max-w-[7rem] object-contain"
          data-testid="brand-logo"
          initial={false}
          animate={paid
            ? { filter: 'grayscale(0) brightness(1)', opacity: 1, scale: [1, 1.18, 1] }
            : { filter: 'grayscale(1) brightness(1.1)', opacity: [0.35, 0.7, 0.35], scale: 1 }}
          transition={paid ? { duration: 0.7, ease: 'easeOut' } : { duration: 1.6, repeat: Infinity }}
        />
      ) : (
        <motion.span initial={false} animate={paid ? { scale: [0.6, 1.15, 1], opacity: 1 } : { scale: 1, opacity: [0.35, 0.7, 0.35] }}
          transition={paid ? { duration: 0.6 } : { duration: 1.6, repeat: Infinity }}>
          <CheckCircle2 className="h-16 w-16" style={{ color: paid ? 'var(--v-accent)' : 'var(--v-muted-foreground)' }} />
        </motion.span>
      )}
    </div>
  );
}
