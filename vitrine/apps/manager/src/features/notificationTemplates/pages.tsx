// M7 — Pages Notification Studio : dashboard (liste + nouveau), éditeur, versions.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, LoadingState, ErrorState } from '@bs/ui';
import {
  listNotificationTemplates,
  listNotificationCategories,
  listNotificationTemplateVersions,
  rollbackNotificationTemplate,
  archiveNotificationTemplateDraft,
} from '@bs/api-client';
import { NotificationTemplateList, NotificationVersionList } from './components';
import { NotificationTemplateEditor } from './NotificationTemplateEditor';

export function NotificationTemplateDashboard() {
  const navigate = useNavigate();
  const tpl = useQuery({ queryKey: ['notif-templates'], queryFn: listNotificationTemplates, retry: false });
  const cats = useQuery({ queryKey: ['notif-categories'], queryFn: listNotificationCategories, retry: false });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [newKey, setNewKey] = useState('');

  const items = useMemo(() => {
    let list = tpl.data ?? [];
    if (search.trim()) list = list.filter((t) => t.templateKey.includes(search.trim().toLowerCase()));
    if (statusFilter) list = list.filter((t) => t.status === statusFilter);
    return [...list].sort((a, b) => a.templateKey.localeCompare(b.templateKey));
  }, [tpl.data, search, statusFilter]);

  if (tpl.status === 'pending') return <LoadingState label="Chargement des templates…" />;
  if (tpl.status === 'error') return <ErrorState title="Impossible de charger les templates." />;

  const slug = newKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

  return (
    <div className="ns-page">
      <Card>
        <div className="ns-page">
          <div className="ns-field">
            <label className="ns-label" htmlFor="ns-new">Nouveau template (clé)</label>
            <input id="ns-new" className="ns-input" type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="ex. new_sale" />
          </div>
          <div className="ns-actions">
            <Button type="button" disabled={!slug} onClick={() => navigate(`/dev/notification-templates/${encodeURIComponent(slug)}`)}>Créer / éditer</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="ns-filters">
          <div className="ns-field">
            <label className="ns-label" htmlFor="ns-search">Recherche</label>
            <input id="ns-search" className="ns-input" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex. new_sale" />
          </div>
          <div className="ns-field">
            <label className="ns-label" htmlFor="ns-status">Statut</label>
            <select id="ns-status" className="ns-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="published">Publié</option>
              <option value="draft">Brouillon</option>
              <option value="archived">Archivé</option>
            </select>
          </div>
        </div>
      </Card>

      <NotificationTemplateList items={items} categories={cats.data ?? []} />
    </div>
  );
}

export function NotificationTemplateEditorPage() {
  const { templateKey = '' } = useParams();
  return (
    <div className="ns-page">
      <Link className="ns-back" to="/dev/notification-templates">← Tous les templates</Link>
      <div className="ns-head"><h2 className="ns-head__title">{templateKey}</h2></div>
      <NotificationTemplateEditor templateKey={templateKey} />
    </div>
  );
}

export function NotificationTemplateVersionsPage() {
  const { templateKey = '' } = useParams();
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['notif-template-versions', templateKey], queryFn: () => listNotificationTemplateVersions(templateKey), retry: false });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notif-template-versions', templateKey] });
  const rollbackMut = useMutation({ mutationFn: (v: number) => rollbackNotificationTemplate(templateKey, v), onSuccess: invalidate });
  const archiveMut = useMutation({ mutationFn: (id: string) => archiveNotificationTemplateDraft(id), onSuccess: invalidate });
  const busy = rollbackMut.isPending || archiveMut.isPending;

  return (
    <div className="ns-page">
      <Link className="ns-back" to={`/dev/notification-templates/${encodeURIComponent(templateKey)}`}>← Éditeur</Link>
      <div className="ns-head"><h2 className="ns-head__title">Versions — {templateKey}</h2></div>
      {status === 'pending' ? <LoadingState label="Chargement…" /> : status === 'error' ? <ErrorState title="Impossible de charger les versions." /> : (
        <NotificationVersionList versions={data} busy={busy} onRollback={(v) => rollbackMut.mutate(v)} onArchive={(id) => archiveMut.mutate(id)} />
      )}
    </div>
  );
}
