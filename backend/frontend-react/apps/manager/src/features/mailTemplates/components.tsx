// M6 — Composants présentationnels Mail Template Studio (mobile-first).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '@bs/ui';
import type {
  MailTemplateSummary,
  MailTemplateVersion,
  MailTemplateRoleBinding,
  MailTemplateVariable,
} from '@bs/api-client';
import { getTemplateRoleBinding } from '@bs/api-client';

export function TemplateStatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = { published: 'Publié', draft: 'Brouillon', archived: 'Archivé' };
  const variant = status === 'published' ? 'published' : status === 'draft' ? 'draft' : 'archived';
  return <span className={`mt-badge mt-badge--${variant}`}>{map[String(status || '')] || status || '—'}</span>;
}

export function TemplateModeBadge({ mode }: { mode: string | null | undefined }) {
  if (!mode) return null;
  const variant = mode === 'active' ? 'active' : 'shadow';
  return <span className={`mt-badge mt-badge--${variant}`}>{mode}</span>;
}

export function TemplateRoleBindingCard({ binding }: { binding: MailTemplateRoleBinding }) {
  return (
    <Card>
      <div className="mt-binding">
        <strong>Liaison rôle</strong>
        {binding.wired ? (
          <>
            <div className="mt-binding__row">
              <span className="mt-kv"><span className="mt-kv__k">De :</span><span>{binding.fromRole}</span></span>
              <span className="mt-kv"><span className="mt-kv__k">Vers :</span><span>{binding.toRole}</span></span>
              <span className="mt-kv"><span className="mt-kv__k">Événement :</span><span>{binding.eventName}</span></span>
              <span className="mt-kv"><span className="mt-kv__k">Mode :</span><TemplateModeBadge mode={binding.mode} /></span>
            </div>
            {binding.directSenderExists ? <p className="mt-note">Un envoi direct legacy existe (moteur en shadow).</p> : null}
          </>
        ) : (
          <p className="mt-note">Template non câblé au moteur événementiel (envoi direct legacy).</p>
        )}
        <p className="mt-note">
          Les templates ne stockent pas d'adresse e-mail. L'expéditeur et le destinataire sont résolus
          au moment de l'envoi (identités gérées dans le Communication Center).
        </p>
      </div>
    </Card>
  );
}

export function TemplateVariablesPanel({
  used,
  unknown,
  catalog,
}: {
  used: MailTemplateVariable[];
  unknown: string[];
  catalog: string[];
}) {
  const [open, setOpen] = useState(false);
  const copy = (name: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(`{{${name}}}`);
    }
  };
  return (
    <Card>
      <div className="mt-vars">
        <strong>Variables</strong>
        <span className="mt-note">Utilisées dans le contenu (cliquer pour copier) :</span>
        <div className="mt-chips">
          {used.length === 0 ? <span className="mt-note">Aucune.</span> : used.map((v) => (
            <button type="button" key={v.name} className={`mt-chip ${v.known ? '' : 'mt-chip--unknown'}`.trim()} onClick={() => copy(v.name)}>
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
        {unknown.length > 0 ? (
          <p className="mt-warning">Variables inconnues (non supportées) : {unknown.join(', ')}</p>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? 'Masquer les variables disponibles' : 'Voir les variables disponibles'}
        </Button>
        {open ? (
          <div className="mt-chips">
            {catalog.map((name) => (
              <button type="button" key={name} className="mt-chip" onClick={() => copy(name)}>{`{{${name}}}`}</button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export type PreviewDevice = 'mobile' | 'desktop';
export function TemplatePreviewDeviceToggle({ device, onChange }: { device: PreviewDevice; onChange: (d: PreviewDevice) => void }) {
  return (
    <div className="mt-preview__device" role="group" aria-label="Aperçu appareil">
      <button type="button" className={`mt-device-btn ${device === 'mobile' ? 'mt-device-btn--active' : ''}`.trim()} onClick={() => onChange('mobile')}>Mobile</button>
      <button type="button" className={`mt-device-btn ${device === 'desktop' ? 'mt-device-btn--active' : ''}`.trim()} onClick={() => onChange('desktop')}>Desktop</button>
    </div>
  );
}

export function TemplatePreviewPane({ subject, html, text }: { subject: string; html: string; text: string }) {
  const [device, setDevice] = useState<PreviewDevice>('mobile');
  return (
    <Card>
      <div className="mt-preview">
        <strong>Aperçu (sans envoi)</strong>
        <div className="mt-preview__subject">Objet : {subject || '—'}</div>
        <TemplatePreviewDeviceToggle device={device} onChange={setDevice} />
        <div className="mt-preview__frame-wrap">
          {/* iframe sandbox SANS allow-scripts : aucun script ni chargement actif n'est exécuté. */}
          <iframe
            title="Aperçu e-mail"
            className={`mt-preview__frame ${device === 'mobile' ? 'mt-preview__frame--mobile' : ''}`.trim()}
            sandbox=""
            srcDoc={html || '<p style="font-family:sans-serif">(HTML vide)</p>'}
          />
        </div>
        {text ? (
          <details>
            <summary>Version texte</summary>
            <div className="mt-preview__text">{text}</div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

export function MailTemplateList({ items }: { items: MailTemplateSummary[] }) {
  if (!items.length) return <div className="mt-empty">Aucun template pour ces filtres.</div>;
  return (
    <div className="mt-list">
      {items.map((t) => {
        const binding = getTemplateRoleBinding(t.functionName);
        return (
          <Card className="mt-item" key={t.functionName}>
            <div className="mt-item__top">
              <span className="mt-item__title">{t.functionName}</span>
              {t.isMetadataOnly ? <span className="mt-badge mt-badge--draft">À configurer</span> : <span className="mt-badge mt-badge--published">Publié</span>}
            </div>
            <div className="mt-item__meta">
              <span className="mt-kv"><span className="mt-kv__k">Destinataire :</span><span>{t.recipient}</span></span>
              {binding.wired ? (
                <>
                  <span className="mt-kv"><span className="mt-kv__k">Rôles :</span><span>{binding.fromRole} → {binding.toRole}</span></span>
                  <span className="mt-kv"><span className="mt-kv__k">Événement :</span><span>{binding.eventName}</span></span>
                  <TemplateModeBadge mode={binding.mode} />
                </>
              ) : <span className="mt-note">non câblé</span>}
            </div>
            <div className="mt-item__actions">
              <Link className="bs-btn" to={`/dev/email-templates/${encodeURIComponent(t.functionName)}`}>Éditer</Link>
              <Link className="bs-btn bs-btn--secondary" to={`/dev/email-templates/${encodeURIComponent(t.functionName)}/versions`}>Versions</Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function TemplateVersionList({
  versions,
  onRollback,
  onArchive,
  busy,
}: {
  versions: MailTemplateVersion[];
  onRollback: (version: number) => void;
  onArchive: (id: string) => void;
  busy: boolean;
}) {
  if (!versions.length) return <div className="mt-empty">Aucune version.</div>;
  return (
    <div className="mt-list">
      {versions.map((v) => (
        <Card className="mt-item" key={`${v.version}-${v._id ?? ''}`}>
          <div className="mt-item__top">
            <span className="mt-item__title">v{v.version} — {v.subject || '(sans objet)'}</span>
            <TemplateStatusBadge status={v.status} />
          </div>
          <div className="mt-item__meta">
            <span className="mt-kv"><span className="mt-kv__k">Publié le :</span><span>{v.publishedAt ? new Date(v.publishedAt).toLocaleString('fr-FR') : '—'}</span></span>
            {v.archivedAt ? <span className="mt-kv"><span className="mt-kv__k">Archivé le :</span><span>{new Date(v.archivedAt).toLocaleString('fr-FR')}</span></span> : null}
          </div>
          <div className="mt-item__actions">
            {v.status !== 'published' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onRollback(v.version)}>Restaurer cette version</Button>
            ) : <span className="mt-success">Version active</span>}
            {v.status === 'draft' && v._id ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onArchive(v._id as string)}>Archiver</Button>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function MobileTemplateToolbar({ canSave, saving, onSave, onTogglePreview, previewOpen }: {
  canSave: boolean; saving: boolean; onSave: () => void; onTogglePreview: () => void; previewOpen: boolean;
}) {
  return (
    <div className="mt-toolbar mt-preview-toggle">
      <Button type="button" variant="secondary" onClick={onTogglePreview}>{previewOpen ? 'Masquer l’aperçu' : 'Aperçu'}</Button>
      <Button type="button" disabled={!canSave || saving} onClick={onSave}>{saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button>
    </div>
  );
}
