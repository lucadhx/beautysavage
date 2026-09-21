import { RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import type { ManagerTheme, ManagerThemeColors } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useManagerTheme, applyManagerTheme } from '@/context/ManagerThemeContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, Button, Field, Input } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ColorField } from '@/components/fields/ColorField';

const LABELS: Record<keyof ManagerThemeColors, string> = {
  primary: 'Principale',
  primaryForeground: 'Texte sur principale',
  accent: 'Accent',
  accentForeground: 'Texte sur accent',
  background: 'Fond',
  foreground: 'Texte',
  muted: 'Atténué',
  mutedForeground: 'Texte atténué',
  border: 'Bordures',
  sidebar: 'Barre latérale',
  sidebarForeground: 'Texte barre latérale',
};

const DEFAULTS: ManagerThemeColors = {
  primary: '#111111',
  primaryForeground: '#ffffff',
  accent: '#111111',
  accentForeground: '#ffffff',
  background: '#ffffff',
  foreground: '#0a0a0a',
  muted: '#f4f4f5',
  mutedForeground: '#71717a',
  border: '#e4e4e7',
  sidebar: '#0a0a0a',
  sidebarForeground: '#fafafa',
};

export default function DevManagerThemePage() {
  const { data, loading, setData } = useResource(() => api.getManagerTheme());
  const { apply } = useManagerTheme();
  const { run } = useAction();

  // Avant le garde-fou de chargement : un hook ne peut pas être conditionnel.
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    const saved = await run(() => api.updateManagerTheme(data), { success: 'Thème manager enregistré' });
    apply(saved);
    // Référence = `data`, pas `saved` : la page n'appelle pas `setData(saved)`,
    // l'écran continue donc d'afficher le brouillon local. Se caler sur la
    // réponse du serveur laisserait le widget bloqué sur « Enregistrer » à la
    // moindre normalisation côté API.
    return data;
  });

  if (loading || !data) {
    return (
      <BrandLoader />
    );
  }

  const setColor = (key: keyof ManagerThemeColors, value: string) => {
    const next = { ...data, colors: { ...data.colors, [key]: value } } as ManagerTheme;
    setData(next);
    applyManagerTheme(next); // live preview on the manager itself
  };

  const reset = () => {
    const next = { ...data, colors: DEFAULTS } as ManagerTheme;
    setData(next);
    applyManagerTheme(next);
  };

  return (
    <div className="pb-20">
      <PageHeader
        title="Thème manager"
        description="Personnalisez l'apparence du back-office. Les changements s'appliquent en direct."
        action={
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Réinitialiser
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Couleurs du manager</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(LABELS) as (keyof ManagerThemeColors)[]).map((key) => (
            <ColorField key={key} label={LABELS[key]} value={data.colors[key]} onChange={(v) => setColor(key, v)} />
          ))}
          <Field label="Arrondi (radius)">
            <Input value={data.radius} onChange={(e) => setData({ ...data, radius: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}
