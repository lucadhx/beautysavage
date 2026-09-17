// M13 — Composants présentationnels du Gift Card Template Studio (mobile-first, tokens --bs-*).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '@bs/ui';
import type { GiftCardTemplate } from '@bs/api-client';

export function GiftCardStatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = { published: 'Publié', draft: 'Brouillon', archived: 'Archivé' };
  const variant = status === 'published' ? 'published' : status === 'draft' ? 'draft' : 'archived';
  return <span className={`gct-badge gct-badge--${variant}`}>{map[String(status || '')] || status || '—'}</span>;
}

export function GiftCardTemplateList({ templates }: { templates: GiftCardTemplate[] }) {
  if (!templates.length) return <div className="gct-empty">Aucun template.</div>;
  return (
    <div className="gct-list" data-testid="gct-list">
      {templates.map((t) => (
        <Card className="gct-item" key={t.id}>
          <div className="gct-item__top">
            <span className="gct-item__title">{t.name} <span className="gct-item__slug">/{t.slug}</span></span>
            <span className="gct-item__badges">
              {t.active ? <span className="gct-badge gct-badge--active">Actif</span> : null}
              <GiftCardStatusBadge status={t.status} />
            </span>
          </div>
          <div className="gct-item__meta">
            <span className="gct-kv"><span className="gct-kv__k">Version :</span><span>v{t.version}</span></span>
            <span className="gct-kv"><span className="gct-kv__k">Visible :</span><span>{t.visible ? 'oui' : 'non'}</span></span>
            {t.isSystemDefault ? <span className="gct-kv"><span className="gct-kv__k">Système :</span><span>par défaut</span></span> : null}
          </div>
          <div className="gct-item__actions">
            <Link className="bs-btn" to={`/dev/gift-card-templates/${encodeURIComponent(t.slug)}`}>Éditer</Link>
            <Link className="bs-btn bs-btn--secondary" to={`/dev/gift-card-templates/${encodeURIComponent(t.slug)}/versions`}>Versions</Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export type PreviewDevice = 'mobile' | 'desktop';
export function GiftCardPreviewDeviceToggle({ device, onChange }: { device: PreviewDevice; onChange: (d: PreviewDevice) => void }) {
  return (
    <div className="gct-preview__device" role="group" aria-label="Aperçu appareil">
      <button type="button" className={`gct-device-btn ${device === 'mobile' ? 'gct-device-btn--active' : ''}`.trim()} onClick={() => onChange('mobile')}>Mobile</button>
      <button type="button" className={`gct-device-btn ${device === 'desktop' ? 'gct-device-btn--active' : ''}`.trim()} onClick={() => onChange('desktop')}>Desktop</button>
    </div>
  );
}

export function GiftCardPreviewPane({ html, pending }: { html: string; pending?: boolean }) {
  const [device, setDevice] = useState<PreviewDevice>('mobile');
  return (
    <Card>
      <div className="gct-preview">
        <strong>Aperçu live (QR factice, sans envoi)</strong>
        <GiftCardPreviewDeviceToggle device={device} onChange={setDevice} />
        <div className="gct-preview__frame-wrap">
          {/* iframe sandbox="" : aucun script ni chargement actif n'est exécuté. */}
          <iframe
            title="Aperçu carte cadeau"
            data-testid="gct-preview-frame"
            className={`gct-preview__frame ${device === 'mobile' ? 'gct-preview__frame--mobile' : ''}`.trim()}
            sandbox=""
            srcDoc={html || '<p style="font-family:sans-serif">(aperçu vide)</p>'}
          />
        </div>
        {pending ? <p className="gct-note">Rendu en cours…</p> : null}
      </div>
    </Card>
  );
}

export function GiftCardVariablesPanel({ variables }: { variables: string[] }) {
  const [open, setOpen] = useState(false);
  const copy = (name: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(`{{${name}}}`);
  };
  return (
    <Card>
      <div className="gct-vars">
        <strong>Variables disponibles</strong>
        <Button type="button" variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? 'Masquer les variables' : 'Voir les variables'}
        </Button>
        {open ? (
          <div className="gct-chips">
            {variables.map((name) => (
              <button type="button" key={name} className="gct-chip" onClick={() => copy(name)}>{`{{${name}}}`}</button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function GiftCardVersionList({ versions, busy, onRollback }: {
  versions: GiftCardTemplate[]; busy: boolean; onRollback: (version: number) => void;
}) {
  if (!versions.length) return <div className="gct-empty">Aucune version.</div>;
  return (
    <div className="gct-list" data-testid="gct-versions">
      {versions.map((v) => (
        <Card className="gct-item" key={`${v.version}-${v.id}`}>
          <div className="gct-item__top">
            <span className="gct-item__title">v{v.version} — {v.name}</span>
            <GiftCardStatusBadge status={v.status} />
          </div>
          <div className="gct-item__meta">
            <span className="gct-kv"><span className="gct-kv__k">Publié le :</span><span>{v.publishedAt ? new Date(v.publishedAt).toLocaleString('fr-FR') : '—'}</span></span>
          </div>
          <div className="gct-item__actions">
            {v.status !== 'published' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onRollback(v.version)}>Restaurer cette version</Button>
            ) : <span className="gct-success">Version active</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
