// M5 — Layout Theme Studio (dev-only) : en-tête + onglets scope + Outlet. Importe le CSS.
import { Outlet } from 'react-router-dom';
import './themeStudio.css';
import { ThemeScopeTabs } from './components';

export function ThemeStudioLayout() {
  return (
    <section className="ts-page">
      <div className="ts-head">
        <h1 className="ts-head__title">Theme Studio</h1>
        <p className="ts-head__subtitle">
          Deux thèmes : <strong>Vitrine</strong> (site public) et <strong>Panel</strong> (commun
          Manager/Admin et Dev). Aperçu en direct, sauvegarde et activation.
        </p>
      </div>
      <ThemeScopeTabs />
      <Outlet />
    </section>
  );
}
