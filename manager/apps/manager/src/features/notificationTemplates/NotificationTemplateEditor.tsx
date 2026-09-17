// M7 — Éditeur d'un template de notification : contenu + catégorie + priorité + persistent + action,
// preview live (front), draft→publish→rollback. AUCUN scope/targetRole (le moteur le choisit). react-query.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, LoadingState, ErrorState } from '@bs/ui';
import {
  ApiError,
  getNotificationTemplate,
  listNotificationTemplateVersions,
  listNotificationCategories,
  createNotificationTemplateDraft,
  publishNotificationTemplateDraft,
  rollbackNotificationTemplate,
  previewNotificationTemplate,
  NOTIFICATION_KNOWN_VARIABLES,
  type NotificationPriority,
} from '@bs/api-client';
import { NotificationCategorySelector, NotificationPrioritySelector, NotificationPersistentToggle, NotificationActionSelector, NotificationPublishPanel, NotificationRollbackPanel } from './controls';
import { NotificationVariablesPanel, NotificationPreview } from './components';
import { MOCK_NOTIFICATION_VARS } from './mock';

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 ? 'Accès réservé.' : err.message || 'Erreur.';
  return 'Une erreur est survenue.';
}

interface Draft {
  title: string; body: string; categoryId: string | null;
  variables: string[]; priority: NotificationPriority; persistent: boolean; action: string;
}
const EMPTY: Draft = { title: '', body: '', categoryId: null, variables: [], priority: 'normal', persistent: false, action: 'none' };

export function NotificationTemplateEditor({ templateKey }: { templateKey: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadedKey, setLoadedKey] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  const tplQuery = useQuery({ queryKey: ['notif-template', templateKey], queryFn: () => getNotificationTemplate(templateKey), retry: false });
  const versionsQuery = useQuery({ queryKey: ['notif-template-versions', templateKey], queryFn: () => listNotificationTemplateVersions(templateKey), retry: false });
  const catsQuery = useQuery({ queryKey: ['notif-categories'], queryFn: listNotificationCategories, retry: false });

  useEffect(() => {
    if (tplQuery.status === 'success' && loadedKey !== templateKey) {
      const t = tplQuery.data;
      setDraft(t ? { title: t.title || '', body: t.body || '', categoryId: t.categoryId, variables: t.variables ?? [], priority: t.priority, persistent: t.persistent, action: t.action || 'none' } : { ...EMPTY });
      setDraftId(null);
      setLoadedKey(templateKey);
    }
  }, [tplQuery.status, tplQuery.data, templateKey, loadedKey]);

  const categories = useMemo(() => catsQuery.data ?? [], [catsQuery.data]);
  const selectedCategory = useMemo(() => categories.find((c) => c.id === draft.categoryId) ?? null, [categories, draft.categoryId]);
  const catalog = useMemo(() => Array.from(new Set([...NOTIFICATION_KNOWN_VARIABLES, ...draft.variables])), [draft.variables]);
  const preview = useMemo(() => previewNotificationTemplate({ title: draft.title, body: draft.body, variables: MOCK_NOTIFICATION_VARS }), [draft.title, draft.body]);
  const unknownVars = useMemo(() => preview.usedVariables.filter((v) => !catalog.includes(v.name)).map((v) => v.name), [preview, catalog]);

  const lastPublishedVersion = useMemo(() => (versionsQuery.data ?? []).find((v) => v.status === 'published')?.version ?? null, [versionsQuery.data]);
  const canSave = draft.title.trim().length > 0 && draft.body.trim().length > 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notif-template', templateKey] });
    void qc.invalidateQueries({ queryKey: ['notif-template-versions', templateKey] });
  };

  const saveMut = useMutation({
    mutationFn: () => createNotificationTemplateDraft(templateKey, draft),
    onSuccess: (d) => { setActionError(null); setDraftId(d.id); setSavedAt(Date.now()); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });
  const publishMut = useMutation({
    mutationFn: () => { if (!draftId) throw new ApiError({ status: 400, code: null, message: 'Enregistrez un brouillon.', body: null }); return publishNotificationTemplateDraft(draftId); },
    onSuccess: () => { setActionError(null); setDraftId(null); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });
  const rollbackMut = useMutation({
    mutationFn: (version: number) => rollbackNotificationTemplate(templateKey, version),
    onSuccess: () => { setActionError(null); setLoadedKey(''); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });

  if (tplQuery.status === 'pending') return <LoadingState label="Chargement du template…" />;
  if (tplQuery.status === 'error') {
    const denied = tplQuery.error instanceof ApiError && tplQuery.error.status === 403;
    return <ErrorState title={denied ? 'Accès réservé.' : 'Impossible de charger le template.'} />;
  }

  const onSave = () => saveMut.mutate();
  const setVarsFromText = (text: string) => setDraft((d) => ({ ...d, variables: text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) }));

  return (
    <div className="ns-page">
      <div className="ns-editor">
        <div className="ns-page">
          <Card>
            <div className="ns-page">
              <div className="ns-field">
                <label className="ns-label" htmlFor="ns-title">Titre</label>
                <input id="ns-title" className="ns-input" type="text" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Nouvelle vente {{amount}}" />
              </div>
              <div className="ns-field">
                <label className="ns-label" htmlFor="ns-body">Message</label>
                <textarea id="ns-body" className="ns-textarea" value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} placeholder="Vente {{saleid}} enregistrée" />
              </div>
              <div className="ns-fields ns-fields--2">
                <NotificationCategorySelector categories={categories} value={draft.categoryId} onChange={(id) => setDraft((d) => ({ ...d, categoryId: id }))} />
                <NotificationPrioritySelector value={draft.priority} onChange={(p) => setDraft((d) => ({ ...d, priority: p }))} />
                <NotificationActionSelector value={draft.action} onChange={(a) => setDraft((d) => ({ ...d, action: a }))} />
                <NotificationPersistentToggle value={draft.persistent} onChange={(v) => setDraft((d) => ({ ...d, persistent: v }))} />
              </div>
              <div className="ns-field">
                <label className="ns-label" htmlFor="ns-vars">Variables autorisées (séparées par des virgules)</label>
                <input id="ns-vars" className="ns-input" type="text" value={draft.variables.join(', ')} onChange={(e) => setVarsFromText(e.target.value)} placeholder="amount, saleid" />
              </div>
            </div>
          </Card>

          <div className="ns-actions">
            <Button type="button" disabled={!canSave || saveMut.isPending} onClick={onSave}>{saveMut.isPending ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button>
          </div>
          {!canSave ? <p className="ns-warning">Le titre et le message sont requis.</p> : null}
          {actionError ? <p className="ns-error">{actionError}</p> : null}
          {savedAt > 0 && !actionError ? <p className="ns-success">Brouillon enregistré.</p> : null}

          <NotificationVariablesPanel used={preview.usedVariables} unknown={unknownVars} catalog={catalog} />
          <NotificationPublishPanel hasDraft={Boolean(draftId)} publishing={publishMut.isPending} onPublish={() => publishMut.mutate()} lastPublishedVersion={lastPublishedVersion} />
          <NotificationRollbackPanel versions={versionsQuery.data ?? []} busy={rollbackMut.isPending} onRollback={(v) => rollbackMut.mutate(v)} />
        </div>

        <div className={`ns-preview-col ${previewOpen ? '' : 'ns-preview-col--collapsed'}`.trim()}>
          <NotificationPreview category={selectedCategory} title={preview.title} body={preview.body} priority={draft.priority} persistent={draft.persistent} />
        </div>
      </div>

      <div className="ns-toolbar ns-preview-toggle">
        <Button type="button" variant="secondary" onClick={() => setPreviewOpen((v) => !v)}>{previewOpen ? 'Masquer l’aperçu' : 'Aperçu'}</Button>
        <Button type="button" disabled={!canSave || saveMut.isPending} onClick={onSave}>{saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </div>
  );
}
