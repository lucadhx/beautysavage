// C1 — Éditeur de prestation (pattern CatalogueModuleStepper). Mobile-first, draft local seedé
// depuis le backend, validation continue par module, drawer de blocages.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '@bs/ui';
import type { CatalogueService, CatalogueServiceInput } from '@bs/api-client';
import { uploadServicePhoto } from '@bs/api-client';
import {
  CatalogueEditorShell,
  CatalogueModuleStepper,
  CatalogueStatusHeader,
  CatalogueValidationDrawer,
  CatalogueVisibilityToggle,
  CataloguePreviewCard,
  CataloguePriceCard,
  CatField,
  type ModuleDescriptor,
} from './components';
import { CatalogueGalleryEditor } from './CatalogueGalleryEditor';
import { validateService } from './validation';
import { useServiceDetail, useServiceMutations } from './useCatalogue';
import { CatalogueSkeleton } from './components';
import { FaqEditor } from '../faq/FaqEditor';

const MODULES: ModuleDescriptor[] = [
  { key: 'identite', label: 'Identité', icon: 'bi-info-circle' },
  { key: 'prix', label: 'Prix & acompte', icon: 'bi-currency-euro' },
  { key: 'options', label: 'Options', icon: 'bi-list-check' },
  { key: 'reservation', label: 'Réservation', icon: 'bi-calendar-check' },
  { key: 'faq', label: 'FAQ', icon: 'bi-patch-question' },
  { key: 'vitrine', label: 'Vitrine', icon: 'bi-shop' },
];
const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

type Draft = Partial<CatalogueService>;

const EMPTY: Draft = {
  name: '', shortDescription: '', description: '', duration: 60, price: 0, capacity: 1,
  paymentType: 'full', depositType: 'percentage', depositValue: 0, balanceSettlementMode: 'none',
  cancellationDays: 7, bookingLeadDays: 0, isBookable: true, isActive: false,
  allowClientChoosePractitioner: true, options: [], photos: [],
};

export function ServiceEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const isNew = !id;
  const detail = useServiceDetail(id);
  const { save } = useServiceMutations();

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

  const validation = useMemo(() => validateService(draft), [draft]);
  const doneCount = MODULES.filter((m) => {
    // Un module sans règle de validation (ex. FAQ) est considéré comme optionnel → compté « fait ».
    const s = validation.modules[m.key]?.status ?? 'optional';
    return s === 'complete' || s === 'optional';
  }).length;

  if (!isNew && detail.status === 'pending') return <CatalogueSkeleton rows={4} />;
  if (!isNew && detail.status === 'error') {
    return <ErrorState title="Prestation introuvable." />;
  }

  const visibility = draft.isActive ? 'visible' : 'draft';

  async function onSave() {
    setError('');
    const input: CatalogueServiceInput = {
      name: draft.name, shortDescription: draft.shortDescription, description: draft.description,
      duration: Number(draft.duration), price: Number(draft.price), capacity: Number(draft.capacity),
      paymentType: draft.paymentType, depositType: draft.depositType, depositValue: Number(draft.depositValue),
      balanceSettlementMode: draft.balanceSettlementMode, cancellationDays: Number(draft.cancellationDays),
      bookingLeadDays: Number(draft.bookingLeadDays), isBookable: draft.isBookable, isActive: draft.isActive,
      allowClientChoosePractitioner: draft.allowClientChoosePractitioner, options: draft.options,
      photos: draft.photos,
      faq: draft.faq,
    };
    try {
      const saved = await save.mutateAsync({ input, id });
      setSavedAt(Date.now());
      if (isNew && saved?.id) {
        navigate(`/catalogue/prestations/${saved.id}`, { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    }
  }

  // Publication bloquée si l'utilisateur active la vitrine alors qu'il reste des erreurs.
  const wantsPublish = Boolean(draft.isActive);
  const canSave = !save.isPending && (!wantsPublish || validation.publishable);

  return (
    <>
      <CatalogueEditorShell
        header={
          <CatalogueStatusHeader
            title={draft.name ?? ''}
            visibilityLabel={visibility === 'visible' ? 'Visible' : 'Brouillon'}
            visibilityTone={visibility === 'visible' ? 'success' : 'muted'}
            progress={{ done: doneCount, total: MODULES.length }}
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
        stepper={
          <CatalogueModuleStepper modules={MODULES} active={active} validation={validation.modules} onSelect={setActive} />
        }
      >
        {active === 'identite' ? (
          <div className="cat-form">
            <CatField label="Nom de la prestation" required error={validation.modules.identite?.issues.find((i) => i.message.includes('nom'))?.message}>
              <input className="cat-input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
            </CatField>
            <CatField label="Description courte" hint="Affichée sur les cartes vitrine (160 caractères max).">
              <input className="cat-input" maxLength={160} value={draft.shortDescription ?? ''} onChange={(e) => set('shortDescription', e.target.value)} />
            </CatField>
            <CatField label="Description complète">
              <textarea className="cat-textarea" rows={5} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
            </CatField>
            <div className="cat-form__row">
              <CatField label="Durée (minutes)" required>
                <input className="cat-input" type="number" min={1} step={5} value={draft.duration ?? 0} onChange={(e) => set('duration', Number(e.target.value))} />
              </CatField>
              <CatField label="Capacité (pers.)">
                <input className="cat-input" type="number" min={1} value={draft.capacity ?? 1} onChange={(e) => set('capacity', Number(e.target.value))} />
              </CatField>
            </div>
            <CatField label="Galerie" hint="La 1re image est la couverture. Ajout par URL ou upload, glisser-déposer pour l'ordre.">
              <CatalogueGalleryEditor
                images={draft.photos ?? []}
                onChange={(photos) => set('photos', photos)}
                onUpload={id ? (file) => uploadServicePhoto(id, file) : undefined}
                uploadDisabledHint="Enregistrez la prestation pour téléverser (l'ajout par URL reste possible)."
              />
            </CatField>
          </div>
        ) : null}

        {active === 'prix' ? (
          <div className="cat-form">
            <CatField label="Type de paiement">
              <select className="cat-input" value={draft.paymentType} onChange={(e) => set('paymentType', e.target.value as Draft['paymentType'])}>
                <option value="full">Paiement complet</option>
                <option value="deposit">Acompte</option>
                <option value="free">Gratuit</option>
              </select>
            </CatField>
            {draft.paymentType !== 'free' ? (
              <CatField label="Prix (€)" required>
                <input className="cat-input" type="number" min={0} step="0.01" value={draft.price ?? 0} onChange={(e) => set('price', Number(e.target.value))} />
              </CatField>
            ) : null}
            {draft.paymentType === 'deposit' ? (
              <>
                <div className="cat-form__row">
                  <CatField label="Type d'acompte">
                    <select className="cat-input" value={draft.depositType} onChange={(e) => set('depositType', e.target.value as Draft['depositType'])}>
                      <option value="percentage">Pourcentage</option>
                      <option value="fixed">Montant fixe</option>
                    </select>
                  </CatField>
                  <CatField label={draft.depositType === 'percentage' ? 'Valeur (%)' : 'Valeur (€)'} required>
                    <input className="cat-input" type="number" min={0} value={draft.depositValue ?? 0} onChange={(e) => set('depositValue', Number(e.target.value))} />
                  </CatField>
                </div>
                <CatField label="Règlement du solde">
                  <select className="cat-input" value={draft.balanceSettlementMode} onChange={(e) => set('balanceSettlementMode', e.target.value as Draft['balanceSettlementMode'])}>
                    <option value="none">En ligne uniquement</option>
                    <option value="pay_on_site">Solde payable sur place</option>
                  </select>
                </CatField>
              </>
            ) : null}
            <CatField label="Délai d'annulation (jours)">
              <input className="cat-input" type="number" min={0} value={draft.cancellationDays ?? 7} onChange={(e) => set('cancellationDays', Number(e.target.value))} />
            </CatField>
            <CataloguePriceCard price={Number(draft.price) || 0} note={draft.paymentType === 'free' ? 'Prestation gratuite' : undefined} />
          </div>
        ) : null}

        {active === 'options' ? (
          <div className="cat-form">
            {(draft.options ?? []).map((opt, idx) => (
              <div key={idx} className="cat-optrow">
                <input className="cat-input" placeholder="Nom de l'option" value={opt.name} onChange={(e) => {
                  const next = [...(draft.options ?? [])];
                  next[idx] = { ...opt, name: e.target.value };
                  set('options', next);
                }} />
                <input className="cat-input cat-input--narrow" type="number" min={0} step="0.01" value={opt.price} onChange={(e) => {
                  const next = [...(draft.options ?? [])];
                  next[idx] = { ...opt, price: Number(e.target.value) };
                  set('options', next);
                }} />
                <button type="button" className="cat-iconbtn" aria-label="Retirer l'option" onClick={() => set('options', (draft.options ?? []).filter((_, i) => i !== idx))}>
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button type="button" className="cat-btn cat-btn--ghost" onClick={() => set('options', [...(draft.options ?? []), { name: '', price: 0, isActive: true }])}>
              <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une option
            </button>
          </div>
        ) : null}

        {active === 'reservation' ? (
          <div className="cat-form">
            <CatalogueVisibilityToggle checked={draft.isBookable !== false} onChange={(v) => set('isBookable', v)} label="Réservation en ligne activée" />
            <CatField label="Délai minimum de réservation (jours)">
              <input className="cat-input" type="number" min={0} value={draft.bookingLeadDays ?? 0} onChange={(e) => set('bookingLeadDays', Number(e.target.value))} />
            </CatField>
          </div>
        ) : null}

        {active === 'faq' ? (
          <div className="cat-form">
            <CatField label="Questions fréquentes de la prestation" hint="Affichées sur la fiche vitrine. Rien n'est publié tant qu'aucune question n'est renseignée.">
              <FaqEditor value={draft.faq ?? []} onChange={(faq) => set('faq', faq)} />
            </CatField>
          </div>
        ) : null}

        {active === 'vitrine' ? (
          <div className="cat-form">
            <CatalogueVisibilityToggle checked={Boolean(draft.isActive)} onChange={(v) => set('isActive', v)} label="Visible en vitrine" />
            <CataloguePreviewCard title={draft.name ?? ''} subtitle={draft.shortDescription} price={Number(draft.price) || 0} image={draft.photos?.[0]} />
          </div>
        ) : null}
      </CatalogueEditorShell>

      <CatalogueValidationDrawer
        open={drawerOpen}
        issues={validation.issues}
        onClose={() => setDrawerOpen(false)}
        onGoToModule={(key) => { setActive(key); setDrawerOpen(false); }}
        moduleLabels={MODULE_LABELS}
      />
    </>
  );
}
