// M5 — Formulaire d'édition d'un thème (sections verticales, mobile-first).
import { Card } from '@bs/ui';
import type { ThemeScope } from '@bs/api-client';
import type { ThemeDraft } from './themeDraft';
import { ColorField, TypographyField, RadiusField, ShadowField, SpacingField, LogoSloganFields } from './fields';

export interface ThemeFormProps {
  scope: ThemeScope;
  draft: ThemeDraft;
  onChange: (next: ThemeDraft) => void;
}

export function ThemeForm({ scope, draft, onChange }: ThemeFormProps) {
  const setColor = (key: keyof ThemeDraft['colors'], value: string) =>
    onChange({ ...draft, colors: { ...draft.colors, [key]: value } });
  const setAccent = (value: string) =>
    onChange({ ...draft, derivedTokens: { ...draft.derivedTokens, accent: value } });

  return (
    <div className="ts-page">
      <Card>
        <div className="ts-section">
          <div className="ts-field">
            <label className="ts-label" htmlFor="ts-name">Nom du thème</label>
            <input id="ts-name" className="ts-input" type="text" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder={`Thème ${scope}`} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="ts-section">
          <h3 className="ts-section__title">Couleurs</h3>
          <div className="ts-fields ts-fields--2">
            <ColorField id="ts-c-primary" label="Primaire" value={draft.colors.primary} onChange={(v) => setColor('primary', v)} />
            <ColorField id="ts-c-secondary" label="Secondaire" value={draft.colors.secondary} onChange={(v) => setColor('secondary', v)} />
            <ColorField id="ts-c-background" label="Fond" value={draft.colors.background} onChange={(v) => setColor('background', v)} />
            <ColorField id="ts-c-surface" label="Surface" value={draft.colors.surface} onChange={(v) => setColor('surface', v)} />
            <ColorField id="ts-c-text" label="Texte" value={draft.colors.text} onChange={(v) => setColor('text', v)} />
            <ColorField id="ts-c-accent" label="Accent" value={draft.derivedTokens.accent} onChange={setAccent} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="ts-section">
          <h3 className="ts-section__title">Typographie & styles</h3>
          <div className="ts-fields ts-fields--2">
            <TypographyField value={draft.typography.fontFamily} onChange={(v) => onChange({ ...draft, typography: { fontFamily: v } })} />
            <RadiusField value={draft.radius} onChange={(v) => onChange({ ...draft, radius: v })} />
            <ShadowField value={draft.shadow} onChange={(v) => onChange({ ...draft, shadow: v })} />
          </div>
          <SpacingField value={draft.spacing} onChange={(v) => onChange({ ...draft, spacing: v })} />
        </div>
      </Card>

      {scope === 'vitrine' ? (
        <Card>
          <div className="ts-section">
            <h3 className="ts-section__title">Logo & slogan (vitrine)</h3>
            <LogoSloganFields
              logoUrl={draft.logoUrl}
              slogan={draft.slogan}
              onLogoChange={(v) => onChange({ ...draft, logoUrl: v })}
              onSloganChange={(v) => onChange({ ...draft, slogan: v })}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
