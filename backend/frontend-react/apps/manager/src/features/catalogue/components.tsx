// C1 — Catalogue Studio : composants partagés (pattern CatalogueModuleStepper).
// Mobile-first : modules en chips/icônes scrollables horizontalement (mobile) / rail vertical
// (desktop), chevron sur le module actif, statut par module (point coloré + aria). Zéro hex,
// tokens --bs-* uniquement, cibles 44px. Réutilise @bs/ui + @bs/ui/polish.
import type { ReactNode } from 'react';
import { Badge, Skeleton } from '@bs/ui';
import type { CatalogueModuleStatus, CatalogueValidationIssue } from '@bs/api-client';
import type { ModuleValidation } from './validation';

export interface ModuleDescriptor {
  key: string;
  label: string;
  /** Classe Bootstrap Icons (décoratif). */
  icon: string;
}

const STATUS_LABEL: Record<CatalogueModuleStatus, string> = {
  complete: 'Complet',
  incomplete: 'À compléter',
  error: 'Erreur',
  optional: 'Optionnel',
};

// ── Icône de module (avec point de statut) ─────────────────────────────────────
export function CatalogueModuleIcon({ icon, status }: { icon: string; status: CatalogueModuleStatus }) {
  return (
    <span className="cat-modicon">
      <i className={`bi ${icon}`} aria-hidden="true" />
      <span className={`cat-modicon__dot cat-modicon__dot--${status}`} aria-hidden="true" />
    </span>
  );
}

// ── Stepper : navigation par modules ──────────────────────────────────────────
export function CatalogueModuleStepper({
  modules,
  active,
  validation,
  onSelect,
}: {
  modules: ModuleDescriptor[];
  active: string;
  validation: Record<string, ModuleValidation>;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="cat-stepper" aria-label="Modules d'édition">
      {modules.map((m) => {
        const status = validation[m.key]?.status ?? 'optional';
        const isActive = m.key === active;
        return (
          <button
            key={m.key}
            type="button"
            className={`cat-step${isActive ? ' cat-step--active' : ''} cat-step--${status}`}
            aria-current={isActive ? 'step' : undefined}
            data-testid={`cat-step-${m.key}`}
            onClick={() => onSelect(m.key)}
          >
            <CatalogueModuleIcon icon={m.icon} status={status} />
            <span className="cat-step__label">{m.label}</span>
            <span className="cat-step__status">{STATUS_LABEL[status]}</span>
            {isActive ? <i className="bi bi-chevron-right cat-step__chevron" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

// ── En-tête sticky : statut + progression + CTA ────────────────────────────────
export function CatalogueStatusHeader({
  title,
  visibilityLabel,
  visibilityTone,
  progress,
  saving,
  savedAt,
  canSave,
  onSave,
  onPreview,
  children,
}: {
  title: string;
  visibilityLabel: string;
  visibilityTone: 'success' | 'warning' | 'muted' | 'danger';
  progress: { done: number; total: number };
  saving: boolean;
  savedAt: number;
  canSave: boolean;
  onSave: () => void;
  onPreview?: () => void;
  children?: ReactNode;
}) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <header className="cat-statushead">
      <div className="cat-statushead__top">
        <div className="cat-statushead__id">
          <h2 className="cat-statushead__title">{title || 'Sans titre'}</h2>
          <Badge tone={visibilityTone}>{visibilityLabel}</Badge>
        </div>
        <div className="cat-statushead__actions">
          {onPreview ? (
            <button type="button" className="cat-btn cat-btn--ghost" onClick={onPreview}>
              <i className="bi bi-eye" aria-hidden="true" /> Aperçu
            </button>
          ) : null}
          <button type="button" className="cat-btn cat-btn--primary" disabled={!canSave || saving} onClick={onSave}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
      <div className="cat-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="cat-progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="cat-statushead__hint">
        {progress.done}/{progress.total} modules complets
        {savedAt > 0 && !saving ? ' · Enregistré' : ''}
      </p>
      {children}
    </header>
  );
}

// ── Drawer de validation (bottom-sheet mobile / panneau desktop) ───────────────
export function CatalogueValidationDrawer({
  open,
  issues,
  onClose,
  onGoToModule,
  moduleLabels,
}: {
  open: boolean;
  issues: CatalogueValidationIssue[];
  onClose: () => void;
  onGoToModule: (key: string) => void;
  moduleLabels: Record<string, string>;
}) {
  if (!open) return null;
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return (
    <>
      <div className="cat-overlay" onClick={onClose} aria-hidden="true" />
      <div className="cat-drawer" role="dialog" aria-modal="true" aria-label="Validation" data-testid="cat-validation-drawer">
        <div className="cat-drawer__head">
          <span className="cat-drawer__title">Validation</span>
          <button type="button" className="cat-iconbtn" onClick={onClose} aria-label="Fermer">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="cat-drawer__body">
          {issues.length === 0 ? (
            <p className="cat-note cat-note--success">
              <i className="bi bi-check-circle" aria-hidden="true" /> Tout est prêt pour la publication.
            </p>
          ) : null}
          {errors.length > 0 ? (
            <section className="cat-vsection">
              <h3 className="cat-vsection__title">Bloquants ({errors.length})</h3>
              <ul className="cat-vlist">
                {errors.map((i, idx) => (
                  <li key={`e${idx}`}>
                    <button type="button" className="cat-vitem cat-vitem--error" onClick={() => onGoToModule(i.module)}>
                      <span className="cat-vitem__mod">{moduleLabels[i.module] ?? i.module}</span>
                      <span className="cat-vitem__msg">{i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {warnings.length > 0 ? (
            <section className="cat-vsection">
              <h3 className="cat-vsection__title">Recommandations ({warnings.length})</h3>
              <ul className="cat-vlist">
                {warnings.map((i, idx) => (
                  <li key={`w${idx}`}>
                    <button type="button" className="cat-vitem cat-vitem--warning" onClick={() => onGoToModule(i.module)}>
                      <span className="cat-vitem__mod">{moduleLabels[i.module] ?? i.module}</span>
                      <span className="cat-vitem__msg">{i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ── Coquille d'édition : header + stepper + panneau module ─────────────────────
export function CatalogueEditorShell({
  header,
  stepper,
  children,
}: {
  header: ReactNode;
  stepper: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cat-editor">
      {header}
      <div className="cat-editor__body">
        <div className="cat-editor__rail">{stepper}</div>
        <div className="cat-editor__panel">{children}</div>
      </div>
    </div>
  );
}

// ── Champs de formulaire partagés ──────────────────────────────────────────────
export function CatField({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="cat-field">
      <span className="cat-field__label">
        {label}
        {required ? <span className="cat-field__req" aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="cat-field__hint">{hint}</span> : null}
      {error ? <span className="cat-field__error" role="alert">{error}</span> : null}
    </label>
  );
}

// ── Carte prix (aperçu lisible) ────────────────────────────────────────────────
export function CataloguePriceCard({ price, suffix, note }: { price: number; suffix?: string; note?: string }) {
  const formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(price) || 0);
  return (
    <div className="cat-pricecard">
      <span className="cat-pricecard__value">{formatted}{suffix ? <span className="cat-pricecard__suffix"> {suffix}</span> : null}</span>
      {note ? <span className="cat-pricecard__note">{note}</span> : null}
    </div>
  );
}

// ── Toggle visibilité ──────────────────────────────────────────────────────────
export function CatalogueVisibilityToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="cat-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="cat-toggle__track" aria-hidden="true" />
      <span className="cat-toggle__label">{label}</span>
    </label>
  );
}

// ── Sélecteur de médias (lecture + ajout par URL) ──────────────────────────────
export function CatalogueMediaPicker({
  photos,
  onChange,
  emptyHint,
}: {
  photos: string[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  return (
    <div className="cat-media">
      {photos.length === 0 ? (
        <p className="cat-note">{emptyHint ?? 'Aucun média pour le moment.'}</p>
      ) : (
        <ul className="cat-media__grid">
          {photos.map((url, idx) => (
            <li key={`${url}-${idx}`} className="cat-media__item">
              <img src={url} alt="" loading="lazy" className="cat-media__img" />
              <button
                type="button"
                className="cat-iconbtn cat-media__remove"
                aria-label="Retirer le média"
                onClick={() => onChange(photos.filter((_, i) => i !== idx))}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Carte d'aperçu publique ────────────────────────────────────────────────────
export function CataloguePreviewCard({
  title,
  subtitle,
  price,
  image,
  badge,
}: {
  title: string;
  subtitle?: string;
  price?: number;
  image?: string;
  badge?: string;
}) {
  return (
    <article className="cat-preview">
      <div className="cat-preview__media">
        {image ? <img src={image} alt="" loading="lazy" /> : <span className="cat-preview__ph" aria-hidden="true"><i className="bi bi-image" /></span>}
        {badge ? <span className="cat-preview__badge">{badge}</span> : null}
      </div>
      <div className="cat-preview__body">
        <h4 className="cat-preview__title">{title || 'Sans titre'}</h4>
        {subtitle ? <p className="cat-preview__sub">{subtitle}</p> : null}
        {price !== undefined ? (
          <p className="cat-preview__price">
            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(price) || 0)}
          </p>
        ) : null}
      </div>
    </article>
  );
}

// ── États vides / chargement ───────────────────────────────────────────────────
export function CatalogueEmptyState({
  icon = 'bi-inbox',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cat-empty">
      <i className={`bi ${icon} cat-empty__icon`} aria-hidden="true" />
      <p className="cat-empty__title">{title}</p>
      {description ? <p className="cat-empty__desc">{description}</p> : null}
      {action}
    </div>
  );
}

export function CatalogueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="cat-skeleton" data-testid="cat-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="block" height="76px" />
      ))}
    </div>
  );
}
