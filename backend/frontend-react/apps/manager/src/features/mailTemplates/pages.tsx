// M6 — Pages Mail Template Studio : liste (dashboard), éditeur, versions.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, LoadingState, ErrorState } from '@bs/ui';
import {
  listMailTemplates,
  listMailTemplateVersions,
  rollbackMailTemplate,
  archiveMailTemplateDraft,
  getTemplateRoleBinding,
} from '@bs/api-client';
import { MailTemplateList, TemplateVersionList } from './components';
import { MailTemplateEditor } from './MailTemplateEditor';

export function MailTemplateStudioDashboard() {
  const { data, status } = useQuery({ queryKey: ['mail-templates'], queryFn: listMailTemplates, retry: false });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const items = useMemo(() => {
    let list = data ?? [];
    if (search.trim()) list = list.filter((t) => t.functionName.includes(search.trim().toLowerCase()));
    if (statusFilter) list = list.filter((t) => (statusFilter === 'configured' ? !t.isMetadataOnly : t.isMetadataOnly));
    if (roleFilter) list = list.filter((t) => {
      const b = getTemplateRoleBinding(t.functionName);
      return b.fromRole === roleFilter || b.toRole === roleFilter;
    });
    return [...list].sort((a, b) => a.functionName.localeCompare(b.functionName));
  }, [data, search, statusFilter, roleFilter]);

  if (status === 'pending') return <LoadingState label="Chargement des templates…" />;
  if (status === 'error') return <ErrorState title="Impossible de charger les templates." />;

  return (
    <div className="mt-page">
      <Card>
        <div className="mt-filters">
          <div className="mt-field">
            <label className="mt-label" htmlFor="mt-search">Recherche</label>
            <input id="mt-search" className="mt-input" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex. refund_confirmed" />
          </div>
          <div className="mt-field">
            <label className="mt-label" htmlFor="mt-status">Statut</label>
            <select id="mt-status" className="mt-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="configured">Configurés</option>
              <option value="metadata">À configurer</option>
            </select>
          </div>
          <div className="mt-field">
            <label className="mt-label" htmlFor="mt-role">Rôle</label>
            <select id="mt-role" className="mt-input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="commerciale">commerciale</option>
              <option value="support">support</option>
              <option value="client">client</option>
            </select>
          </div>
        </div>
      </Card>
      <MailTemplateList items={items} />
    </div>
  );
}

export function MailTemplateEditorPage() {
  const { templateKey = '' } = useParams();
  return (
    <div className="mt-page">
      <Link className="mt-back" to="/dev/email-templates">← Tous les templates</Link>
      <div className="mt-head"><h2 className="mt-head__title">{templateKey}</h2></div>
      <MailTemplateEditor functionName={templateKey} />
    </div>
  );
}

export function TemplateVersionsPage() {
  const { templateKey = '' } = useParams();
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['mail-template-versions', templateKey], queryFn: () => listMailTemplateVersions(templateKey), retry: false });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['mail-template-versions', templateKey] });
  const rollbackMut = useMutation({ mutationFn: (version: number) => rollbackMailTemplate(templateKey, version), onSuccess: invalidate });
  const archiveMut = useMutation({ mutationFn: (id: string) => archiveMailTemplateDraft(id), onSuccess: invalidate });
  const busy = rollbackMut.isPending || archiveMut.isPending;

  return (
    <div className="mt-page">
      <Link className="mt-back" to={`/dev/email-templates/${encodeURIComponent(templateKey)}`}>← Éditeur</Link>
      <div className="mt-head"><h2 className="mt-head__title">Versions — {templateKey}</h2></div>
      {status === 'pending' ? (
        <LoadingState label="Chargement des versions…" />
      ) : status === 'error' ? (
        <ErrorState title="Impossible de charger les versions." />
      ) : (
        <TemplateVersionList versions={data} busy={busy} onRollback={(v) => rollbackMut.mutate(v)} onArchive={(id) => archiveMut.mutate(id)} />
      )}
    </div>
  );
}
