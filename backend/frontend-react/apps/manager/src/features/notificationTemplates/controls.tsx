// M7 — Contrôles d'édition Notification Studio. Aucun scope/targetRole ici (le moteur le choisit).
import { Button, Card } from '@bs/ui';
import { NOTIFICATION_PRIORITIES, NOTIFICATION_ACTIONS, type NotificationCategory, type NotificationPriority } from '@bs/api-client';

export function NotificationCategorySelector({ categories, value, onChange }: {
  categories: NotificationCategory[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="ns-field">
      <label className="ns-label" htmlFor="ns-category">Catégorie</label>
      <select id="ns-category" className="ns-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Sans catégorie</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

export function NotificationPrioritySelector({ value, onChange }: { value: NotificationPriority; onChange: (p: NotificationPriority) => void }) {
  return (
    <div className="ns-field">
      <label className="ns-label" htmlFor="ns-priority">Priorité</label>
      <select id="ns-priority" className="ns-select" value={value} onChange={(e) => onChange(e.target.value as NotificationPriority)}>
        {NOTIFICATION_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}

export function NotificationPersistentToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="ns-field">
      <span className="ns-label">Persistant</span>
      <label className="ns-toggle">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className="ns-note">Reste jusqu'au traitement (notification importante)</span>
      </label>
    </div>
  );
}

export function NotificationActionSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ns-field">
      <label className="ns-label" htmlFor="ns-action">Action métier</label>
      <select id="ns-action" className="ns-select" value={value || 'none'} onChange={(e) => onChange(e.target.value)}>
        {NOTIFICATION_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <span className="ns-note">Action métier (jamais une URL). La navigation est décidée par le panel.</span>
    </div>
  );
}

export function NotificationPublishPanel({ hasDraft, publishing, onPublish, lastPublishedVersion }: {
  hasDraft: boolean; publishing: boolean; onPublish: () => void; lastPublishedVersion: number | null;
}) {
  return (
    <Card>
      <div className="ns-page">
        <strong>Publication</strong>
        <p className="ns-note">{lastPublishedVersion ? `Version publiée : v${lastPublishedVersion}.` : 'Aucune version publiée.'}</p>
        {hasDraft ? (
          <div className="ns-actions"><Button type="button" disabled={publishing} onClick={onPublish}>{publishing ? 'Publication…' : 'Publier le brouillon'}</Button></div>
        ) : <p className="ns-note">Enregistrez un brouillon pour pouvoir publier.</p>}
      </div>
    </Card>
  );
}

export function NotificationRollbackPanel({ versions, busy, onRollback }: {
  versions: { version: number; status: string | null }[]; busy: boolean; onRollback: (v: number) => void;
}) {
  const candidates = versions.filter((v) => v.status !== 'published');
  if (!candidates.length) return null;
  return (
    <Card>
      <div className="ns-page">
        <strong>Restaurer une version</strong>
        <p className="ns-note">Le rollback publie une nouvelle version à partir d'une version antérieure.</p>
        <div className="ns-actions">
          {candidates.slice(0, 5).map((v) => (
            <Button key={v.version} type="button" variant="secondary" disabled={busy} onClick={() => onRollback(v.version)}>Restaurer v{v.version}</Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
