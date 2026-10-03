import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, LogIn, MailCheck, ShoppingBag, UserPlus, X } from 'lucide-react';

export type AuthAction = 'reserve' | 'buy' | 'cart';

const COPY: Record<AuthAction, { title: string; text: string; Icon: typeof LogIn }> = {
  reserve: { title: 'Connectez-vous pour réserver', text: 'Votre espace client garde vos rendez-vous, vos factures et vos cartes cadeaux. Connectez-vous ou créez votre compte en quelques secondes, puis choisissez votre créneau.', Icon: CalendarDays },
  buy: { title: 'Connectez-vous pour acheter', text: 'Votre espace client garde vos achats, vos formations et vos factures. Connectez-vous ou créez votre compte en quelques secondes pour finaliser votre achat.', Icon: ShoppingBag },
  cart: { title: 'Connectez-vous pour ajouter au panier', text: 'Votre panier est enregistré dans votre espace client : il vous attend sur tous vos appareils. Connectez-vous ou créez votre compte en quelques secondes.', Icon: ShoppingBag },
};

/**
 * « CONNECTEZ-VOUS POUR… » — une fenêtre au lieu d'une ligne de texte
 * discrète. Le titre suit l'action (réserver, acheter, ajouter au panier) ; un
 * compte non vérifié est invité à confirmer son e-mail. Après la connexion,
 * la cliente revient sur la page qu'elle regardait.
 */
export function AuthRequiredModal({ open, action, unverified = false, onClose }: {
  open: boolean;
  action: AuthAction;
  unverified?: boolean;
  onClose: () => void;
}) {
  const location = useLocation();
  const retour = encodeURIComponent(`${location.pathname}${location.search}`);
  const copy = COPY[action];

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auth-required-title" data-testid="auth-required-modal" data-action={action}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border p-6 text-center shadow-2xl sm:p-8"
            style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}
          >
            <button type="button" onClick={onClose} aria-label="Fermer" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full transition hover:bg-black/5">
              <X className="h-4 w-4" />
            </button>
            <motion.span initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.08 }}
              className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-accent) 18%, transparent)', color: 'var(--v-accent)' }}>
              {unverified ? <MailCheck className="h-7 w-7" /> : <copy.Icon className="h-7 w-7" />}
            </motion.span>
            <h2 id="auth-required-title" className="mt-4 text-2xl font-semibold">{unverified ? 'Confirmez votre adresse e-mail' : copy.title}</h2>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--v-muted-foreground)' }}>
              {unverified
                ? 'Une dernière étape : saisissez le code reçu par e-mail dans votre espace client, puis revenez ici pour continuer.'
                : copy.text}
            </p>
            <div className="mt-6 grid gap-2">
              {unverified ? (
                <Link to={`/espace-client?retour=${retour}`} data-testid="auth-modal-verify" className="inline-flex h-12 items-center justify-center gap-2 rounded-md font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                  <MailCheck className="h-4 w-4" /> Confirmer mon e-mail
                </Link>
              ) : (
                <>
                  <Link to={`/connexion-client?retour=${retour}`} data-testid="auth-modal-login" className="inline-flex h-12 items-center justify-center gap-2 rounded-md font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                    <LogIn className="h-4 w-4" /> Me connecter
                  </Link>
                  <Link to={`/inscription-client?retour=${retour}`} data-testid="auth-modal-register" className="inline-flex h-12 items-center justify-center gap-2 rounded-md border font-semibold" style={{ borderColor: 'var(--v-border)' }}>
                    <UserPlus className="h-4 w-4" /> Créer mon compte
                  </Link>
                </>
              )}
              <button type="button" onClick={onClose} className="mt-1 text-sm font-medium" style={{ color: 'var(--v-muted-foreground)' }}>Plus tard</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
