// M7 — Layout Notification Studio (dev-only) : en-tête + onglets (Templates / Catégories) + Outlet.
import { NavLink, Outlet } from 'react-router-dom';
import './notificationStudio.css';

const TABS = [
  { to: '/dev/notification-templates', label: 'Templates', end: true },
  { to: '/dev/notification-categories', label: 'Catégories' },
];

export function NotificationStudioLayout() {
  return (
    <section className="ns-page">
      <div className="ns-head">
        <h1 className="ns-head__title">Notifications</h1>
        <p className="ns-head__subtitle">
          Édition des templates (contenu, catégorie, priorité, persistance, action) et des catégories.
          Le template ne connaît pas le scope (admin/dev/both) : le moteur le choisit à l'envoi.
        </p>
      </div>
      <nav className="ns-tabs" aria-label="Sections notifications">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `ns-tab ${isActive ? 'ns-tab--active' : ''}`.trim()}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
