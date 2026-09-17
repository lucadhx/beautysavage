import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell, NotificationMotionProvider } from '../features/notifications';

const DEV_NAV = [
  { to: '/dev', label: 'Vue dev', end: true },
  { to: '/dev/contrats', label: 'Contrats' },
  { to: '/dev/commissions', label: 'Commissions' },
  { to: '/dev/integrated-api', label: 'API intégrée' },
  { to: '/dev/system', label: 'Paramètres Système' },
  { to: '/dev/communication', label: 'Communication' },
  { to: '/dev/theme-studio', label: 'Theme Studio' },
  { to: '/dev/email-templates', label: 'Templates email' },
  { to: '/dev/notification-templates', label: 'Notifications' },
  { to: '/dev/gift-card-templates', label: 'Modèles carte cadeau' },
  { to: '/dev/send-logs', label: 'Logs d’envoi' },
  { to: '/dev/event-logs', label: 'Logs d’événements' },
  { to: '/dev/webhook-failures', label: 'Échecs webhook' },
];

export function DevLayout() {
  return (
    <section>
      <nav
        className="bs-sidebar"
        style={{ flexDirection: 'row', flexWrap: 'wrap', minWidth: 0, marginBottom: 16, alignItems: 'center' }}
        aria-label="Navigation développeur"
      >
        {DEV_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="bs-nav-link">
            {item.label}
          </NavLink>
        ))}
        {/* M9 — cloche scope dev (montée uniquement dans l'espace dev : audience dev stricte). */}
        <span style={{ marginLeft: 'auto' }}>
          <NotificationMotionProvider>
            <NotificationBell scope="dev" />
          </NotificationMotionProvider>
        </span>
      </nav>
      <Outlet />
    </section>
  );
}
