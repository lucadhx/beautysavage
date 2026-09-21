import { PawPrint, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import type { Theme, ThemeColors } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, Button, Field, Input } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ColorField } from '@/components/fields/ColorField';
import { FontField } from '@/components/fields/FontField';
import { fontById, DEFAULT_TYPOGRAPHY } from '@/lib/fontCatalog';

const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  background: 'Fond',
  foreground: 'Texte',
  primary: 'Couleur principale',
  accent: 'Accent',
  menuBackground: 'Fond menu',
  menuForeground: 'Texte menu',
};

const HINTS: Partial<Record<keyof ThemeColors, string>> = {
  background: 'Couleur de fond du site (sombre pour un rendu premium).',
  foreground: 'Couleur du texte principal.',
  primary: 'Couleur de marque (boutons, sections importantes).',
  accent: 'Couleur de mise en avant (badges, liens, étoiles).',
};

const DARK_DEFAULT: ThemeColors = {
  background: '#ffffff',
  foreground: '#111111',
  primary: '#111111',
  accent: '#c7a98a',
  menuBackground: '#050505',
  menuForeground: '#ffffff',
};

// Reproduit les dérivations CSS de la vitrine pour l'aperçu.
function derive(c: ThemeColors) {
  return {
    secondary: `color-mix(in srgb, ${c.primary} 55%, ${c.background})`,
    muted: `color-mix(in srgb, ${c.foreground} 7%, ${c.background})`,
    mutedForeground: `color-mix(in srgb, ${c.foreground} 55%, ${c.background})`,
    border: `color-mix(in srgb, ${c.foreground} 14%, ${c.background})`,
  };
}

export default function ThemePage() {
  const { data, loading, setData } = useResource(() => api.getVitrineTheme());
  const { run } = useAction();

  // Avant le garde-fou de chargement : un hook ne peut pas être conditionnel.
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    await run(() => api.updateVitrineTheme(data), { success: 'Thème du site enregistré' });
    return data;
  });

  if (loading || !data) {
    return (
      <BrandLoader />
    );
  }

  const setColor = (key: keyof ThemeColors, value: string) =>
    setData({ ...data, colors: { ...data.colors, [key]: value } } as Theme);

  const typography = {
    headingFont: data.typography?.headingFont ?? DEFAULT_TYPOGRAPHY.headingFont,
    bodyFont: data.typography?.bodyFont ?? DEFAULT_TYPOGRAPHY.bodyFont,
  };
  const setFont = (key: 'headingFont' | 'bodyFont', id: string) =>
    setData({ ...data, typography: { ...typography, [key]: id } } as Theme);

  // Réinitialiser n'enregistre pas : le widget passera simplement en
  // « Enregistrer » puisque la palette diffère de la référence.
  const reset = () => setData({ ...data, colors: DARK_DEFAULT } as Theme);

  return (
    <div className="pb-20">
      <PageHeader
        title="Thème du site"
        description="Une palette simple de 4 couleurs. Toutes les autres nuances (nuances, bordures, contrastes) sont dérivées automatiquement."
        action={
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Thème sombre par défaut
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Palette</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((key) => (
              <div key={key}>
                <ColorField label={COLOR_LABELS[key]} value={data.colors[key] || DARK_DEFAULT[key] || '#000000'} onChange={(v) => setColor(key, v)} />
                <p className="mt-1 px-1 text-xs text-muted-foreground">{HINTS[key]}</p>
              </div>
            ))}
            <Field label="Arrondi (radius)">
              <Input value={data.radius} onChange={(e) => setData({ ...data, radius: e.target.value })} />
            </Field>
          </CardContent>
        </Card>

        <Card className="lg:col-start-1">
          <CardHeader>
            <CardTitle>Typographie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FontField label="Police des titres" value={typography.headingFont} onChange={(id) => setFont('headingFont', id)} />
              <p className="mt-1 px-1 text-xs text-muted-foreground">Titres, navigation et boutons de la vitrine.</p>
            </div>
            <div>
              <FontField label="Police des textes" value={typography.bodyFont} onChange={(id) => setFont('bodyFont', id)} />
              <p className="mt-1 px-1 text-xs text-muted-foreground">Paragraphes, descriptions et formulaires.</p>
            </div>
          </CardContent>
        </Card>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Aperçu en direct</p>
          <VitrinePreview colors={data.colors} radius={data.radius} typography={typography} />
        </div>
      </div>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

function VitrinePreview({
  colors,
  radius,
  typography,
}: {
  colors: ThemeColors;
  radius: string;
  typography: { headingFont: string; bodyFont: string };
}) {
  const d = derive(colors);
  const headingFamily = fontById(typography.headingFont)?.cssFamily;
  const bodyFamily = fontById(typography.bodyFont)?.cssFamily;
  return (
    <div
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ background: colors.background, color: colors.foreground, borderColor: d.border }}
    >
      <div className="p-5" style={{ background: `color-mix(in srgb, ${colors.primary} 22%, ${colors.background})` }}>
        <p className="text-xs" style={{ color: d.mutedForeground }}>
          Votre entreprise
        </p>
        <h3 className="mt-1 text-xl font-bold" style={{ fontFamily: headingFamily }}>Institut BeautySavage</h3>
        <button
          className="mt-3 px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: colors.accent, borderRadius: radius, fontFamily: headingFamily }}
        >
          Reserver un soin
        </button>
      </div>
      <div className="p-5">
        <div className="p-4" style={{ background: d.muted, borderRadius: radius }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">Pose gel signature</span>
            <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: colors.accent }}>
              Populaire
            </span>
          </div>
          <p className="mt-1 text-sm" style={{ color: d.mutedForeground, fontFamily: bodyFamily }}>
            Manucure, beaute du regard et formations pro.
          </p>
          <div className="mt-2 flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <PawPrint key={n} className="h-3.5 w-3.5" style={{ fill: colors.accent, color: colors.accent }} />
            ))}
          </div>
        </div>
        <button
          className="mt-3 w-full py-2 text-sm font-medium"
          style={{ background: d.secondary, color: '#fff', borderRadius: radius }}
        >
          Voir les prestations
        </button>
      </div>
    </div>
  );
}
