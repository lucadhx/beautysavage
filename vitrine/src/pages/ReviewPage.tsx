import * as React from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, LogOut, PawPrint, Sparkles } from 'lucide-react';
import { customerApi, type ApiFailure, type PendingReviewItem } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';
import { resolvePreviewMediaUrl } from '@/lib/media';

/**
 * PAGE D'AVIS — ouverte par le lien de l'e-mail « Laisser mon avis ».
 *
 * Connexion obligatoire, et seul le compte visé répond : la demande d'un autre
 * compte est refusée par le serveur (REVIEW_NOT_YOURS). Une cliente qui a
 * enchaîné plusieurs prestations les note l'une après l'autre ; une prestation
 * déjà notée disparaît de la navigation.
 */
const COMMENT_MAX = 1000;
const LABELS = ['', 'Décevant', 'Moyen', 'Bien', 'Très bien', 'Parfait'];

function longDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ReviewPage() {
  const { customer, loading, signOutNow } = useCustomer();
  const location = useLocation();
  const navigate = useNavigate();
  const demande = new URLSearchParams(location.search).get('demande');
  const retour = encodeURIComponent(`${location.pathname}${location.search}`);

  const [items, setItems] = React.useState<PendingReviewItem[] | null>(null);
  const [focusStatus, setFocusStatus] = React.useState<'OPEN' | 'ALREADY_REVIEWED' | null>(null);
  const [error, setError] = React.useState<ApiFailure | null>(null);
  const [done, setDone] = React.useState<string[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [direction, setDirection] = React.useState(1);
  const [celebrate, setCelebrate] = React.useState(false);

  React.useEffect(() => {
    if (!customer) return;
    let alive = true;
    customerApi.reviewRequests(demande)
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setFocusStatus(data.focusStatus);
        setCurrent(data.items[0]?.id ?? null);
      })
      .catch((err: ApiFailure) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [customer, demande]);

  if (loading) return <Shell><Loader2 className="mx-auto h-8 w-8 animate-spin" aria-label="Chargement" /></Shell>;
  // Pas connectée : la connexion ramène ici, sur la même demande.
  if (!customer) return <Navigate to={`/connexion-client?retour=${retour}`} replace />;

  if (error) {
    const foreign = error.code === 'REVIEW_NOT_YOURS';
    return (
      <Shell>
        <Panel>
          <h1 className="text-2xl font-semibold">{foreign ? 'Ce lien concerne un autre compte' : 'Demande d’avis introuvable'}</h1>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
            {foreign
              ? `Vous êtes connectée avec ${customer.email}. Connectez-vous avec l’adresse qui a reçu l’e-mail pour donner votre avis.`
              : error.message}
          </p>
          {foreign && (
            <button
              type="button"
              onClick={() => { signOutNow(); navigate(`/connexion-client?retour=${retour}`, { replace: true }); }}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold"
              style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
              data-testid="switch-account"
            >
              <LogOut className="h-4 w-4" /> Changer de compte
            </button>
          )}
        </Panel>
      </Shell>
    );
  }

  if (!items) return <Shell><Loader2 className="mx-auto h-8 w-8 animate-spin" aria-label="Chargement" /></Shell>;

  const remaining = items.filter((i) => !done.includes(i.id));
  const total = items.length;
  const item = remaining.find((i) => i.id === current) || remaining[0] || null;
  const position = item ? items.findIndex((i) => i.id === item.id) + 1 : total;

  const go = (step: number) => {
    if (!item) return;
    const idx = remaining.findIndex((i) => i.id === item.id);
    const next = remaining[(idx + step + remaining.length) % remaining.length];
    setDirection(step);
    setCurrent(next.id);
  };

  const onReviewed = (id: string) => {
    setCelebrate(true);
    window.setTimeout(() => {
      setCelebrate(false);
      setDirection(1);
      setDone((d) => [...d, id]);
      const after = remaining.filter((i) => i.id !== id);
      setCurrent(after[0]?.id ?? null);
    }, 1500);
  };

  if (!item && !celebrate) {
    return (
      <Shell>
        <Panel>
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
            <Sparkles className="h-8 w-8" />
          </motion.div>
          <h1 className="mt-6 text-center text-2xl font-semibold" data-testid="reviews-finished">
            {done.length > 0 ? 'Merci pour votre avis !' : focusStatus === 'ALREADY_REVIEWED' ? 'Votre avis est déjà enregistré' : 'Aucun avis en attente'}
          </h1>
          <p className="mt-3 text-center text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
            {done.length > 0
              ? 'Il sera publié après une rapide relecture par l’institut. Merci de votre confiance.'
              : focusStatus === 'ALREADY_REVIEWED'
                ? 'Vous avez déjà donné votre avis sur cette prestation. Merci beaucoup !'
                : 'Vous avez donné votre avis sur toutes vos prestations. Merci !'}
          </p>
          <div className="mt-7 flex justify-center">
            <Link to="/espace-client" className="inline-flex h-11 items-center rounded-full px-6 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Mon espace client</Link>
          </div>
        </Panel>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>Votre avis</p>
          {total > 1 && (
            <p className="mt-1 text-sm font-semibold" data-testid="review-counter">Prestation {position}/{total}</p>
          )}
        </div>
        {remaining.length > 1 && !celebrate && (
          <div className="flex gap-2">
            <NavButton label="Prestation précédente" onClick={() => go(-1)}><ChevronLeft className="h-5 w-5" /></NavButton>
            <NavButton label="Prestation suivante" onClick={() => go(1)}><ChevronRight className="h-5 w-5" /></NavButton>
          </div>
        )}
      </div>
      {total > 1 && (
        <div className="mb-5 flex gap-1.5" aria-hidden="true">
          {items.map((i) => (
            <span key={i.id} className="h-1.5 flex-1 rounded-full transition-colors duration-500" style={{ background: done.includes(i.id) ? 'var(--v-primary)' : i.id === item?.id ? 'var(--v-accent)' : 'var(--v-border)' }} />
          ))}
        </div>
      )}
      <div className="relative">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          {celebrate ? (
            <Celebration key="celebrate" />
          ) : item ? (
            <ReviewCard key={item.id} item={item} direction={direction} onReviewed={onReviewed} />
          ) : null}
        </AnimatePresence>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto min-h-screen w-full max-w-xl px-4 pb-24 pt-28 sm:px-6 md:pt-32">{children}</section>;
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border p-6 shadow-sm sm:p-8" style={{ borderColor: 'var(--v-border)', background: 'var(--v-card, #fff)' }}>{children}</div>;
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid h-10 w-10 place-items-center rounded-full border transition hover:scale-105" style={{ borderColor: 'var(--v-border)' }} data-testid="review-nav">
      {children}
    </button>
  );
}

function Celebration() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="grid place-items-center rounded-3xl border px-6 py-16 text-center"
      style={{ borderColor: 'var(--v-border)', background: 'var(--v-card, #fff)' }}
      data-testid="review-celebration"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.15, 1] }}
        transition={{ duration: reduce ? 0.01 : 0.55, times: [0, 0.6, 1] }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
      >
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <Check className="h-10 w-10" strokeWidth={3} />
        </motion.span>
      </motion.div>
      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-5 text-xl font-semibold">Avis envoyé, merci !</motion.p>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-2 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Il sera publié après validation par l’institut.</motion.p>
    </motion.div>
  );
}

function ReviewCard({ item, direction, onReviewed }: { item: PendingReviewItem; direction: number; onReviewed: (id: string) => void }) {
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState('');
  const shown = hover || rating;
  const cover = item.coverUrl ? resolvePreviewMediaUrl(item.coverUrl) : '';

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    setError('');
    try {
      await customerApi.submitRequestedReview(item.id, { rating, comment: comment.trim() });
      onReviewed(item.id);
    } catch (err) {
      const failure = err as ApiFailure;
      if (failure.code === 'ALREADY_REVIEWED') { onReviewed(item.id); return; }
      setError(failure.message || 'Envoi impossible, réessayez.');
      setSending(false);
    }
  }

  return (
    <motion.div
      custom={direction}
      initial={{ opacity: 0, x: direction * 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: direction * -60 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="overflow-hidden rounded-3xl border shadow-sm"
      style={{ borderColor: 'var(--v-border)', background: 'var(--v-card, #fff)' }}
      data-testid="review-card"
    >
      <div className="flex items-center gap-4 border-b p-5" style={{ borderColor: 'var(--v-border)' }}>
        {cover ? (
          <img src={cover} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl" style={{ background: 'var(--v-muted, #f4f4f5)' }}><Sparkles className="h-6 w-6" /></span>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug" data-testid="review-title">{item.title}</h1>
          {item.completedAt && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs first-letter:uppercase" style={{ color: 'var(--v-muted-foreground)' }}>
              <CalendarDays className="h-3.5 w-3.5" /> {longDate(item.completedAt)}
            </p>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <p className="text-center text-sm font-semibold" aria-live="polite" data-testid="rating-counter">
          Avis : {shown}/5{shown ? <span className="font-normal" style={{ color: 'var(--v-muted-foreground)' }}> · {LABELS[shown]}</span> : null}
        </p>
        <div className="mt-3 flex justify-center gap-1 sm:gap-2" role="radiogroup" aria-label="Votre note" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = n <= shown;
            return (
              <motion.button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} sur 5`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                whileTap={{ scale: 0.85 }}
                animate={{ scale: filled ? 1.06 : 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18, delay: filled ? (n - 1) * 0.03 : 0 }}
                className="grid h-14 w-14 place-items-center rounded-full outline-none focus-visible:ring-2 sm:h-16 sm:w-16"
                data-testid={`paw-${n}`}
                data-filled={filled || undefined}
              >
                <PawPrint className="h-10 w-10 sm:h-11 sm:w-11" stroke="#111" strokeWidth={1.6} fill={filled ? '#111' : 'transparent'} />
              </motion.button>
            );
          })}
        </div>

        <label className="mt-6 block text-sm font-semibold" htmlFor="review-comment">
          Votre commentaire <span className="font-normal" style={{ color: 'var(--v-muted-foreground)' }}>(facultatif)</span>
        </label>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
          maxLength={COMMENT_MAX}
          rows={5}
          placeholder="Qu’avez-vous apprécié ? Un conseil pour les prochaines clientes ?"
          className="mt-2 w-full resize-y rounded-2xl border px-4 py-3 text-base outline-none focus:ring-2"
          style={{ borderColor: 'var(--v-border)', background: 'transparent' }}
          data-testid="review-comment"
        />
        <p className="mt-1 text-right text-xs tabular-nums" style={{ color: comment.length >= COMMENT_MAX ? '#b91c1c' : 'var(--v-muted-foreground)' }}>{comment.length} / {COMMENT_MAX}</p>

        {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

        <button
          type="button"
          onClick={send}
          disabled={!rating || sending}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}
          data-testid="review-submit"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {rating ? 'Envoyer mon avis' : 'Choisissez une note'}
        </button>
      </div>
    </motion.div>
  );
}
