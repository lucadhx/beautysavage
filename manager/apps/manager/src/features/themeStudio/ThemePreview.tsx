// M5 — Aperçu live local. Les variables --bs-* du brouillon sont appliquées en inline style
// sur le conteneur (cascade aux enfants) — pas besoin de sauvegarder, et le thème global du
// panel n'est PAS modifié. Vitrine et Panel ont des aperçus distincts.
import type { CSSProperties } from 'react';
import type { ThemeScope } from '@bs/api-client';
import { computePreviewVars, type ThemeDraft } from './themeDraft';

function VitrinePreview() {
  return (
    <div className="ts-preview__inner">
      <div className="ts-pv-hero">
        <h3>Votre institut, sublimé</h3>
        <p className="ts-note">Aperçu hero vitrine</p>
        <button type="button" className="ts-pv-btn">Découvrir</button>
      </div>
      <div className="ts-pv-card">
        <strong>Soin signature</strong>
        <span className="ts-note">Prestation 60 min</span>
        <span className="ts-pv-price">80,00 €</span>
        <button type="button" className="ts-pv-btn">Réserver</button>
      </div>
    </div>
  );
}

function PanelPreview() {
  return (
    <div className="ts-preview__inner">
      <div className="ts-pv-shell">
        <div className="ts-pv-shell__header">Espace Panel</div>
        <div className="ts-pv-shell__body">
          <div className="ts-pv-card">
            <span className="ts-note">Ventes du jour</span>
            <strong style={{ fontSize: '1.4rem' }}>1 240 €</strong>
            <span className="ts-pv-badge">À jour</span>
          </div>
          <button type="button" className="ts-pv-btn">Action principale</button>
          <div className="ts-pv-list">
            <div className="ts-pv-list__row"><span>Réservation n°1024</span><span className="ts-pv-badge">Confirmée</span></div>
            <div className="ts-pv-list__row"><span>Réservation n°1025</span><span className="ts-pv-badge">Confirmée</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemePreview({ scope, draft }: { scope: ThemeScope; draft: ThemeDraft }) {
  const vars = computePreviewVars(draft, scope) as unknown as CSSProperties;
  return (
    <div className="ts-preview" style={vars} data-testid="theme-preview" aria-label="Aperçu du thème">
      {scope === 'vitrine' ? <VitrinePreview /> : <PanelPreview />}
    </div>
  );
}
