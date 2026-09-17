// C1 — Éditeur de formation (présentielle/distancielle). ModuleStepper type-aware : présentiel
// montre Sessions, distanciel montre Accès. Le type est verrouillé après le premier achat.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '@bs/ui';
import type { CatalogueTraining, CatalogueTrainingInput } from '@bs/api-client';
import { uploadFormationImage } from '@bs/api-client';
import {
  CatalogueEditorShell,
  CatalogueModuleStepper,
  CatalogueStatusHeader,
  CatalogueValidationDrawer,
  CataloguePreviewCard,
  CatalogueVisibilityToggle,
  CatField,
  CatalogueSkeleton,
  type ModuleDescriptor,
} from './components';
import { validateTraining } from './validation';
import { useTrainingDetail, useTrainingMutations, useSessionsList } from './useCatalogue';
import { TrainingSessionEditor } from './TrainingSessionEditor';
import { ChapterEditor } from './learning/ChapterEditor';
import { EvaluationEditor } from './learning/EvaluationEditor';
import { FaqEditor } from '../faq/FaqEditor';
import { CatalogueGalleryEditor } from './CatalogueGalleryEditor';

type Draft = Partial<CatalogueTraining>;

const EMPTY: Draft = {
  name: '', description: '', editorialHtml: '', price: 0, durationDays: 1, refundDays: 7,
  coverImage: '', type: 'distanciel', accessDeliveryMode: 'manual', accessUrl: '', accessLifetime: true,
  isRefundableAfterAccess: false, status: 'draft',
};

function modulesFor(type: Draft['type']): ModuleDescriptor[] {
  const base: ModuleDescriptor[] = [
    { key: 'identite', label: 'Identité', icon: 'bi-info-circle' },
    { key: 'prix', label: 'Prix', icon: 'bi-currency-euro' },
  ];
  if (type === 'presentiel') base.push({ key: 'sessions', label: 'Sessions', icon: 'bi-calendar-event' });
  else {
    base.push({ key: 'acces', label: 'Accès', icon: 'bi-unlock' });
    // C2 — Learning Studio : contenu pédagogique (chapitres → leçons → ressources).
    base.push({ key: 'contenu', label: 'Contenu', icon: 'bi-collection-play' });
  }
  base.push({ key: 'questionnaire', label: 'Questionnaire', icon: 'bi-ui-checks' });
  base.push({ key: 'rendus', label: 'Rendus', icon: 'bi-camera' });
  base.push({ key: 'faq', label: 'FAQ', icon: 'bi-patch-question' });
  base.push({ key: 'vitrine', label: 'Vitrine', icon: 'bi-shop' });
  return base;
}

export function TrainingEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const isNew = !id;
  const detail = useTrainingDetail(id);
  const sessions = useSessionsList(id);
  const { save } = useTrainingMutations();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [active, setActive] = useState('identite');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew && loadedKey !== '__new__') {
      setDraft(EMPTY);
      setLoadedKey('__new__');
    } else if (detail.status === 'success' && detail.data && loadedKey !== id) {
      setDraft(detail.data);
      setLoadedKey(id ?? null);
    }
  }, [isNew, detail.status, detail.data, id, loadedKey]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const modules = useMemo(() => modulesFor(draft.type), [draft.type]);
  const moduleLabels = useMemo(() => Object.fromEntries(modules.map((m) => [m.key, m.label])), [modules]);
  const validation = useMemo(() => validateTraining(draft, sessions.data ?? []), [draft, sessions.data]);
  const doneCount = modules.filter((m) => {
    // Un module sans règle de validation (ex. FAQ) est optionnel → compté « fait ».
    const s = validation.modules[m.key]?.status ?? 'optional';
    return s === 'complete' || s === 'optional';
  }).length;

  if (!isNew && detail.status === 'pending') return <CatalogueSkeleton rows={4} />;
  if (!isNew && detail.status === 'error') return <ErrorState title="Formation introuvable." />;

  async function onSave() {
    setError('');
    const input: CatalogueTrainingInput = {
      name: draft.name, description: draft.description, editorialHtml: draft.editorialHtml,
      price: Number(draft.price), durationDays: Number(draft.durationDays), refundDays: Number(draft.refundDays),
      coverImage: draft.coverImage, type: draft.type, accessDeliveryMode: draft.accessDeliveryMode,
      accessUrl: draft.accessUrl, accessLifetime: draft.accessLifetime, isRefundableAfterAccess: draft.isRefundableAfterAccess,
      // RC1 quick win — la bande-annonce était éditable mais omise du payload (perte de données).
      trailerVideoUrl: draft.trailerVideoUrl,
      status: draft.status,
      photos: draft.photos,
      faq: draft.faq,
    };
    try {
      const saved = await save.mutateAsync({ input, id });
      setSavedAt(Date.now());
      if (isNew && saved?.id) navigate(`/catalogue/formations/${saved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    }
  }

  const wantsPublish = draft.status === 'published';
  const canSave = !save.isPending && (!wantsPublish || validation.publishable);
  const visibilityLabel = draft.status === 'published' ? 'Publié' : draft.status === 'disabled' ? 'Désactivé' : 'Brouillon';
  const visibilityTone = draft.status === 'published' ? 'success' : draft.status === 'disabled' ? 'danger' : 'muted';

  return (
    <>
      <CatalogueEditorShell
        header={
          <CatalogueStatusHeader
            title={draft.name ?? ''}
            visibilityLabel={visibilityLabel}
            visibilityTone={visibilityTone}
            progress={{ done: doneCount, total: modules.length }}
            saving={save.isPending}
            savedAt={savedAt}
            canSave={canSave}
            onSave={onSave}
          >
            <div className="cat-statushead__alerts">
              {validation.errorCount > 0 ? (
                <button type="button" className="cat-alert cat-alert--error" onClick={() => setDrawerOpen(true)}>
                  <i className="bi bi-exclamation-triangle" aria-hidden="true" /> {validation.errorCount} bloquant(s)
                </button>
              ) : (
                <button type="button" className="cat-alert cat-alert--ok" onClick={() => setDrawerOpen(true)}>
                  <i className="bi bi-check-circle" aria-hidden="true" /> Prêt à publier
                </button>
              )}
              {error ? <span className="cat-note cat-note--error" role="alert">{error}</span> : null}
            </div>
          </CatalogueStatusHeader>
        }
        stepper={<CatalogueModuleStepper modules={modules} active={active} validation={validation.modules} onSelect={setActive} />}
      >
        {active === 'identite' ? (
          <div className="cat-form">
            <CatField label="Nom de la formation" required>
              <input className="cat-input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
            </CatField>
            <CatField label="Type" hint={draft.typeLocked ? 'Type verrouillé : formation déjà achetée.' : 'Présentiel (sessions) ou distanciel (accès en ligne).'}>
              <div className="cat-segmented" role="group" aria-label="Type de formation">
                <button type="button" className={`cat-seg${draft.type === 'presentiel' ? ' cat-seg--active' : ''}`} disabled={draft.typeLocked} onClick={() => set('type', 'presentiel')}>Présentiel</button>
                <button type="button" className={`cat-seg${draft.type === 'distanciel' ? ' cat-seg--active' : ''}`} disabled={draft.typeLocked} onClick={() => set('type', 'distanciel')}>Distanciel</button>
              </div>
            </CatField>
            <CatField label="Description">
              <textarea className="cat-textarea" rows={5} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
            </CatField>
            {draft.type === 'presentiel' ? (
              <div className="cat-form__row">
                <CatField label="Durée (jours)">
                  <input className="cat-input" type="number" min={1} value={draft.durationDays ?? 1} onChange={(e) => set('durationDays', Number(e.target.value))} />
                </CatField>
                <CatField label="Délai de remboursement (jours)">
                  <input className="cat-input" type="number" min={0} value={draft.refundDays ?? 7} onChange={(e) => set('refundDays', Number(e.target.value))} />
                </CatField>
              </div>
            ) : null}
            <CatField label="Galerie" hint="La 1re image est la couverture. Ajout par URL ou upload, glisser-déposer pour l'ordre.">
              <CatalogueGalleryEditor
                images={[draft.coverImage, ...(draft.photos ?? [])].filter(Boolean) as string[]}
                onChange={(imgs) => { set('coverImage', imgs[0] ?? ''); set('photos', imgs.slice(1)); }}
                onUpload={(file) => uploadFormationImage(file)}
              />
            </CatField>
            <CatField label="Bande-annonce (URL vidéo)">
              <input className="cat-input" value={draft.trailerVideoUrl ?? ''} onChange={(e) => set('trailerVideoUrl', e.target.value)} />
            </CatField>
          </div>
        ) : null}

        {active === 'prix' ? (
          <div className="cat-form">
            <CatField label="Prix (€)" required>
              <input className="cat-input" type="number" min={0} step="0.01" value={draft.price ?? 0} onChange={(e) => set('price', Number(e.target.value))} />
            </CatField>
          </div>
        ) : null}

        {active === 'sessions' ? (
          isNew ? (
            <p className="cat-note">Enregistrez la formation pour planifier des sessions.</p>
          ) : (
            <TrainingSessionEditor formationId={id as string} durationDays={Number(draft.durationDays) || 1} />
          )
        ) : null}

        {active === 'acces' ? (
          <div className="cat-form">
            <CatField label="Mode de livraison de l'accès">
              <select className="cat-input" value={draft.accessDeliveryMode} onChange={(e) => set('accessDeliveryMode', e.target.value as Draft['accessDeliveryMode'])}>
                <option value="manual">Manuel (après validation)</option>
                <option value="immediate">Immédiat (dès paiement)</option>
              </select>
            </CatField>
            <CatField label="Lien d'accès (plateforme, ressources)">
              <input className="cat-input" value={draft.accessUrl ?? ''} onChange={(e) => set('accessUrl', e.target.value)} />
            </CatField>
            <CatalogueVisibilityToggle checked={draft.accessLifetime !== false} onChange={(v) => set('accessLifetime', v)} label="Accès à vie" />
            <CatalogueVisibilityToggle checked={Boolean(draft.isRefundableAfterAccess)} onChange={(v) => set('isRefundableAfterAccess', v)} label="Remboursable après accès" />
            {draft.accessDeliveryMode === 'immediate' && !draft.isRefundableAfterAccess ? (
              <p className="cat-note cat-note--warning">
                <i className="bi bi-info-circle" aria-hidden="true" /> Accès immédiat : la renonciation au délai légal de rétractation sera demandée au client au paiement.
              </p>
            ) : null}
          </div>
        ) : null}

        {active === 'contenu' ? (
          isNew ? (
            <p className="cat-note">Enregistrez la formation pour ajouter chapitres et leçons.</p>
          ) : (
            <ChapterEditor formationId={id as string} />
          )
        ) : null}

        {active === 'questionnaire' ? (
          isNew ? <p className="cat-note">Enregistrez la formation pour configurer le questionnaire.</p>
            : <EvaluationEditor formationId={id as string} part="questionnaire" />
        ) : null}

        {active === 'rendus' ? (
          isNew ? <p className="cat-note">Enregistrez la formation pour configurer les rendus.</p>
            : <EvaluationEditor formationId={id as string} part="deliverables" />
        ) : null}

        {active === 'vitrine' ? (
          <div className="cat-form">
            <CatField label="Statut de publication">
              <select className="cat-input" value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
                <option value="disabled">Désactivé</option>
              </select>
            </CatField>
            <CataloguePreviewCard title={draft.name ?? ''} subtitle={draft.type === 'presentiel' ? 'Formation présentielle' : 'Formation distancielle'} price={Number(draft.price) || 0} image={draft.coverImage} />
          </div>
        ) : null}

        {active === 'faq' ? (
          <div className="cat-form">
            <CatField label="Questions fréquentes de la formation" hint="Affichées sur la fiche vitrine. Rien n'est publié tant qu'aucune question n'est renseignée.">
              <FaqEditor value={draft.faq ?? []} onChange={(faq) => set('faq', faq)} />
            </CatField>
          </div>
        ) : null}
      </CatalogueEditorShell>

      <CatalogueValidationDrawer
        open={drawerOpen}
        issues={validation.issues}
        onClose={() => setDrawerOpen(false)}
        onGoToModule={(key) => { setActive(key); setDrawerOpen(false); }}
        moduleLabels={moduleLabels}
      />
    </>
  );
}
