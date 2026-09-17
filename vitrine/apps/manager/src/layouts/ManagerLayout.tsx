// RX-BLOCKER - Layout manager. Desktop: persistent sidebar. Mobile (<720px): burger + drawer
// slide-in (overlay + Escape + close on click/link + scroll lock). Touch targets >=44px.
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppShell, Button, IconButton } from '@bs/ui';
import { useAuth, roleLabel } from '@bs/auth';
import { NotificationBell, NotificationMotionProvider } from '../features/notifications';
import './managerLayout.css';

const MANAGER_NAV = [
  { to: '/', label: 'Tableau de bord' },
  { to: '/clients', label: 'Clients' },
  { to: '/planning', label: 'Planning' },
  { to: '/catalogue', label: 'Catalogue' },
  { to: '/resultats', label: 'Résultats' },
  { to: '/avis', label: 'Avis' },
  { to: '/faq', label: 'FAQ accueil' },
  { to: '/cartes-cadeaux/templates', label: 'Modèles carte cadeau' },
  { to: '/communication', label: 'Communication' },
  { to: '/parametres', label: 'Paramètres' },
] as const;

type FinanceNavKey = 'overview' | 'timeline' | 'sales' | 'refunds' | 'commissions' | 'giftCards';

const FINANCE_NAV: { key: FinanceNavKey; to: string; label: string }[] = [
  { key: 'overview', to: '/finance', label: "Vue d'ensemble" },
  { key: 'timeline', to: '/finance/timeline', label: 'Timeline' },
  { key: 'sales', to: '/finance/timeline?type=sale', label: 'Ventes' },
  { key: 'refunds', to: '/finance/timeline?type=refund', label: 'Remboursements' },
  { key: 'commissions', to: '/finance/commissions', label: 'Commissions' },
  { key: 'giftCards', to: '/finance/cartes-cadeaux', label: 'Cartes cadeaux' },
];

function isFinanceChildActive(pathname: string, search: string, key: FinanceNavKey): boolean {
  const type = new URLSearchParams(search).get('type');
  switch (key) {
    case 'overview':
      return pathname === '/finance';
    case 'timeline':
      return pathname === '/finance/timeline' && type !== 'sale' && type !== 'refund';
    case 'sales':
      return pathname === '/finance/timeline' && type === 'sale';
    case 'refunds':
      return pathname === '/finance/timeline' && type === 'refund';
    case 'commissions':
      return pathname === '/finance/commissions' || pathname.startsWith('/finance/commissions/');
    case 'giftCards':
      return pathname === '/finance/cartes-cadeaux' || pathname.startsWith('/finance/cartes-cadeaux/');
    default:
      return false;
  }
}

function FinanceNavGroup({
  pathname,
  search,
  open,
  onToggle,
  onNavigate,
}: {
  pathname: string;
  search: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const isFinanceRoute = pathname.startsWith('/finance');

  return (
    <div className="bs-nav-group">
      <button
        type="button"
        className={`bs-nav-group__toggle${isFinanceRoute ? ' bs-nav-group__toggle--active' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
        data-testid="manager-finance-toggle"
      >
        <span>Finance</span>
        <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
      </button>

      {open ? (
        <div className="bs-nav-group__children">
          {FINANCE_NAV.map((item) => {
            const active = isFinanceChildActive(pathname, search, item.key);
            return (
              <Link
                key={item.key}
                to={item.to}
                className="bs-nav-link bs-nav-link--sub"
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function NavItems({
  isDev,
  pathname,
  search,
  financeOpen,
  onToggleFinance,
  onNavigate,
}: {
  isDev: boolean;
  pathname: string;
  search: string;
  financeOpen: boolean;
  onToggleFinance: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      {MANAGER_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'} className="bs-nav-link" onClick={onNavigate}>
          {item.label}
        </NavLink>
      ))}

      <FinanceNavGroup
        pathname={pathname}
        search={search}
        open={financeOpen}
        onToggle={onToggleFinance}
        onNavigate={onNavigate}
      />

      {isDev ? (
        <>
          <NavLink to="/users" className="bs-nav-link" onClick={onNavigate}>
            Utilisateurs
          </NavLink>
          <NavLink to="/dev" className="bs-nav-link" style={{ fontWeight: 600 }} onClick={onNavigate}>
            Développeur
          </NavLink>
        </>
      ) : null}
    </>
  );
}

export function ManagerLayout() {
  const { user, signOut } = useAuth();
  const isDev = user?.role === 'dev';
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const [financeOpen, setFinanceOpen] = useState(location.pathname.startsWith('/finance'));
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (location.pathname.startsWith('/finance')) {
      setFinanceOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AppShell
      header={(
        <div className="bs-mh">
          <IconButton label="Ouvrir le menu" className="bs-sidebar-burger" aria-expanded={open} onClick={() => setOpen(true)}>
            <i className="bi bi-list" aria-hidden="true" />
          </IconButton>
          <div className="bs-mh__brand">
            <strong className="bs-mh__title">Beauty Savage</strong>
            <span className="bs-mh__role">Espace {roleLabel(user?.role) || 'Manager'}</span>
          </div>
          <span className="bs-mh__email">{user?.email}</span>
          <div className="bs-mh__actions">
            <NotificationMotionProvider>
              <NotificationBell scope="admin" />
            </NotificationMotionProvider>
            <Button variant="secondary" className="bs-mh__signout" onClick={() => void signOut()}>
              <i className="bi bi-box-arrow-right" aria-hidden="true" />
              <span className="bs-mh__signout-label">Déconnexion</span>
            </Button>
          </div>
        </div>
      )}
      footer={<span>Espace de gestion</span>}
    >
      <a href="#manager-main" className="bs-skip-link">
        Aller au contenu
      </a>
      <div className="bs-sidebar-layout">
        <nav className="bs-sidebar bs-sidebar--primary" aria-label="Navigation principale">
          <NavItems
            isDev={isDev}
            pathname={location.pathname}
            search={location.search}
            financeOpen={financeOpen}
            onToggleFinance={() => setFinanceOpen((current) => !current)}
          />
        </nav>
        <div className="bs-sidebar-layout__main" id="manager-main">
          <Outlet />
        </div>
      </div>

      {open ? (
        <div className="bs-msidebar-root">
          <div className="bs-msidebar-scrim" onClick={close} aria-hidden="true" />
          <nav className="bs-msidebar" role="dialog" aria-modal="true" aria-label="Menu de navigation">
            <div className="bs-msidebar__head">
              <strong>Navigation</strong>
              <IconButton label="Fermer le menu" onClick={close}>
                <i className="bi bi-x-lg" aria-hidden="true" />
              </IconButton>
            </div>
            <NavItems
              isDev={isDev}
              pathname={location.pathname}
              search={location.search}
              financeOpen={financeOpen}
              onToggleFinance={() => setFinanceOpen((current) => !current)}
              onNavigate={close}
            />
          </nav>
        </div>
      ) : null}
    </AppShell>
  );
}
