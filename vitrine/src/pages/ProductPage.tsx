import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CalendarDays, Check, CheckCircle2, Clock, CreditCard, ChevronDown, Gift, ImageIcon, Loader2, PawPrint, Play, ShoppingBag, X } from 'lucide-react';
import { QUICK_BUY_LINE_ID, commerceApi, customerApi, type CommerceProduct, type OrderLineInput } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { RichDescription } from '@/components/RichDescription';
import { durationText } from '@/components/CommerceProductCard';
import { PromoBadge, PromoPrice, PromotionCountdown } from '@/components/Promotion';
import { BookingMonthCalendar, type Slot } from '@/components/BookingMonthCalendar';
import { ProductOptions, optionsTotalCents } from '@/components/ProductOptions';
import { AuthRequiredModal, type AuthAction } from '@/components/AuthRequiredModal';
import { paySplit } from '@/lib/paymentRule';
import { GiftCardPayment, PaymentSummary, splitPayment, type AppliedGiftCard } from '@/components/GiftCardPayment';
import { flyToCart, publishCartCount } from '@/lib/cartSignal';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Le visuel de carte cadeau — sans traits : le texte se pose sur la ligne de base des libellés. */
const GIFT_CARD_IMAGE = '/gift-card-master.jpg?v=2';

export default function ProductPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { customer } = useCustomer();
  /** Fenêtre de réservation / paiement ouverte. */
  const [bookingOpen, setBookingOpen] = React.useState(false);
  const [authPrompt, setAuthPrompt] = React.useState<{ action: AuthAction; unverified: boolean } | null>(null);
  const [product, setProduct] = React.useState<CommerceProduct | null>(null);
  const [reviews, setReviews] = React.useState<any[]>([]);
  const [trailerOpen, setTrailerOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [giftCard, setGiftCard] = React.useState({
    senderName: '',
    recipientName: '',
    message: '',
    amountEuros: '50',
  });

  const [reloadKey, setReloadKey] = React.useState(0);
  // Fin de la promotion pendant qu'on regarde la fiche : on relit le prix normal.
  const onPromoEnded = React.useCallback(() => window.setTimeout(() => setReloadKey((k) => k + 1), 1500), []);

  React.useEffect(() => {
    commerceApi.product(slug).then((item) => {
      setProduct(item);
      if (item.kind === 'GIFT_CARD') {
        const minimumEuros = Math.round(Math.max(0, Number(item.price?.amountCents || 0)) / 100);
        if (minimumEuros > 0) setGiftCard((current) => ({ ...current, amountEuros: String(minimumEuros) }));
      }
      commerceApi.reviews(item.id).then(setReviews).catch(() => setReviews([]));
    }).catch((err) => setMessage(err.message));
  }, [slug, reloadKey]);

  /** Peut-on commencer ? Compte connecté, e-mail vérifié, carte cadeau renseignée. */
  function canStart(action: AuthAction) {
    if (!product) return false;
    if (!customer || !customer.emailVerified) {
      // Une fenêtre qui explique et mène à la connexion, au lieu d'une ligne de texte discrète.
      setAuthPrompt({ action, unverified: Boolean(customer) });
      return false;
    }
    if (product.kind === 'GIFT_CARD' && (!giftCard.senderName.trim() || !giftCard.recipientName.trim())) {
      setMessage('Renseignez « De la part de » et « Pour » avant de continuer.');
      return false;
    }
    return true;
  }

  function giftCardLine(): OrderLineInput | null {
    if (!product || product.kind !== 'GIFT_CARD') return null;
    return {
      productId: product.id,
      quantity: 1,
      giftCard: {
        senderName: giftCard.senderName,
        recipientName: giftCard.recipientName,
        message: giftCard.message,
        amountCents: Math.round(Math.max(Math.round((product.price?.amountCents || 0) / 100), Number(giftCard.amountEuros || 0)) * 100),
      },
    };
  }

  /**
   * AJOUT DIRECT AU PANIER — prestation, formation en ligne, carte cadeau.
   * Rien à configurer ici : le créneau d'une prestation se choisit depuis le
   * panier. La vignette vole jusqu'à l'icône panier, qui compte un article de plus.
   */
  const [adding, setAdding] = React.useState(false);
  const [added, setAdded] = React.useState(false);
  async function addToCart(from?: HTMLElement | null) {
    if (!product || adding || !canStart('cart')) return;
    setAdding(true);
    setMessage('');
    try {
      const cart = await customerApi.addCartItem(giftCardLine() || { productId: product.id, quantity: 1 });
      const image = product.kind === 'GIFT_CARD' ? GIFT_CARD_IMAGE : resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
      void flyToCart(from || null, image || undefined).then(() => publishCartCount(cart.lines.length, true));
      setAdded(true);
      window.setTimeout(() => setAdded(false), 2600);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ajout au panier impossible');
    } finally {
      setAdding(false);
    }
  }

  function start(action?: AuthAction) {
    if (!canStart(action || (reservable ? 'reserve' : 'buy'))) return;
    setMessage('');
    setBookingOpen(true);
  }

  if (!product) {
    return <section className="min-h-screen px-5 pt-32">{message || 'Chargement...'}</section>;
  }

  const coverUrl = product.kind === 'GIFT_CARD'
    ? GIFT_CARD_IMAGE
    : resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
  const gallery = (product.gallery || []).map((url) => resolvePreviewMediaUrl(url)).filter(Boolean);
  /**
   * PRESTATION ET FORMATION PRÉSENTIELLE : on clique d'abord sur « Réserver »,
   * le calendrier s'ouvre, on choisit, PUIS on paie. Plus de créneau à
   * présélectionner sur la fiche avant même d'avoir décidé de réserver.
   */
  const reservable = product.kind === 'SERVICE' || product.kind === 'IN_PERSON_TRAINING';
  const trailerCode = streamableShortcode(product.trailer?.streamableShortcode || product.trailer?.sourceUrl || product.trailer?.url || '');
  const giftMinimumEuros = Math.round(Math.max(0, Number(product.price?.amountCents || 0)) / 100);
  const displayPrice = product.kind === 'GIFT_CARD'
    ? (giftMinimumEuros > 0 ? `À partir de ${formatter.format(giftMinimumEuros)}` : 'Montant libre')
    : formatter.format(product.price.amountCents / 100);


  /*
    AVIS ET FAQ — sans galerie, sur grand écran, ils montent juste sous la
    couverture (la colonne de gauche restait vide à côté de la fiche) ; sur
    petit écran, ils restent en bas, après la réservation.
  */
  const sideBlocks = !(product.kind === 'SERVICE' && gallery.length > 0);
  const faqBlock = (side: boolean) => ((product.faq?.length ?? 0) > 0 ? (
    <section className={side ? 'mt-4' : 'mt-14'} data-testid={side ? 'product-faq-side' : 'product-faq'}>
          <h2 className="text-2xl font-semibold">Questions fréquentes</h2>
          <div className="mt-5 grid gap-3">
            {product.faq!.map((item, index) => (
              <details
                key={`${item.question}-${index}`}
                className="group rounded-lg border p-4"
                style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.question}
                  <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" style={{ color: 'var(--v-accent)' }} />
                </summary>
                <p className="mt-3 whitespace-pre-line text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
  ) : null);
  const reviewsBlock = (side: boolean) => (
    <section className={side ? 'mt-4' : 'mt-14'} data-testid={side ? 'product-reviews-side' : 'product-reviews'}>
        <h2 className="text-2xl font-semibold">Avis clientes</h2>
        <div className={`mt-5 grid gap-4 ${side ? '' : 'md:grid-cols-2'}`}>
          {reviews.length === 0 && <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucun avis publié pour le moment.</p>}
          {reviews.map((review) => (
            <article key={review._id} className="rounded-lg border p-4" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
              <p className="flex gap-1" aria-label={`${review.rating} sur 5`}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <PawPrint key={index} className="h-4 w-4" fill={index < review.rating ? 'currentColor' : 'none'} style={{ color: 'var(--v-accent)' }} />
                ))}
              </p>
              <p className="mt-3 text-sm leading-6">{review.comment}</p>
              <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--v-muted-foreground)' }}>{review.displayName || 'Cliente BeautySavage'}</p>
            </article>
          ))}
        </div>
      </section>
  );

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-32 md:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-start">
        <div>
          <div className="relative mb-7 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            <PromoBadge product={product} large />
            {coverUrl ? (
              <img src={coverUrl} alt={product.title} className="aspect-square w-full object-cover" />
            ) : (
              <div className="grid aspect-square place-items-center" style={{ color: 'var(--v-muted-foreground)' }}>
                <ImageIcon className="h-12 w-12" />
              </div>
            )}
          </div>
          {trailerCode && (
            <button
              type="button"
              onClick={() => setTrailerOpen(true)}
              className="mb-7 inline-flex w-full items-center justify-center gap-2 rounded-md border px-5 py-3 text-sm font-semibold"
              style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}
            >
              <Play className="h-4 w-4" /> Voir la bande annonce
            </button>
          )}
          {sideBlocks && (
            <div className="hidden lg:block">
              {faqBlock(true)}
              {reviewsBlock(true)}
            </div>
          )}
        </div>
        <aside className="rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>{kindLabel(product.kind)}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal md:text-5xl">{product.title}</h1>
          <RichDescription value={product.description} className="mt-4 text-base leading-7" style={{ color: 'var(--v-muted-foreground)' }} />
          <div className="mt-6 grid gap-3">
            {product.requiresLegalWaiver && <Line text="Accès confirmé après acceptation des conditions de formation." />}
            {product.kind === 'DISTANCE_TRAINING' && <Line text="Accès aux modules depuis votre espace client après achat." />}
            {product.kind === 'IN_PERSON_TRAINING' && product.training?.durationDays ? <Line text={`Durée : ${product.training.durationDays} jour${product.training.durationDays > 1 ? 's' : ''} en institut.`} /> : null}
            {product.kind === 'IN_PERSON_TRAINING' && <Line text={`Places limitées, ${product.sessions.length} session(s) à venir.`} />}
            {product.kind === 'SERVICE' && product.durationMinutes ? <Line text={`Durée : ${durationText(product.durationMinutes)}`} /> : null}
          </div>
          <div className="mt-6">
            {product.kind === 'GIFT_CARD' ? <div className="text-3xl font-semibold">{displayPrice}</div> : <PromoPrice product={product} size="page" />}
          </div>
          <PromotionCountdown product={product} onEnded={onPromoEnded} />
          {product.kind === 'GIFT_CARD' && (
            <GiftCardConfigurator value={giftCard} minimumEuros={giftMinimumEuros} onChange={setGiftCard} />
          )}
          <button
            type="button"
            onClick={() => start()}
            data-testid="quick-buy"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 font-semibold"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
          >
            {reservable ? <><CalendarDays className="h-4 w-4" /> Réserver</> : 'Acheter maintenant'}
          </button>
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
            {reservable ? 'Choisissez votre créneau, puis réglez en ligne.' : 'Paiement direct, sans passer par le panier.'}
          </p>
          {/* La formation présentielle choisit sa session d'abord (les places en dépendent) ; tout le reste s'ajoute tel quel. */}
          {product.kind === 'IN_PERSON_TRAINING' ? (
            <button
              type="button"
              onClick={() => start('cart')}
              data-testid="reserve-to-cart"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border-2 px-5 py-3 font-semibold transition hover:opacity-90"
              style={{ borderColor: 'var(--v-primary)', color: 'var(--v-foreground)', background: 'color-mix(in srgb, var(--v-primary) 6%, transparent)' }}
            >
              <ShoppingBag className="h-4 w-4" /> Ajouter au panier
            </button>
          ) : (
            <motion.button
              type="button"
              onClick={(e) => addToCart(e.currentTarget)}
              disabled={adding}
              whileTap={{ scale: 0.97 }}
              data-testid="add-to-cart"
              data-added={added || undefined}
              className="relative mt-3 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-md border-2 px-5 py-3 font-semibold transition-colors"
              style={added
                ? { borderColor: '#059669', background: '#ecfdf5', color: '#065f46' }
                : { borderColor: 'var(--v-primary)', color: 'var(--v-foreground)', background: 'color-mix(in srgb, var(--v-primary) 6%, transparent)' }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {added ? (
                  <motion.span key="ok" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> Ajouté au panier
                  </motion.span>
                ) : (
                  <motion.span key="add" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} className="inline-flex items-center gap-2">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />} Ajouter au panier
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )}
          <AnimatePresence>
            {added && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-2 text-center text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                {product.kind === 'SERVICE' ? 'Vous choisirez le créneau depuis le panier. ' : ''}<Link to="/panier" className="font-semibold underline" data-testid="added-see-cart">Voir le panier</Link>
              </motion.p>
            )}
          </AnimatePresence>
          {message && <p className="mt-4 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
        </aside>
      </div>
      {product.kind === 'SERVICE' && gallery.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl font-semibold">Galerie</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {gallery.map((image, index) => (
              <img key={`${image}-${index}`} src={image} alt={`${product.title} ${index + 1}`} className="aspect-square rounded-md border object-cover" style={{ borderColor: 'var(--v-border)' }} />
            ))}
          </div>
        </section>
      )}
      <AuthRequiredModal open={Boolean(authPrompt)} action={authPrompt?.action || 'buy'} unverified={authPrompt?.unverified} onClose={() => setAuthPrompt(null)} />
      {bookingOpen && (
        <BookingDialog
          product={product}
          giftLine={giftCardLine()}
          giftMinimumEuros={giftMinimumEuros}
          giftAmountEuros={giftCard.amountEuros}
          giftRecipient={giftCard.recipientName}
          onClose={() => setBookingOpen(false)}
          onDone={(target) => {
            if (/^https?:\/\//i.test(target)) window.location.href = target;
            else navigate(target);
          }}
        />
      )}
      {trailerOpen && trailerCode && (
        <TrailerModal
          title={product.trailer?.title || product.title}
          shortcode={trailerCode}
          coverUrl={resolvePreviewMediaUrl(product.trailer?.coverUrl || '/training-video-cover.png')}
          onClose={() => setTrailerOpen(false)}
        />
      )}
      <div className={sideBlocks ? 'lg:hidden' : ''}>
        {faqBlock(false)}
        {reviewsBlock(false)}
      </div>
    </section>
  );
}

function streamableShortcode(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-z0-9]{4,12}$/i.test(raw)) return raw.toLowerCase();
  try {
    const parsed = new URL(raw);
    if (!parsed.hostname.toLowerCase().includes('streamable.com')) return '';
    return parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function TrailerModal({ title, shortcode, coverUrl, onClose }: { title: string; shortcode: string; coverUrl?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl overflow-hidden rounded-lg border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--v-border)' }}>
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border" style={{ borderColor: 'var(--v-border)' }} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <LazyStreamablePlayer shortcode={shortcode} title={title} coverUrl={coverUrl} />
        </div>
      </div>
    </div>
  );
}

function LazyStreamablePlayer({ shortcode, title, coverUrl }: { shortcode: string; title: string; coverUrl?: string }) {
  const [started, setStarted] = React.useState(false);
  const [src, setSrc] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  async function play() {
    setStarted(true);
    setLoading(true);
    setError('');
    try {
      const resolved = await customerApi.streamablePlaybackUrl(shortcode);
      setSrc(resolved.playbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vidéo indisponible');
      setSrc('');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-black" style={{ borderColor: 'var(--v-border)' }}>
      <div className="relative aspect-video">
        {!started && (
          <button type="button" onClick={play} className="absolute inset-0 grid place-items-center bg-black text-white">
            {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
            <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-xl"><Play className="h-7 w-7" /></span>
          </button>
        )}
        {started && loading && <div className="absolute inset-0 grid place-items-center text-sm text-white/80"><Loader2 className="h-4 w-4 animate-spin" /> Chargement</div>}
        {src && <video src={src} controls autoPlay playsInline className="h-full w-full object-contain" />}
        {error && !loading && <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-200">{error}</div>}
      </div>
      <p className="p-3 text-sm font-semibold text-white">{title}</p>
    </div>
  );
}

function GiftCardConfigurator({
  value,
  minimumEuros,
  onChange,
}: {
  value: { senderName: string; recipientName: string; message: string; amountEuros: string };
  minimumEuros: number;
  onChange: (value: { senderName: string; recipientName: string; message: string; amountEuros: string }) => void;
}) {
  const amountEuros = Math.max(minimumEuros, Number(value.amountEuros || 0));
  const amount = formatter.format(amountEuros);
  const change = (patch: Partial<typeof value>) => onChange({ ...value, ...patch });
  return (
    <div className="mt-6 grid gap-4">
      <GiftCardPreview sender={value.senderName} recipient={value.recipientName} amount={amount} message={value.message} />
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Montant
          <input className="v-field rounded-md px-3 py-3" type="number" min={minimumEuros || 0} step="1" value={value.amountEuros} onBlur={(e) => change({ amountEuros: String(Math.max(minimumEuros, Number(e.target.value || 0))) })} onChange={(e) => change({ amountEuros: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          De la part de
          <input className="v-field rounded-md px-3 py-3" maxLength={32} value={value.senderName} onChange={(e) => change({ senderName: e.target.value.slice(0, 32) })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Pour
          <input className="v-field rounded-md px-3 py-3" maxLength={32} value={value.recipientName} onChange={(e) => change({ recipientName: e.target.value.slice(0, 32) })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Message
          <textarea className="v-field min-h-20 rounded-md px-3 py-3" maxLength={240} value={value.message} onChange={(e) => change({ message: e.target.value.slice(0, 240) })} />
        </label>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
          <Gift className="h-4 w-4" />
          <span>Le PDF final est généré après validation du paiement.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * LES CHAMPS DE LA CARTE, en pixels du visuel (1549 × 1137).
 *
 * Mesurés sur le visuel : chaque texte démarre juste après son libellé et se
 * pose sur SA ligne de base. Le PDF émis après paiement utilise les mêmes
 * valeurs (`commerceDocuments.service.js`) — l'aperçu montre ce qui sera imprimé.
 */
const GIFT_CARD_FIELDS = {
  sender: { x: 1127, baseline: 453, maxWidth: 270 },
  recipient: { x: 1078, baseline: 559, maxWidth: 320 },
  amount: { x: 1110, baseline: 680, maxWidth: 290 },
} as const;

/**
 * L'APERÇU : le visuel, et un calque SVG de même repère par-dessus.
 *
 * Le SVG écrit sur une ligne de base native et suit la taille de l'image sans
 * aucun calcul — là où des pourcentages CSS décalaient le texte selon la
 * largeur d'écran. Un texte trop long est resserré (`textLength`) plutôt que
 * de déborder du cadre blanc.
 */
function GiftCardPreview({ sender, recipient, amount, message }: { sender: string; recipient: string; amount: string; message: string }) {
  const field = (key: keyof typeof GIFT_CARD_FIELDS, text: string, placeholder: string) => {
    const spec = GIFT_CARD_FIELDS[key];
    const value = (text.trim() || placeholder).slice(0, 32);
    const fontSize = 30;
    // Estimation large d'une serif à 30 px : ~0,5 em par caractère.
    const estimated = value.length * fontSize * 0.5;
    return (
      <text
        x={spec.x}
        y={spec.baseline}
        fontSize={fontSize}
        fill={text.trim() ? '#15120f' : '#9a948b'}
        fontFamily='Georgia, "Times New Roman", serif'
        {...(estimated > spec.maxWidth ? { textLength: spec.maxWidth, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
      >
        {value}
      </text>
    );
  };
  return (
    <div className="relative overflow-hidden rounded-md border" style={{ borderColor: 'var(--v-border)' }} data-testid="gift-card-preview">
      <img src={GIFT_CARD_IMAGE} alt="Aperçu de la carte cadeau" className="block w-full" />
      <svg viewBox="0 0 1549 1137" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {field('sender', sender, 'Votre nom')}
        {field('recipient', recipient, 'Bénéficiaire')}
        {field('amount', amount, '')}
        {message.trim() && (
          <foreignObject x={949} y={745} width={440} height={170}>
            <p style={{ margin: 0, font: 'italic 22px/1.35 Georgia, "Times New Roman", serif', color: '#5a524a', overflow: 'hidden', maxHeight: 170, wordBreak: 'break-word' }}>
              {message.slice(0, 120)}
            </p>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}



/**
 * RÉSERVER / ACHETER — une fenêtre, deux étapes.
 *
 *   1. « Choisir » (prestation, formation présentielle) : le calendrier des
 *      créneaux libres, ou la liste des sessions ouvertes ;
 *   2. « Payer » : récapitulatif, consentements légaux de CETTE fiche, carte
 *      cadeau facultative, paiement direct — ou ajout au panier.
 *
 * Formation en ligne et carte cadeau n'ont rien à choisir : elles ouvrent
 * directement sur l'étape 2.
 */
function BookingDialog({
  product,
  giftLine,
  giftMinimumEuros,
  giftAmountEuros,
  giftRecipient,
  onClose,
  onDone,
}: {
  product: CommerceProduct;
  giftLine: OrderLineInput | null;
  giftMinimumEuros: number;
  giftAmountEuros: string;
  giftRecipient: string;
  onClose: () => void;
  onDone: (target: string) => void;
}) {
  const needsChoice = product.kind === 'SERVICE' || product.kind === 'IN_PERSON_TRAINING';
  const [step, setStep] = React.useState<'choose' | 'pay'>(needsChoice ? 'choose' : 'pay');
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const requirements = (product.consentRequirements ?? []).filter((item) => item.required);
  const [accepted, setAccepted] = React.useState<string[]>([]);
  const [giftCards, setGiftCards] = React.useState<AppliedGiftCard[]>([]);
  const [optionKeys, setOptionKeys] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');

  const session = product.sessions.find((item) => item.id === sessionId) || null;

  const line: OrderLineInput | null = product.kind === 'GIFT_CARD'
    ? giftLine
    : product.kind === 'SERVICE'
      ? (slot ? { productId: product.id, quantity: 1, serviceBooking: slot, optionKeys } : null)
      : product.kind === 'IN_PERSON_TRAINING'
        ? (sessionId ? { productId: product.id, quantity: 1, sessionId, optionKeys } : null)
        : { productId: product.id, quantity: 1, optionKeys };

  const when = (value: string) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const amountCents = product.kind === 'GIFT_CARD'
    ? Math.round(Math.max(giftMinimumEuros, Number(giftAmountEuros || 0)) * 100)
    : product.price.amountCents + optionsTotalCents(product, optionKeys);
  const amount = formatter.format(amountCents / 100);
  // Acompte ou prestation gratuite : seule la part « maintenant » se paie en ligne (cartes cadeaux comprises).
  const payment = product.kind === 'GIFT_CARD' ? { payNowCents: amountCents, balanceDueCents: 0, rule: 'FULL' as const } : paySplit(product, amountCents);
  const split = splitPayment(payment.payNowCents, giftCards);
  const detail = product.kind === 'GIFT_CARD'
    ? `Carte cadeau pour ${giftRecipient}`
    : slot
      ? `Rendez-vous le ${when(slot.startsAt)} (${durationText(slot.durationMinutes)})`
      : session
        ? `Session du ${when(session.startsAt)}`
        : 'Accès depuis votre espace client après paiement';
  const ready = Boolean(line) && requirements.every((item) => accepted.includes(item.key));

  async function pay() {
    if (!line) return;
    setBusy(true);
    setError('');
    try {
      const result = await customerApi.quickCheckout(
        line,
        accepted.map((key) => `${QUICK_BUY_LINE_ID}:${key}`),
        split.lines.filter((l) => l.debitCents > 0).map((l) => l.code),
        `/catalogue/${product.slug}`,
      );
      if (result.checkoutUrl) {
        onDone(result.checkoutUrl);
        return;
      }
      setError(result.message || 'Paiement indisponible pour le moment.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paiement indisponible');
    } finally {
      setBusy(false);
    }
  }

  async function addToCart() {
    if (!line) return;
    setBusy(true);
    setError('');
    try {
      const cart = await customerApi.addCartItem(line);
      publishCartCount(cart.lines.length, true);
      setInfo('Ajouté au panier.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ajout au panier impossible');
    } finally {
      setBusy(false);
    }
  }

  /*
    LES DEUX ÉTAPES — chacune occupe une moitié de la fenêtre, avec son icône :
    l'étape en cours est pleine, l'étape franchie porte une coche.
  */
  const STEPS = [
    { key: 'choose', n: 1, label: product.kind === 'SERVICE' ? 'Choisir le créneau' : 'Choisir la session', Icon: CalendarDays },
    { key: 'pay', n: 2, label: 'Payer', Icon: CreditCard },
  ] as const;
  const stepper = needsChoice && (
    <ol className="grid grid-cols-2 border-b" style={{ borderColor: 'var(--v-border)' }} aria-label="Étapes" data-testid="booking-steps">
      {STEPS.map(({ key, n, label, Icon }) => {
        const current = step === key;
        const done = key === 'choose' && step === 'pay';
        return (
          <li
            key={key}
            aria-current={current ? 'step' : undefined}
            className="flex items-center gap-3 px-4 py-3 transition-colors sm:px-5"
            style={{
              background: current ? 'color-mix(in srgb, var(--v-primary) 10%, var(--v-surface))' : 'transparent',
              boxShadow: current ? 'inset 0 -3px 0 var(--v-primary)' : undefined,
            }}
          >
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              style={{
                background: current || done ? 'var(--v-primary)' : 'color-mix(in srgb, var(--v-muted-foreground) 14%, transparent)',
                color: current || done ? 'var(--v-primary-foreground)' : 'var(--v-muted-foreground)',
              }}
            >
              {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--v-muted-foreground)' }}>Étape {n}</span>
              <span className="block text-sm font-semibold leading-tight sm:text-base" style={{ opacity: current || done ? 1 : 0.6 }}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8" role="dialog" aria-modal="true" aria-label={needsChoice ? 'Réservation' : 'Achat rapide'}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
        <div className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: 'var(--v-border)' }}>
          <h2 className="min-w-0 truncate font-semibold">{needsChoice ? `Réserver - ${product.title}` : 'Achat rapide'}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border" style={{ borderColor: 'var(--v-border)' }} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        {stepper}

        <div className="grid gap-4 overflow-y-auto p-5">
          {step === 'choose' && product.kind === 'SERVICE' && (
            <BookingMonthCalendar durationMinutes={Number(product.durationMinutes || 60)} slot={slot} onSlot={setSlot} />
          )}

          {step === 'choose' && product.kind === 'IN_PERSON_TRAINING' && (
            product.sessions.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm" style={{ color: 'var(--v-muted-foreground)', borderColor: 'var(--v-border)' }}>Aucune session publiée pour le moment.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2" data-testid="booking-sessions">
                {product.sessions.map((item) => {
                  const active = item.id === sessionId;
                  const full = item.remaining <= 0;
                  const days = item.days?.length ? item.days : [{ startsAt: item.startsAt, endsAt: item.endsAt }];
                  const time = (v: string) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                  const date = (v: string, o: Intl.DateTimeFormatOptions) => new Date(v).toLocaleDateString('fr-FR', o);
                  const first = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={full}
                      data-testid="booking-session"
                      onClick={() => setSessionId(item.id)}
                      className="grid gap-3 rounded-lg border p-4 text-left transition disabled:opacity-50"
                      style={{ borderColor: active ? 'var(--v-primary)' : 'var(--v-border)', background: active ? 'color-mix(in srgb, var(--v-primary) 12%, var(--v-surface))' : 'transparent' }}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="block text-base font-semibold">
                          {days.length > 1
                            ? `Du ${date(days[0].startsAt, { weekday: 'long', day: 'numeric', month: 'long' })} au ${date(days[days.length - 1].startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}`
                            : first(date(item.startsAt, { weekday: 'long', day: 'numeric', month: 'long' }))}
                        </span>
                        <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--v-muted-foreground) 14%, transparent)' }}>
                          {full ? 'Complet' : `${item.remaining} place${item.remaining > 1 ? 's' : ''}`}
                        </span>
                      </span>
                      <span className="grid gap-1.5" data-testid="booking-session-days">
                        {days.map((d, i) => (
                          <span key={i} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--v-foreground) 5%, transparent)' }}>
                            <span>
                              {days.length > 1 && <span className="font-semibold">Jour {i + 1} · </span>}
                              {days.length > 1 ? date(d.startsAt, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Horaires'}
                            </span>
                            <span className="font-semibold tabular-nums">{time(d.startsAt)} – {time(d.endsAt)}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {step === 'pay' && (
            <>
              <div className="rounded-md border p-4" style={{ borderColor: 'var(--v-border)' }}>
                <p className="font-semibold">{product.title}</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{detail}</p>
                {needsChoice && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--v-accent) 14%, transparent)' }} data-testid="hold-notice">
                    <Clock className="h-3.5 w-3.5" /> {product.kind === 'SERVICE' ? 'Ce créneau vous est réservé 30 minutes, le temps de régler.' : 'Votre place vous est réservée 30 minutes, le temps de régler.'}
                  </p>
                )}
                {optionKeys.length > 0 && (
                  <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }} data-testid="booking-options-recap">
                    + {(product.options || []).filter((o) => optionKeys.includes(o.key)).map((o) => o.label).join(', ')}
                  </p>
                )}
                <motion.p key={amountCents} initial={{ scale: 1.06, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="mt-3 text-2xl font-semibold" data-testid="booking-amount">{amount}</motion.p>
                {payment.balanceDueCents > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm" data-testid="booking-split">
                    <div className="rounded-lg p-3" style={{ background: 'color-mix(in srgb, var(--v-primary) 8%, transparent)' }}>
                      <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{payment.rule === 'FREE' ? 'À payer en ligne' : 'Acompte en ligne'}</p>
                      <p className="font-semibold tabular-nums">{formatter.format(payment.payNowCents / 100)}</p>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'color-mix(in srgb, var(--v-accent) 12%, transparent)' }}>
                      <p className="text-xs" style={{ color: 'var(--v-muted-foreground)' }}>À régler sur place</p>
                      <p className="font-semibold tabular-nums">{formatter.format(payment.balanceDueCents / 100)}</p>
                    </div>
                  </div>
                )}
              </div>
              {product.kind !== 'GIFT_CARD' && <ProductOptions product={product} selected={optionKeys} onChange={setOptionKeys} />}
              {requirements.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={accepted.includes(item.key)}
                    onChange={(event) => setAccepted((current) => event.target.checked ? [...current, item.key] : current.filter((key) => key !== item.key))}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
              {product.kind !== 'GIFT_CARD' && payment.payNowCents > 0 && (
                <div className="grid gap-4 rounded-md border p-4" style={{ borderColor: 'var(--v-border)' }}>
                  <GiftCardPayment totalCents={payment.payNowCents} cards={giftCards} onChange={setGiftCards} />
                  {giftCards.length > 0 && <PaymentSummary totalCents={payment.payNowCents} cards={giftCards} />}
                </div>
              )}
            </>
          )}
          {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
          {info && <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{info} <Link to="/panier" className="font-semibold underline">Voir le panier</Link></p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4" style={{ borderColor: 'var(--v-border)' }}>
          {step === 'choose' ? (
            <>
              <span className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{slot ? when(slot.startsAt) : session ? when(session.startsAt) : 'Choisissez un créneau'}</span>
              <button
                type="button"
                disabled={!line}
                data-testid="booking-next"
                onClick={() => setStep('pay')}
                className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
              >
                Continuer <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                {needsChoice && (
                  <button type="button" onClick={() => setStep('choose')} className="rounded-md border px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>Changer de créneau</button>
                )}
                {needsChoice && (
                  <button
                    type="button"
                    onClick={addToCart}
                    disabled={busy || !line}
                    data-testid="booking-add-to-cart"
                    className="inline-flex items-center gap-2 rounded-md border-2 px-4 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                    style={{ borderColor: 'var(--v-primary)', background: 'color-mix(in srgb, var(--v-primary) 6%, transparent)' }}
                  >
                    <ShoppingBag className="h-4 w-4" /> Ajouter au panier
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={pay}
                disabled={!ready || busy}
                data-testid="quick-buy-pay"
                className="inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold disabled:opacity-60"
                style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : split.toPayCents === 0 ? <Gift className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                {split.toPayCents === 0 ? (payment.payNowCents === 0 ? ' Confirmer la réservation' : ' Valider avec ma carte cadeau') : ` Payer ${formatter.format(split.toPayCents / 100)}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function kindLabel(kind: CommerceProduct['kind']) {
  if (kind === 'SERVICE') return 'Prestation institut';
  if (kind === 'DISTANCE_TRAINING') return 'Formation en ligne';
  if (kind === 'IN_PERSON_TRAINING') return 'Formation présentielle';
  if (kind === 'GIFT_CARD') return 'Carte cadeau';
  return 'Boutique';
}

function Line({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
      <span>{text}</span>
    </div>
  );
}
