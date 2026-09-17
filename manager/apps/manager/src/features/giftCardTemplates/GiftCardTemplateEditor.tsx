// M13 — Éditeur d'un template de carte cadeau (dev-only) : charge le publié, édite un brouillon
// (HTML + CSS), preview live via POST /preview (QR factice, AUCUN envoi) rendue en iframe sandbox,
// sauvegarde draft → publication → rollback. react-query.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState, Button } from '@bs/ui';
import {
  ApiError,
  getGiftCardStudioTemplate,
  listGiftCardTemplateVersions,
  createGiftCardTemplateDraft,
  updateGiftCardTemplateDraft,
  publishGiftCardTemplateDraft,
  rollbackGiftCardTemplate,
  previewGiftCardTemplate,
  type GiftCardTemplate,
} from '@bs/api-client';
import { GiftCardPreviewPane, GiftCardVariablesPanel } from './components';

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 ? 'Accès réservé.' : err.message || 'Erreur.';
  return 'Une erreur est survenue.';
}

interface Draft { html: string; css: string }

export function GiftCardTemplateEditor({ slug, variables }: { slug: string; variables: string[] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({ html: '', css: '' });
  const [loadedKey, setLoadedKey] = useState<string>('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewPending, setPreviewPending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);

  const tplQuery = useQuery({ queryKey: ['gift-card-template', slug], queryFn: () => getGiftCardStudioTemplate(slug), retry: false });
  const versionsQuery = useQuery({ queryKey: ['gift-card-template-versions', slug], queryFn: () => listGiftCardTemplateVersions(slug), retry: false });

  useEffect(() => {
    if (tplQuery.status === 'success' && loadedKey !== slug) {
      const t = tplQuery.data;
      setDraft({ html: t?.html ?? '', css: t?.css ?? '' });
      setPreviewData(t?.previewData ?? null);
      setDraftId(null);
      setLoadedKey(slug);
    }
  }, [tplQuery.status, tplQuery.data, slug, loadedKey]);

  // Preview live (POST /preview) : re-render à chaque modif (QR factice, aucun envoi).
  useEffect(() => {
    let cancelled = false;
    setPreviewPending(true);
    void previewGiftCardTemplate({ html: draft.html, css: draft.css, previewData: previewData ?? undefined })
      .then((html) => { if (!cancelled) setPreviewHtml(html); })
      .catch(() => { if (!cancelled) setPreviewHtml(''); })
      .finally(() => { if (!cancelled) setPreviewPending(false); });
    return () => { cancelled = true; };
  }, [draft, previewData]);

  const lastPublishedVersion = useMemo(() => {
    const pub = (versionsQuery.data ?? []).find((v) => v.status === 'published');
    return pub?.version ?? null;
  }, [versionsQuery.data]);

  const canSave = draft.html.trim().length > 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['gift-card-template', slug] });
    void qc.invalidateQueries({ queryKey: ['gift-card-template-versions', slug] });
    void qc.invalidateQueries({ queryKey: ['gift-card-studio-templates'] });
  };

  const saveMut = useMutation({
    mutationFn: async (): Promise<GiftCardTemplate> => {
      if (draftId) return updateGiftCardTemplateDraft(draftId, { html: draft.html, css: draft.css });
      return createGiftCardTemplateDraft(slug, { html: draft.html, css: draft.css });
    },
    onSuccess: (d) => { setActionError(null); setDraftId(d.id); setSavedAt(Date.now()); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });

  const publishMut = useMutation({
    mutationFn: () => {
      if (!draftId) throw new ApiError({ status: 400, code: null, message: 'Enregistrez un brouillon d’abord.', body: null });
      return publishGiftCardTemplateDraft(draftId);
    },
    onSuccess: () => { setActionError(null); setDraftId(null); setLoadedKey(''); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });

  const rollbackMut = useMutation({
    mutationFn: (version: number) => rollbackGiftCardTemplate(slug, version),
    onSuccess: () => { setActionError(null); setLoadedKey(''); invalidate(); },
    onError: (e) => setActionError(messageFromError(e)),
  });

  if (tplQuery.status === 'pending') return <LoadingState label="Chargement du template…" />;
  if (tplQuery.status === 'error') {
    const denied = tplQuery.error instanceof ApiError && tplQuery.error.status === 403;
    return <ErrorState title={denied ? 'Accès réservé.' : 'Template introuvable.'} />;
  }

  const onSave = () => saveMut.mutate();
  const rollbackCandidates = (versionsQuery.data ?? []).filter((v) => v.status !== 'published').slice(0, 5);

  return (
    <div className="gct-page">
      <div className="gct-editor">
        <div className="gct-page">
          <div className="gct-field">
            <label className="gct-label" htmlFor="gct-html">Contenu HTML</label>
            <textarea id="gct-html" className="gct-textarea" value={draft.html} onChange={(e) => setDraft((d) => ({ ...d, html: e.target.value }))} spellCheck={false} placeholder="<div>{{recipientName}} — {{amount}}</div>" />
          </div>
          <div className="gct-field">
            <label className="gct-label" htmlFor="gct-css">CSS</label>
            <textarea id="gct-css" className="gct-textarea" value={draft.css} onChange={(e) => setDraft((d) => ({ ...d, css: e.target.value }))} spellCheck={false} placeholder=".card { ... }" />
          </div>

          <div className="gct-actions">
            <Button type="button" disabled={!canSave || saveMut.isPending} onClick={onSave}>
              {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </Button>
            <Button type="button" variant="secondary" disabled={!draftId || publishMut.isPending} onClick={() => publishMut.mutate()}>
              {publishMut.isPending ? 'Publication…' : 'Publier le brouillon'}
            </Button>
          </div>
          {!canSave ? <p className="gct-warning">Le contenu HTML est requis.</p> : null}
          {actionError ? <p className="gct-error">{actionError}</p> : null}
          {savedAt > 0 && !actionError ? <p className="gct-success">Brouillon enregistré.</p> : null}
          <p className="gct-note">{lastPublishedVersion ? `Version publiée : v${lastPublishedVersion}.` : 'Aucune version publiée.'}</p>

          <GiftCardVariablesPanel variables={variables} />

          {rollbackCandidates.length ? (
            <div className="gct-rollback">
              <strong>Restaurer une version</strong>
              <div className="gct-actions">
                {rollbackCandidates.map((v) => (
                  <Button key={v.version} type="button" variant="secondary" disabled={rollbackMut.isPending} onClick={() => rollbackMut.mutate(v.version)}>Restaurer v{v.version}</Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className={`gct-preview-col ${previewOpen ? '' : 'gct-preview-col--collapsed'}`.trim()}>
          <GiftCardPreviewPane html={previewHtml} pending={previewPending} />
        </div>
      </div>

      <div className="gct-toolbar gct-preview-toggle">
        <Button type="button" variant="secondary" onClick={() => setPreviewOpen((v) => !v)}>{previewOpen ? 'Masquer l’aperçu' : 'Aperçu'}</Button>
        <Button type="button" disabled={!canSave || saveMut.isPending} onClick={onSave}>{saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </div>
  );
}
