// M6 — Champs d'édition + panneaux publication/rollback du Template Studio.
import { Button, Card } from '@bs/ui';

export function TemplateSubjectEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-field">
      <label className="mt-label" htmlFor="mt-subject">Objet</label>
      <input id="mt-subject" className="mt-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Objet de l'e-mail (variables {{...}} autorisées)" />
    </div>
  );
}

export function TemplateHtmlEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-field">
      <label className="mt-label" htmlFor="mt-html">Contenu HTML</label>
      <textarea id="mt-html" className="mt-textarea" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder="<p>Bonjour {{firstname}}…</p>" />
    </div>
  );
}

export function TemplateTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-field">
      <label className="mt-label" htmlFor="mt-text">Version texte (fallback)</label>
      <textarea id="mt-text" className="mt-textarea" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder="Bonjour {{firstname}}…" />
    </div>
  );
}

export function TemplatePublishPanel({
  hasDraft,
  publishing,
  onPublish,
  lastPublishedVersion,
}: {
  hasDraft: boolean;
  publishing: boolean;
  onPublish: () => void;
  lastPublishedVersion: number | null;
}) {
  return (
    <Card>
      <div className="mt-binding">
        <strong>Publication</strong>
        <p className="mt-note">
          {lastPublishedVersion ? `Version publiée actuelle : v${lastPublishedVersion}.` : 'Aucune version publiée.'}
        </p>
        {hasDraft ? (
          <div className="mt-actions">
            <Button type="button" disabled={publishing} onClick={onPublish}>
              {publishing ? 'Publication…' : 'Publier le brouillon'}
            </Button>
          </div>
        ) : (
          <p className="mt-note">Enregistrez d'abord un brouillon pour pouvoir publier.</p>
        )}
      </div>
    </Card>
  );
}

export function TemplateRollbackPanel({
  versions,
  busy,
  onRollback,
}: {
  versions: { version: number; status: string | null }[];
  busy: boolean;
  onRollback: (version: number) => void;
}) {
  const candidates = versions.filter((v) => v.status !== 'published');
  if (!candidates.length) return null;
  return (
    <Card>
      <div className="mt-binding">
        <strong>Restaurer une version</strong>
        <p className="mt-note">Le rollback publie une nouvelle version à partir d'une version antérieure.</p>
        <div className="mt-actions">
          {candidates.slice(0, 5).map((v) => (
            <Button key={v.version} type="button" variant="secondary" disabled={busy} onClick={() => onRollback(v.version)}>
              Restaurer v{v.version}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
