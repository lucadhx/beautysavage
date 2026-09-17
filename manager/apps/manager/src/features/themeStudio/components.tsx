// M5 — Composants présentationnels Theme Studio.
import { NavLink } from 'react-router-dom';
import { Button, Card } from '@bs/ui';
import type { ThemeStudioTheme } from '@bs/api-client';

export function ThemeScopeTabs() {
  const tabs = [
    { to: '/dev/theme-studio', label: 'Vue d’ensemble', end: true },
    { to: '/dev/theme-studio/vitrine', label: 'Thème Vitrine' },
    { to: '/dev/theme-studio/panel', label: 'Thème Panel' },
  ];
  return (
    <nav className="ts-tabs" aria-label="Sections Theme Studio">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `ts-tab ${isActive ? 'ts-tab--active' : ''}`.trim()}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function ThemeStatusCard({ theme, scopeLabel }: { theme: ThemeStudioTheme | null; scopeLabel: string }) {
  return (
    <Card>
      <div className="ts-status">
        <strong>Thème {scopeLabel}</strong>
        {theme ? (
          <>
            <span>{theme.name}</span>
            {theme.isActive ? <span className="ts-badge ts-badge--active">Actif</span> : <span className="ts-badge ts-badge--draft">Inactif</span>}
          </>
        ) : (
          <span className="ts-badge ts-badge--draft">Aucun thème — défaut appliqué</span>
        )}
      </div>
    </Card>
  );
}

export interface ThemeActionsProps {
  canSave: boolean;
  saving: boolean;
  activating: boolean;
  isActive: boolean;
  hasTheme: boolean;
  onSave: () => void;
  onActivate: () => void;
}

export function ThemeActions({ canSave, saving, activating, isActive, hasTheme, onSave, onActivate }: ThemeActionsProps) {
  return (
    <div className="ts-actions">
      <Button type="button" disabled={!canSave || saving} onClick={onSave}>
        {saving ? 'Sauvegarde…' : hasTheme ? 'Sauvegarder' : 'Créer le thème'}
      </Button>
      {hasTheme && !isActive ? (
        <Button type="button" variant="secondary" disabled={activating} onClick={onActivate}>
          {activating ? 'Activation…' : 'Activer'}
        </Button>
      ) : null}
      {isActive ? <span className="ts-success">Thème actif.</span> : null}
    </div>
  );
}

export function MobileThemeToolbar({ canSave, saving, onSave, onTogglePreview, previewOpen }: {
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onTogglePreview: () => void;
  previewOpen: boolean;
}) {
  return (
    <div className="ts-toolbar ts-preview-toggle">
      <Button type="button" variant="secondary" onClick={onTogglePreview}>
        {previewOpen ? 'Masquer l’aperçu' : 'Aperçu'}
      </Button>
      <Button type="button" disabled={!canSave || saving} onClick={onSave}>
        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
      </Button>
    </div>
  );
}
