// C1 — Éditeur catalogue cartes cadeaux : montants (min/max/presets), template actif (lecture),
// conditions vitrine. Le Studio de templates (édition HTML) reste dev-only (M13).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@bs/ui';
import type { CatalogueGiftCardConfig } from '@bs/api-client';
import { uploadGiftCardImage } from '@bs/api-client';
import {
  CatalogueEditorShell,
  CatalogueModuleStepper,
  CatalogueStatusHeader,
  CatalogueValidationDrawer,
  CatField,
  CatalogueSkeleton,
  type ModuleDescriptor,
} from './components';
import { validateGiftCardConfig } from './validation';
import { useGiftCardConfig, useGiftCardActiveTemplate, useGiftCardConfigMutation } from './useCatalogue';

const MODULES: ModuleDescriptor[] = [
  { key: 'montants', label: 'Montants', icon: 'bi-cash-coin' },
  { key: 'template', label: 'Template actif', icon: 'bi-palette' },
  { key: 'vitrine', label: 'Vitrine', icon: 'bi-shop' },
];
const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

type Draft = CatalogueGiftCardConfig;

export function GiftCardCatalogueEditor() {
  const cfg = useGiftCardConfig();
  const template = useGiftCardActiveTemplate();
  const mutation = useGiftCardConfigMutation();

  const [draft, setDraft] = useState<Draft>({ minAmount: 50, maxAmount: 0, presetAmounts: [], description: '', image: '' });
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState('montants');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState('');
  const [presetInput, setPresetInput] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    if (cfg.status === 'success' && cfg.data && !loaded) {
      setDraft(cfg.data);
      setLoaded(true);
    }
  }, [cfg.status, cfg.data, loaded]);

  const hasActiveTemplate = Boolean(template.data?.id);
  const validation = useMemo(() => validateGiftCardConfig(draft, hasActiveTemplate), [draft, hasActiveTemplate]);
  const doneCount = MODULES.filter((m) => ['complete', 'optional'].includes(validation.modules[m.key]?.status ?? '')).length;

  if (cfg.status === 'pending') return <CatalogueSkeleton rows={3} />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onImageFile(file: File | undefined) {
    if (!file) return;
    setUploadingImage(true);
    setImageError('');
    try {
      const url = await uploadGiftCardImage(file);
      set('image', url);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Échec du téléversement — réessayez.');
    } finally {
      setUploadingImage(false);
    }
  }

  function addPreset() {
    const n = Number(presetInput);
    if (Number.isFinite(n) && n > 0 && !draft.presetAmounts.includes(n)) {
      set('presetAmounts', [...draft.presetAmounts, n].sort((a, b) => a - b));
    }
    setPresetInput('');
  }

  async function onSave() {
    setError('');
    try {
      await mutation.mutateAsync({
        minAmount: Number(draft.minAmount), maxAmount: Number(draft.maxAmount),
        presetAmounts: draft.presetAmounts, description: draft.description, image: draft.image,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    }
  }

  return (
    <>
      <CatalogueEditorShell
        header={
          <CatalogueStatusHeader
            title="Cartes cadeaux"
            visibilityLabel={hasActiveTemplate ? 'Template actif' : 'Aucun template'}
            visibilityTone={hasActiveTemplate ? 'success' : 'danger'}
            progress={{ done: doneCount, total: MODULES.length }}
            saving={mutation.isPending}
            savedAt={savedAt}
            canSave={!mutation.isPending && validation.publishable}
            onSave={onSave}
          >
            <div className="cat-statushead__alerts">
              {validation.errorCount > 0 ? (
                <button type="button" className="cat-alert cat-alert--error" onClick={() => setDrawerOpen(true)}>
                  <i className="bi bi-exclamation-triangle" aria-hidden="true" /> {validation.errorCount} bloquant(s)
                </button>
              ) : (
                <button type="button" className="cat-alert cat-alert--ok" onClick={() => setDrawerOpen(true)}>
                  <i className="bi bi-check-circle" aria-hidden="true" /> Configuration valide
                </button>
              )}
              {error ? <span className="cat-note cat-note--error" role="alert">{error}</span> : null}
            </div>
          </CatalogueStatusHeader>
        }
        stepper={<CatalogueModuleStepper modules={MODULES} active={active} validation={validation.modules} onSelect={setActive} />}
      >
        {active === 'montants' ? (
          <div className="cat-form">
            <div className="cat-form__row">
              <CatField label="Montant minimum (€)" required>
                <input className="cat-input" type="number" min={1} value={draft.minAmount} onChange={(e) => set('minAmount', Number(e.target.value))} />
              </CatField>
              <CatField label="Montant maximum (€)" hint="0 = illimité.">
                <input className="cat-input" type="number" min={0} value={draft.maxAmount} onChange={(e) => set('maxAmount', Number(e.target.value))} />
              </CatField>
            </div>
            <CatField label="Montants suggérés">
              <div className="cat-presets">
                {draft.presetAmounts.map((a) => (
                  <span key={a} className="cat-preset">
                    {a} €
                    <button type="button" aria-label={`Retirer ${a} €`} onClick={() => set('presetAmounts', draft.presetAmounts.filter((x) => x !== a))}>
                      <i className="bi bi-x" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </CatField>
            <div className="cat-form__row">
              <input className="cat-input cat-input--narrow" type="number" min={1} placeholder="ex. 50" value={presetInput} onChange={(e) => setPresetInput(e.target.value)} />
              <button type="button" className="cat-btn cat-btn--ghost" onClick={addPreset}><i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter</button>
            </div>
          </div>
        ) : null}

        {active === 'template' ? (
          <div className="cat-form">
            {template.status === 'pending' ? (
              <CatalogueSkeleton rows={1} />
            ) : hasActiveTemplate ? (
              <div className="cat-tplcard">
                <Badge tone="success">Actif</Badge>
                <span className="cat-tplcard__name">{template.data?.name}</span>
              </div>
            ) : (
              <p className="cat-note cat-note--error">Aucun template actif. Activez-en un dans la librairie.</p>
            )}
            <Link className="cat-btn cat-btn--ghost" to="/cartes-cadeaux/templates">
              <i className="bi bi-collection" aria-hidden="true" /> Gérer la librairie de templates
            </Link>
          </div>
        ) : null}

        {active === 'vitrine' ? (
          <div className="cat-form">
            <CatField label="Description vitrine">
              <textarea className="cat-textarea" rows={4} value={draft.description} onChange={(e) => set('description', e.target.value)} />
            </CatField>
            <CatField label="Image" hint="Téléversez un fichier ou collez une URL.">
              <div className="cat-gcimg">
                {draft.image ? (
                  <div className="cat-gcimg__preview">
                    <img className="cat-gcimg__img" src={draft.image} alt="Aperçu carte cadeau" />
                    <button type="button" className="cat-gcimg__remove" aria-label="Retirer l'image" onClick={() => set('image', '')}>
                      <i className="bi bi-x-lg" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className="cat-gcimg__empty">
                    <i className="bi bi-image" aria-hidden="true" /> Aucune image
                  </div>
                )}
                <div className="cat-gcimg__controls">
                  <input
                    className="cat-input"
                    placeholder="Coller une URL d'image…"
                    value={draft.image}
                    onChange={(e) => set('image', e.target.value)}
                  />
                  <label className="cat-btn cat-btn--ghost cat-gcimg__upload">
                    <input type="file" accept="image/*" hidden disabled={uploadingImage} onChange={(e) => { void onImageFile(e.target.files?.[0]); e.target.value = ''; }} />
                    <i className="bi bi-upload" aria-hidden="true" /> {uploadingImage ? 'Téléversement…' : 'Téléverser'}
                  </label>
                </div>
                {imageError ? <p className="cat-note cat-note--error">{imageError}</p> : null}
              </div>
            </CatField>
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
