import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, LogOut } from 'lucide-react';

/**
 * « SE DÉCONNECTER ? » — confirmation, puis une courte animation et la
 * confirmation « Vous êtes déconnectée ». La session n'est fermée qu'au
 * clic sur « Me déconnecter ».
 */
export function LogoutDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [phase, setPhase] = React.useState<'ask' | 'leaving' | 'done'>('ask');
  React.useEffect(() => { if (open) setPhase('ask'); }, [open]);
  React.useEffect(() => {
    if (!open || phase !== 'ask') return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, onCancel]);

  function confirm() {
    setPhase('leaving');
    window.setTimeout(() => {
      onConfirm();
      setPhase('done');
      window.setTimeout(onCancel, 1400);
    }, 700);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => phase === 'ask' && onCancel()} role="dialog" aria-modal="true" aria-live="polite" data-testid="logout-dialog" data-phase={phase}>
          <motion.div onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 20, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl" style={{ borderColor: 'var(--v-border)', background: 'var(--v-surface)' }}>
            <AnimatePresence mode="wait">
              {phase === 'done' ? (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 16 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckCircle2 className="h-8 w-8" />
                  </motion.span>
                  <p className="mt-4 text-xl font-semibold">Vous êtes déconnectée</p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>À très bientôt.</p>
                </motion.div>
              ) : (
                <motion.div key="ask" exit={{ opacity: 0 }}>
                  <motion.span animate={phase === 'leaving' ? { x: [0, 6, 0], opacity: [1, 0.6, 1] } : {}} transition={{ duration: 0.7, repeat: phase === 'leaving' ? Infinity : 0 }}
                    className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--v-accent) 18%, transparent)', color: 'var(--v-accent)' }}>
                    <LogOut className="h-7 w-7" />
                  </motion.span>
                  <p className="mt-4 text-xl font-semibold">Se déconnecter ?</p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Votre panier et vos réservations restent enregistrés dans votre compte.</p>
                  <div className="mt-6 grid grid-cols-2 gap-2">
                    <button type="button" onClick={onCancel} disabled={phase !== 'ask'} className="h-11 rounded-md border font-semibold" style={{ borderColor: 'var(--v-border)' }} data-testid="logout-cancel">Annuler</button>
                    <button type="button" onClick={confirm} disabled={phase !== 'ask'} className="inline-flex h-11 items-center justify-center gap-2 rounded-md font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="logout-confirm">
                      {phase === 'leaving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} {phase === 'leaving' ? 'Déconnexion…' : 'Me déconnecter'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
