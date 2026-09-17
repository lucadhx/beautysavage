// M5 — Pages Theme Studio : dashboard (2 thèmes) + éditeurs vitrine/panel.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, LoadingState } from '@bs/ui';
import { getActiveTheme } from '@bs/api-client';
import { ThemeEditor } from './ThemeEditor';
import { ThemeStatusCard } from './components';

export function ThemeStudioDashboard() {
  const vitrine = useQuery({ queryKey: ['theme-studio', 'vitrine'], queryFn: () => getActiveTheme('vitrine'), retry: false });
  const panel = useQuery({ queryKey: ['theme-studio', 'panel'], queryFn: () => getActiveTheme('panel'), retry: false });

  return (
    <div className="ts-page">
      <Card>
        <p className="ts-note">
          Le site public utilise le thème <strong>Vitrine</strong>. Les espaces Manager/Admin et Dev
          partagent le <strong>même</strong> thème <strong>Panel</strong> (il n'existe pas de thème
          admin ni dev séparé).
        </p>
      </Card>

      <div className="ts-cards">
        <div className="ts-page">
          {vitrine.status === 'pending' ? <LoadingState /> : <ThemeStatusCard theme={vitrine.data ?? null} scopeLabel="Vitrine" />}
          <Link className="ts-tab" to="/dev/theme-studio/vitrine">Éditer le thème Vitrine</Link>
        </div>
        <div className="ts-page">
          {panel.status === 'pending' ? <LoadingState /> : <ThemeStatusCard theme={panel.data ?? null} scopeLabel="Panel" />}
          <Link className="ts-tab" to="/dev/theme-studio/panel">Éditer le thème Panel</Link>
        </div>
      </div>
    </div>
  );
}

export function VitrineThemeEditorPage() {
  return <ThemeEditor scope="vitrine" scopeLabel="Vitrine" />;
}

export function PanelThemeEditorPage() {
  return <ThemeEditor scope="panel" scopeLabel="Panel" />;
}
