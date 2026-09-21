import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, Gift, ImageIcon, Loader2, PawPrint, Play, X } from 'lucide-react';
import { commerceApi, customerApi, type CommerceProduct } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';
import { resolvePreviewMediaUrl } from '@/lib/media';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export default function ProductPage() {
  const { slug = '' } = useParams();
  const { customer } = useCustomer();
  const [product, setProduct] = React.useState<CommerceProduct | null>(null);
  const [reviews, setReviews] = React.useState<any[]>([]);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [availability, setAvailability] = React.useState<{ startsAt: string; endsAt: string; durationMinutes: number }[]>([]);
  const [slotKey, setSlotKey] = React.useState('');
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [trailerOpen, setTrailerOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [giftCard, setGiftCard] = React.useState({
    senderName: '',
    recipientName: '',
    recipientEmail: '',
    message: '',
    amountEuros: '50',
  });

  React.useEffect(() => {
    commerceApi.product(slug).then((item) => {
      setProduct(item);
      setSessionId(item.sessions[0]?.id ?? null);
      if (item.kind === 'GIFT_CARD') {
        const minimumEuros = Math.round(Math.max(0, Number(item.price?.amountCents || 0)) / 100);
        if (minimumEuros > 0) setGiftCard((current) => ({ ...current, amountEuros: String(minimumEuros) }));
      }
      commerceApi.reviews(item.id).then(setReviews).catch(() => setReviews([]));
    }).catch((err) => setMessage(err.message));
  }, [slug]);

  React.useEffect(() => {
    if (!product || product.kind !== 'SERVICE') {
      setAvailability([]);
      setSlotKey('');
      return;
    }
    const from = new Date();
    const to = new Date(Date.now() + 21 * 86400_000);
    setLoadingSlots(true);
    commerceApi.availability({
      from: from.toISOString(),
      to: to.toISOString(),
      durationMinutes: Math.max(15, Number(product.durationMinutes || 60)),
    })
      .then((slots) => {
        setAvailability(slots);
        setSlotKey(slots[0]?.startsAt || '');
      })
      .catch(() => {
        setAvailability([]);
        setSlotKey('');
      })
      .finally(() => setLoadingSlots(false));
  }, [product]);

  async function addToCart() {
    if (!product) return;
    if (!customer) {
      setMessage('Connectez-vous a votre espace client avant de composer le panier.');
      return;
    }
    if (!customer.emailVerified) {
      setMessage('Verifiez votre e-mail dans l espace client avant de composer le panier.');
      return;
    }
    const selectedSlot = availability.find((slot) => slot.startsAt === slotKey);
    if (product.kind === 'SERVICE' && !selectedSlot) {
      setMessage('Choisissez un creneau disponible avant d ajouter cette prestation.');
      return;
    }
    const body = product.kind === 'GIFT_CARD'
      ? {
        productId: product.id,
        quantity: 1,
        giftCard: {
          senderName: giftCard.senderName,
          recipientName: giftCard.recipientName,
          recipientEmail: giftCard.recipientEmail,
          message: giftCard.message,
          amountCents: Math.round(Math.max(Math.round((product.price?.amountCents || 0) / 100), Number(giftCard.amountEuros || 0)) * 100),
        },
      }
      : product.kind === 'SERVICE'
        ? { productId: product.id, quantity: 1, serviceBooking: selectedSlot }
        : { productId: product.id, quantity: 1, sessionId };
    await customerApi.addCartItem(body);
    setMessage('Article ajoute au panier.');
  }

  if (!product) {
    return <section className="min-h-screen px-5 pt-32">{message || 'Chargement...'}</section>;
  }

  const coverUrl = product.kind === 'GIFT_CARD'
    ? '/gift-card-master.jpg'
    : resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
  const gallery = (product.gallery || []).map((url) => resolvePreviewMediaUrl(url)).filter(Boolean);
  const reservable = product.kind === 'SERVICE' || product.kind === 'IN_PERSON_TRAINING';
  const selectedSession = product.sessions.find((session) => session.id === sessionId);
  const selectedSlot = availability.find((slot) => slot.startsAt === slotKey);
  const trailerCode = streamableShortcode(product.trailer?.streamableShortcode || product.trailer?.sourceUrl || product.trailer?.url || '');
  const giftMinimumEuros = Math.round(Math.max(0, Number(product.price?.amountCents || 0)) / 100);
  const displayPrice = product.kind === 'GIFT_CARD'
    ? (giftMinimumEuros > 0 ? `A partir de ${formatter.format(giftMinimumEuros)}` : 'Montant libre')
    : formatter.format(product.price.amountCents / 100);

  return (
    <section className="mx-auto min-h-screen max-w-6xl px-5 pb-24 pt-32 md:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-start">
        <div>
          <div className="mb-7 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
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
        </div>
        <aside className="rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>{kindLabel(product.kind)}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal md:text-5xl">{product.title}</h1>
          <p className="mt-4 text-base leading-7" style={{ color: 'var(--v-muted-foreground)' }}>{product.description}</p>
          <div className="mt-6 grid gap-3">
            {product.requiresLegalWaiver && <Line text="Acces confirme apres acceptation des conditions de formation." />}
            {product.kind === 'DISTANCE_TRAINING' && <Line text="Acces aux modules depuis votre espace client apres achat." />}
            {product.kind === 'IN_PERSON_TRAINING' && <Line text="Places limitees, inscription confirmee apres paiement." />}
          </div>
          {reservable && (
            <a
              href="#calendrier"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold"
              style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
            >
              <CalendarDays className="h-4 w-4" /> Voir le calendrier
            </a>
          )}
          <div className="mt-6 text-3xl font-semibold">
            {displayPrice}
          </div>
          {product.kind === 'GIFT_CARD' && (
            <GiftCardConfigurator value={giftCard} minimumEuros={giftMinimumEuros} onChange={setGiftCard} />
          )}
          {product.kind === 'IN_PERSON_TRAINING' && product.sessions.length > 0 && (
            <label className="mt-6 block text-sm font-medium">
              Session
              <select className="v-field mt-2 w-full rounded-md px-3 py-3" value={sessionId ?? ''} onChange={(e) => setSessionId(e.target.value)}>
                {product.sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {new Date(session.startsAt).toLocaleDateString('fr-FR')} - {session.remaining} places
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedSession && (
            <div className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--v-border)' }}>
              <p className="font-semibold">{new Date(selectedSession.startsAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</p>
              <p className="mt-1" style={{ color: 'var(--v-muted-foreground)' }}>{selectedSession.remaining} place(s) disponible(s)</p>
            </div>
          )}
          {product.kind === 'SERVICE' && selectedSlot && (
            <div className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--v-border)' }}>
              <p className="font-semibold">{new Date(selectedSlot.startsAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</p>
              <p className="mt-1" style={{ color: 'var(--v-muted-foreground)' }}>Creneau choisi pour votre rendez-vous</p>
            </div>
          )}
          <button
            type="button"
            onClick={addToCart}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 font-semibold"
            style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
          >
            Ajouter au panier <ArrowRight className="h-4 w-4" />
          </button>
          <Link to="/panier" className="mt-3 inline-flex w-full justify-center text-sm font-semibold">Voir le panier</Link>
          {!customer && <Link to="/connexion-client" className="mt-3 inline-flex w-full justify-center text-sm font-semibold">Connexion cliente</Link>}
          {customer && !customer.emailVerified && <Link to="/espace-client" className="mt-3 inline-flex w-full justify-center text-sm font-semibold">Verifier mon e-mail</Link>}
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
      {reservable && (
        <section id="calendrier" className="mt-14 rounded-lg border p-5" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Calendrier</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Choisissez un creneau disponible puis reservez directement.</p>
            </div>
            <button
              type="button"
              onClick={addToCart}
              className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold"
              style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
            >
              Reservation rapide <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          {product.kind === 'SERVICE' ? (
            loadingSlots ? (
              <p className="mt-5 inline-flex items-center gap-2 rounded-md border p-4 text-sm" style={{ color: 'var(--v-muted-foreground)', borderColor: 'var(--v-border)' }}>
                <Loader2 className="h-4 w-4 animate-spin" /> Recherche des disponibilites
              </p>
            ) : availability.length === 0 ? (
              <p className="mt-5 rounded-md border border-dashed p-4 text-sm" style={{ color: 'var(--v-muted-foreground)', borderColor: 'var(--v-border)' }}>Aucun creneau disponible pour le moment.</p>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {availability.slice(0, 24).map((slot) => {
                  const selected = slot.startsAt === slotKey;
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => setSlotKey(slot.startsAt)}
                      className="rounded-lg border p-4 text-left transition"
                      style={{
                        borderColor: selected ? 'var(--v-primary)' : 'var(--v-border)',
                        background: selected ? 'color-mix(in srgb, var(--v-primary) 10%, var(--v-surface))' : 'transparent',
                      }}
                    >
                      <span className="text-sm font-semibold">{new Date(slot.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                      <span className="mt-2 block text-2xl font-semibold">{new Date(slot.startsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="mt-2 block text-xs" style={{ color: 'var(--v-muted-foreground)' }}>Durée {slot.durationMinutes} min</span>
                    </button>
                  );
                })}
              </div>
            )
          ) : product.sessions.length === 0 ? (
            <p className="mt-5 rounded-md border border-dashed p-4 text-sm" style={{ color: 'var(--v-muted-foreground)', borderColor: 'var(--v-border)' }}>Aucun creneau publie pour le moment.</p>
          ) : (
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {product.sessions.map((session) => {
                const selected = session.id === sessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSessionId(session.id)}
                    className="rounded-lg border p-4 text-left transition"
                    style={{
                      borderColor: selected ? 'var(--v-primary)' : 'var(--v-border)',
                      background: selected ? 'color-mix(in srgb, var(--v-primary) 10%, var(--v-surface))' : 'transparent',
                    }}
                  >
                    <span className="text-sm font-semibold">{new Date(session.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                    <span className="mt-2 block text-2xl font-semibold">{new Date(session.startsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="mt-2 block text-xs" style={{ color: 'var(--v-muted-foreground)' }}>{session.remaining} place(s) restante(s)</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
      {trailerOpen && trailerCode && (
        <TrailerModal
          title={product.trailer?.title || product.title}
          shortcode={trailerCode}
          coverUrl={resolvePreviewMediaUrl(product.trailer?.coverUrl || '/training-video-cover.png')}
          onClose={() => setTrailerOpen(false)}
        />
      )}
      <section className="mt-14">
        <h2 className="text-2xl font-semibold">Avis clientes</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {reviews.length === 0 && <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Aucun avis publie pour le moment.</p>}
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
      setError(err instanceof Error ? err.message : 'Video indisponible');
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
  value: { senderName: string; recipientName: string; recipientEmail: string; message: string; amountEuros: string };
  minimumEuros: number;
  onChange: (value: { senderName: string; recipientName: string; recipientEmail: string; message: string; amountEuros: string }) => void;
}) {
  const amountEuros = Math.max(minimumEuros, Number(value.amountEuros || 0));
  const amount = formatter.format(amountEuros);
  const change = (patch: Partial<typeof value>) => onChange({ ...value, ...patch });
  return (
    <div className="mt-6 grid gap-4">
      <div className="relative overflow-hidden rounded-md border" style={{ borderColor: 'var(--v-border)' }}>
        <img src="/gift-card-master.jpg" alt="Preview carte cadeau BeautySavage" className="block w-full" />
        <GiftLine top="40.45%" text={value.senderName || 'Votre nom'} max={30} />
        <GiftLine top="49.72%" text={value.recipientName || 'Beneficiaire'} max={30} />
        <GiftLine top="60.82%" text={amount} max={16} />
      </div>
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
          E-mail beneficiaire
          <input className="v-field rounded-md px-3 py-3" type="email" maxLength={120} value={value.recipientEmail} onChange={(e) => change({ recipientEmail: e.target.value.slice(0, 120) })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Message
          <textarea className="v-field min-h-20 rounded-md px-3 py-3" maxLength={240} value={value.message} onChange={(e) => change({ message: e.target.value.slice(0, 240) })} />
        </label>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
          <Gift className="h-4 w-4" />
          <span>Le PDF final est genere apres validation du paiement.</span>
        </div>
      </div>
    </div>
  );
}

function GiftLine({ top, text, max }: { top: string; text: string; max: number }) {
  const safe = text.slice(0, max);
  const length = safe.length;
  const fontSize = length > 26
    ? 'clamp(6.5px, 0.78vw, 10.5px)'
    : length > 18
      ? 'clamp(7.5px, 0.9vw, 12px)'
      : 'clamp(8px, 1.05vw, 14px)';
  return (
    <span
      className="absolute block truncate whitespace-nowrap leading-none"
      style={{
        left: '70.85%',
        top,
        width: '16.7%',
        color: '#15120f',
        fontSize,
        transform: 'translateY(-86%)',
        fontFamily: 'Georgia, "Times New Roman", serif',
        textAlign: 'left',
        fontWeight: 500,
      }}
    >
      {safe}
    </span>
  );
}

function kindLabel(kind: CommerceProduct['kind']) {
  if (kind === 'SERVICE') return 'Prestation institut';
  if (kind === 'DISTANCE_TRAINING') return 'Formation en ligne';
  if (kind === 'IN_PERSON_TRAINING') return 'Formation presentielle';
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
