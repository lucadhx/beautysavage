// M7 — Composants présentationnels Notification Studio (mobile-first).
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '@bs/ui';
import type {
  NotificationTemplate,
  NotificationTemplateVersion,
  NotificationTemplateVariable,
  NotificationCategory,
} from '@bs/api-client';

export function NotificationStatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = { published: 'Publié', draft: 'Brouillon', archived: 'Archivé' };
  const variant = status === 'published' ? 'published' : status === 'draft' ? 'draft' : 'archived';
  return <span className={`ns-badge ns-badge--${variant}`}>{map[String(status || '')] || status || '—'}</span>;
}

export function NotificationPriorityBadge({ priority }: { priority: string | null | undefined }) {
  const p = String(priority || 'normal');
  return <span className={`ns-badge ns-badge--${p}`}>{p}</span>;
}

export function NotificationCategoryBadge({ category }: { category: NotificationCategory | null | undefined }) {
  if (!category) return <span className="ns-badge ns-badge--archived">Sans catégorie</span>;
  const style: CSSProperties = category.color ? { borderColor: category.color, color: category.color } : {};
  return (
    <span className="ns-badge ns-badge--cat" style={style}>
      <i className={category.icon || 'bi-bell'} aria-hidden="true" /> {category.name}
    </span>
  );
}

export function NotificationVariablesPanel({
  used,
  unknown,
  catalog,
}: {
  used: NotificationTemplateVariable[];
  unknown: string[];
  catalog: string[];
}) {
  const copy = (name: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(`{{${name}}}`);
  };
  return (
    <Card>
      <div className="ns-page">
        <strong>Variables</strong>
        <span className="ns-note">Utilisées (cliquer pour copier) :</span>
        <div className="ns-chips">
          {used.length === 0 ? <span className="ns-note">Aucune.</span> : used.map((v) => (
            <button type="button" key={v.name} className={`ns-chip ${v.known ? '' : 'ns-chip--unknown'}`.trim()} onClick={() => copy(v.name)}>{`{{${v.name}}}`}</button>
          ))}
        </div>
        {unknown.length > 0 ? <p className="ns-warning">Variables inconnues (non supportées) : {unknown.join(', ')}</p> : null}
        <span className="ns-note">Disponibles :</span>
        <div className="ns-chips">
          {catalog.map((name) => (
            <button type="button" key={name} className="ns-chip" onClick={() => copy(name)}>{`{{${name}}}`}</button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function PreviewCard({ variant, category, title, body, priority, persistent }: {
  variant: 'toast' | 'drawer' | 'center';
  category: NotificationCategory | null;
  title: string;
  body: string;
  priority: string;
  persistent: boolean;
}) {
  const accent = category?.color || '';
  const cardStyle: CSSProperties = variant === 'toast' && accent ? { borderLeftColor: accent } : {};
  const iconStyle: CSSProperties = accent ? { color: accent } : {};
  return (
    <div className={`ns-pv-card ${variant === 'toast' ? 'ns-pv-card--toast' : ''}`.trim()} style={cardStyle}>
      <i className={`ns-pv-icon ${category?.icon || 'bi-bell'}`} style={iconStyle} aria-hidden="true" />
      <div className="ns-pv-body">
        <span className="ns-pv-title">{title || '(titre vide)'}</span>
        <span className="ns-pv-text">{body || '(message vide)'}</span>
        <div className="ns-pv-meta">
          <NotificationPriorityBadge priority={priority} />
          {persistent ? <span className="ns-badge ns-badge--high">persistant</span> : null}
          {category ? <NotificationCategoryBadge category={category} /> : null}
        </div>
      </div>
    </div>
  );
}

export function NotificationPreview({ category, title, body, priority, persistent }: {
  category: NotificationCategory | null;
  title: string;
  body: string;
  priority: string;
  persistent: boolean;
}) {
  return (
    <Card>
      <div className="ns-preview">
        <strong>Aperçu (sans envoi)</strong>
        <div className="ns-preview__group">
          <span className="ns-note">Toast</span>
          <PreviewCard variant="toast" category={category} title={title} body={body} priority={priority} persistent={persistent} />
        </div>
        <div className="ns-preview__group">
          <span className="ns-note">Drawer / centre de notifications</span>
          <PreviewCard variant="center" category={category} title={title} body={body} priority={priority} persistent={persistent} />
        </div>
      </div>
    </Card>
  );
}

export function NotificationTemplateList({ items, categories }: { items: NotificationTemplate[]; categories: NotificationCategory[] }) {
  if (!items.length) return <div className="ns-empty">Aucun template pour ces filtres.</div>;
  const catById = new Map(categories.map((c) => [c.id, c]));
  return (
    <div className="ns-list">
      {items.map((t) => (
        <Card className="ns-item" key={t.templateKey}>
          <div className="ns-item__top">
            <span className="ns-item__title">{t.templateKey}</span>
            <span className="ns-item__actions">
              <NotificationStatusBadge status={t.status} />
              <NotificationPriorityBadge priority={t.priority} />
            </span>
          </div>
          <div className="ns-item__meta">
            <span>{t.title || '(sans titre)'}</span>
            {t.categoryId ? <NotificationCategoryBadge category={catById.get(t.categoryId) ?? null} /> : <span className="ns-note">sans catégorie</span>}
            {t.persistent ? <span className="ns-note">persistant</span> : null}
            {t.action ? <span className="ns-note">action: {t.action}</span> : null}
          </div>
          <div className="ns-item__actions">
            <Link className="bs-btn" to={`/dev/notification-templates/${encodeURIComponent(t.templateKey)}`}>Éditer</Link>
            <Link className="bs-btn bs-btn--secondary" to={`/dev/notification-templates/${encodeURIComponent(t.templateKey)}/versions`}>Versions</Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function NotificationVersionList({ versions, busy, onRollback, onArchive }: {
  versions: NotificationTemplateVersion[];
  busy: boolean;
  onRollback: (version: number) => void;
  onArchive: (id: string) => void;
}) {
  if (!versions.length) return <div className="ns-empty">Aucune version.</div>;
  return (
    <div className="ns-list">
      {versions.map((v) => (
        <Card className="ns-item" key={`${v.version}-${v.id}`}>
          <div className="ns-item__top">
            <span className="ns-item__title">v{v.version} — {v.title || '(sans titre)'}</span>
            <NotificationStatusBadge status={v.status} />
          </div>
          <div className="ns-item__meta">
            <span>Publié : {v.publishedAt ? new Date(v.publishedAt).toLocaleString('fr-FR') : '—'}</span>
            <NotificationPriorityBadge priority={v.priority} />
          </div>
          <div className="ns-item__actions">
            {v.status !== 'published' ? <Button type="button" variant="secondary" disabled={busy} onClick={() => onRollback(v.version)}>Restaurer</Button> : <span className="ns-success">Active</span>}
            {v.status === 'draft' ? <Button type="button" variant="secondary" disabled={busy} onClick={() => onArchive(v.id)}>Archiver</Button> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
