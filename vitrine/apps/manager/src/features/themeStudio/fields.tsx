// M5 — Champs d'édition du Theme Studio. Couleurs = données (state) ; aucun hex littéral ici
// (le repli du color-picker vient de themeDraft.toHexValue).
import { toHexValue } from './themeDraft';

export interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorField({ id, label, value, onChange }: ColorFieldProps) {
  return (
    <div className="ts-field">
      <label className="ts-label" htmlFor={id}>{label}</label>
      <div className="ts-color">
        <input
          className="ts-color__pick"
          type="color"
          aria-label={`${label} (sélecteur)`}
          value={toHexValue(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={id}
          className="ts-input ts-color__text"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#rrggbb / rgba(...) / color-mix(...)"
        />
      </div>
    </div>
  );
}

export function TypographyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ts-field">
      <label className="ts-label" htmlFor="ts-font">Police (font-family)</label>
      <input id="ts-font" className="ts-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="system-ui, -apple-system, sans-serif" />
    </div>
  );
}

export function RadiusField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ts-field">
      <label className="ts-label" htmlFor="ts-radius">Arrondi (radius)</label>
      <input id="ts-radius" className="ts-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="6px" />
    </div>
  );
}

export function ShadowField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ts-field">
      <label className="ts-label" htmlFor="ts-shadow">Ombre (shadow)</label>
      <input id="ts-shadow" className="ts-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0 1px 2px rgba(0,0,0,.1)" />
    </div>
  );
}

export interface SpacingValue { x1: string; x2: string; x3: string; x4: string }
export function SpacingField({ value, onChange }: { value: SpacingValue; onChange: (v: SpacingValue) => void }) {
  const set = (k: keyof SpacingValue, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="ts-section">
      <span className="ts-label">Espacements</span>
      <div className="ts-fields ts-fields--2">
        {(['x1', 'x2', 'x3', 'x4'] as const).map((k) => (
          <div className="ts-field" key={k}>
            <label className="ts-label" htmlFor={`ts-space-${k}`}>{k}</label>
            <input id={`ts-space-${k}`} className="ts-input" type="text" value={value[k]} onChange={(e) => set(k, e.target.value)} placeholder="8px" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LogoSloganFields({
  logoUrl,
  slogan,
  onLogoChange,
  onSloganChange,
}: {
  logoUrl: string;
  slogan: string;
  onLogoChange: (v: string) => void;
  onSloganChange: (v: string) => void;
}) {
  return (
    <div className="ts-fields">
      <div className="ts-field">
        <label className="ts-label" htmlFor="ts-logo">Logo (URL)</label>
        <input id="ts-logo" className="ts-input" type="text" value={logoUrl} onChange={(e) => onLogoChange(e.target.value)} placeholder="https://…/logo.png" />
      </div>
      <div className="ts-field">
        <label className="ts-label" htmlFor="ts-slogan">Slogan</label>
        <input id="ts-slogan" className="ts-input" type="text" value={slogan} onChange={(e) => onSloganChange(e.target.value)} placeholder="Votre beauté, sublimée" />
      </div>
    </div>
  );
}
