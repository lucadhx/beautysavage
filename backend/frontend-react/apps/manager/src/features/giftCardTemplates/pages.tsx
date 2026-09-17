// M13 — Pages Gift Card Template Studio : liste (dashboard), éditeur, versions.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, LoadingState, ErrorState } from '@bs/ui';
import { listGiftCardStudioTemplates, listGiftCardTemplateVersions, rollbackGiftCardTemplate } from '@bs/api-client';
import { GiftCardTemplateList, GiftCardVersionList } from './components';
import { GiftCardTemplateEditor } from './GiftCardTemplateEditor';

export function GiftCardTemplateStudioDashboard() {
  const { data, status } = useQuery({ queryKey: ['gift-card-studio-templates'], queryFn: listGiftCardStudioTemplates, retry: false });
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    let list = data?.templates ?? [];
    if (search.trim()) list = list.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()) || t.slug.includes(search.trim().toLowerCase()));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, search]);

  if (status === 'pending') return <LoadingState label="Chargement des templates…" />;
  if (status === 'error') return <ErrorState title="Impossible de charger les templates." />;

  return (
    <div className="gct-page">
      <Card>
        <div className="gct-field">
          <label className="gct-label" htmlFor="gct-search">Recherche</label>
          <input id="gct-search" className="gct-input" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex. default" />
        </div>
      </Card>
      <GiftCardTemplateList templates={items} />
    </div>
  );
}

export function GiftCardTemplateEditorPage() {
  const { slug = '' } = useParams();
  const { data } = useQuery({ queryKey: ['gift-card-studio-templates'], queryFn: listGiftCardStudioTemplates, retry: false });
  return (
    <div className="gct-page">
      <Link className="gct-back" to="/dev/gift-card-templates">← Tous les templates</Link>
      <div className="gct-head"><h2 className="gct-head__title">{slug}</h2></div>
      <GiftCardTemplateEditor slug={slug} variables={data?.variables ?? []} />
    </div>
  );
}

export function GiftCardTemplateVersionsPage() {
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['gift-card-template-versions', slug], queryFn: () => listGiftCardTemplateVersions(slug), retry: false });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['gift-card-template-versions', slug] });
  const rollbackMut = useMutation({ mutationFn: (version: number) => rollbackGiftCardTemplate(slug, version), onSuccess: invalidate });

  return (
    <div className="gct-page">
      <Link className="gct-back" to={`/dev/gift-card-templates/${encodeURIComponent(slug)}`}>← Éditeur</Link>
      <div className="gct-head"><h2 className="gct-head__title">Versions — {slug}</h2></div>
      {status === 'pending' ? (
        <LoadingState label="Chargement des versions…" />
      ) : status === 'error' ? (
        <ErrorState title="Impossible de charger les versions." />
      ) : (
        <GiftCardVersionList versions={data ?? []} busy={rollbackMut.isPending} onRollback={(v) => rollbackMut.mutate(v)} />
      )}
    </div>
  );
}
