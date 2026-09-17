// M9 — Drawer responsive (bottom-sheet mobile / panel latéral desktop) + bandeau pulse.
import { useEffect, type ReactNode } from 'react';

export function NotificationPulseBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="nc-pulse-banner" role="status" aria-live="polite" data-testid="nc-pulse-banner">
      <i className="bi-bell-fill" aria-hidden="true" />
      {text}
    </span>
  );
}

export function NotificationDrawer({
  open,
  onClose,
  title,
  headerActions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="nc-overlay" onClick={onClose} aria-hidden="true" />
      <div className="nc-drawer" role="dialog" aria-modal="true" aria-label={title} data-testid="nc-drawer">
        <div className="nc-drawer__header">
          <span className="nc-drawer__title">{title}</span>
          {headerActions}
          <button type="button" className="nc-iconbtn" onClick={onClose} aria-label="Fermer">
            <i className="bi-x-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="nc-drawer__body">{children}</div>
      </div>
    </>
  );
}
