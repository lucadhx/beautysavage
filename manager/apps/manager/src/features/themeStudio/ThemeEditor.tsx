// M5 — Éditeur de thème (vitrine ou panel). Charge l'actif, édite un brouillon, preview live,
// sauvegarde (create/update) et activation. react-query.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState } from '@bs/ui';
import {
  ApiError,
  getActiveTheme,
  createTheme,
  updateTheme,
  activateTheme,
  type ThemeScope,
  type ThemeStudioTheme,
} from '@bs/api-client';
import { ThemeForm } from './ThemeForm';
import { ThemePreview } from './ThemePreview';
import { ThemeStatusCard, ThemeActions, MobileThemeToolbar } from './components';
import { themeToDraft, draftToSaveInput, defaultDraft, type ThemeDraft } from './themeDraft';

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 ? 'Accès réservé.' : err.message || 'Erreur.';
  return 'Une erreur est survenue.';
}

export function ThemeEditor({ scope, scopeLabel }: { scope: ThemeScope; scopeLabel: string }) {
  const qc = useQueryClient();
  const queryKey = ['theme-studio', scope];
  const [draft, setDraft] = useState<ThemeDraft>(() => defaultDraft(scope));
  const [themeId, setThemeId] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string>('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);

  const { data, status, error } = useQuery({
    queryKey,
    queryFn: () => getActiveTheme(scope),
    retry: false,
  });

  // Initialise le brouillon quand le thème actif est chargé (une fois par scope).
  useEffect(() => {
    if (status === 'success' && loadedKey !== scope) {
      const active = (data as ThemeStudioTheme | null) ?? null;
      setDraft(themeToDraft(active, scope));
      setThemeId(active?.id ?? null);
      setLoadedKey(scope);
    }
  }, [status, data, scope, loadedKey]);

  const isActive = Boolean((data as ThemeStudioTheme | null)?.isActive);

  const canSave = useMemo(() => {
    const c = draft.colors;
    return draft.name.trim().length > 0 && Boolean(c.primary && c.secondary && c.background && c.surface && c.text);
  }, [draft]);

  const refresh = () => qc.invalidateQueries({ queryKey });

  const saveMut = useMutation({
    mutationFn: () => {
      const input = draftToSaveInput(draft, scope);
      return themeId ? updateTheme(themeId, input) : createTheme(input);
    },
    onSuccess: (saved) => {
      setActionError(null);
      setThemeId(saved.id);
      setSavedAt(Date.now());
      void refresh();
    },
    onError: (e) => setActionError(messageFromError(e)),
  });

  const activateMut = useMutation({
    mutationFn: () => {
      if (!themeId) throw new ApiError({ status: 400, code: null, message: 'Sauvegardez d’abord.', body: null });
      return activateTheme(themeId);
    },
    onSuccess: () => { setActionError(null); void refresh(); },
    onError: (e) => setActionError(messageFromError(e)),
  });

  if (status === 'pending') return <LoadingState label="Chargement du thème…" />;
  if (status === 'error') {
    const denied = error instanceof ApiError && error.status === 403;
    return <ErrorState title={denied ? 'Accès réservé.' : 'Impossible de charger le thème.'} />;
  }

  const onSave = () => saveMut.mutate();

  return (
    <div className="ts-page">
      <ThemeStatusCard theme={(data as ThemeStudioTheme | null) ?? null} scopeLabel={scopeLabel} />

      <div className="ts-editor">
        <div>
          <ThemeForm scope={scope} draft={draft} onChange={setDraft} />
          <ThemeActions
            canSave={canSave}
            saving={saveMut.isPending}
            activating={activateMut.isPending}
            isActive={isActive}
            hasTheme={Boolean(themeId)}
            onSave={onSave}
            onActivate={() => activateMut.mutate()}
          />
          {actionError ? <p className="ts-error">{actionError}</p> : null}
          {savedAt > 0 && !actionError ? <p className="ts-success">Thème enregistré.</p> : null}
        </div>

        {/* Aperçu : toujours visible ≥ desktop ; sur mobile, basculé par la toolbar. */}
        <div className={`ts-preview-col ${previewOpen ? '' : 'ts-preview-col--collapsed'}`.trim()}>
          <ThemePreview scope={scope} draft={draft} />
        </div>
      </div>

      <MobileThemeToolbar
        canSave={canSave}
        saving={saveMut.isPending}
        onSave={onSave}
        onTogglePreview={() => setPreviewOpen((v) => !v)}
        previewOpen={previewOpen}
      />
    </div>
  );
}
