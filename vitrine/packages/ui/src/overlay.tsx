// RX3 — Primitives d'overlay partagées (extraites du pattern CustomerDrawer manager).
// Un SEUL Drawer produit (ProductUXGuideline §4/§15) : bottom-sheet sur mobile, side-panel sur desktop.
// Tokens --bs-* uniquement, cibles ≥44px, Escape + clic scrim pour fermer, focus déplacé à l'ouverture.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { motionPreset } from './polish/motion';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Actions collées en bas (ex. CTA payer / confirmer). */
  footer?: ReactNode;
  /** Côté du panneau sur desktop (mobile = toujours bottom-sheet). */
  side?: 'right' | 'left';
  /** Libellé du bouton de fermeture (a11y). */
  closeLabel?: string;
}

/** Drawer responsive : bottom-sheet (mobile) / side-panel (desktop). */
export function Drawer({ open, title, onClose, children, footer, side = 'right', closeLabel = 'Fermer' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // `onClose` est souvent une arrow inline (identité nouvelle à chaque rendu). On la lit via une ref
  // pour que l'effet ne dépende QUE de `open` : sinon il se relance à chaque frappe et `panelRef.focus()`
  // vole le focus de l'input en cours de saisie (déselection à chaque lettre).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Verrouille le scroll du fond pendant que le drawer est ouvert.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="bs-overlay-root">
      <div className="bs-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={['bs-drawer', `bs-drawer--${side}`, motionPreset('drawer')].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="bs-drawer"
      >
        <div className="bs-drawer__head">
          <span className="bs-drawer__title">{title}</span>
          <button type="button" className="bs-icon-btn" aria-label={closeLabel} onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="bs-drawer__body">{children}</div>
        {footer ? <div className="bs-drawer__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export interface StickyBarProps {
  children: ReactNode;
  className?: string;
  /** Sur desktop, rester dans le flux (utile pour un aside sticky) au lieu de coller le bas de viewport. */
  desktopInline?: boolean;
}

/** Barre d'action collée au bas (sticky CTA mobile). Premium : reste visible sans scroll. */
export function StickyBar({ children, className = '', desktopInline = true }: StickyBarProps) {
  const cls = ['bs-stickybar', desktopInline ? 'bs-stickybar--desktop-inline' : '', className].filter(Boolean).join(' ');
  return <div className={cls}>{children}</div>;
}

export default { Drawer, StickyBar };
