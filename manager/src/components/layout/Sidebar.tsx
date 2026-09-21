import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car, LogOut } from 'lucide-react';
import { NAV_ITEMS, GROUP_ORDER, type NavItem } from '@/config/nav';
import { useAuth } from '@/context/AuthContext';
import { isPanelPrincipal } from '@/types';
import { useCompany } from '@/context/CompanyContext';
import { useContactUnread } from '@/context/ContactUnreadContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { RoleBadge } from '@/components/RoleBadge';
import { cn } from '@/lib/utils';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isDev, logout } = useAuth();
  const { company } = useCompany();
  const { count: unread } = useContactUnread();
  const companyName = company?.name?.trim() || 'Manager';
  // Résolution canonique même-origine — JAMAIS la backendUrl publique (réseau).
  const logo = resolvePreviewMediaUrl(company?.logos?.header);
  const items = NAV_ITEMS.filter((i) => !i.devOnly || isDev);

  const badgeFor = (item: NavItem): number | undefined =>
    item.badge === 'contactUnread' && unread > 0 ? unread : undefined;

  const renderSpace = (section: NavItem['section'], title: string) => {
    const spaceItems = items.filter((i) => i.section === section);
    if (spaceItems.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider opacity-50">{title}</p>
        {GROUP_ORDER[section].map((group) => {
          const groupItems = spaceItems.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="space-y-0.5 pb-1">
              <p className="px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-35">{group}</p>
              {groupItems.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={onNavigate} badge={badgeFor(item)} />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      className="flex h-full w-64 flex-col"
      style={{ background: 'var(--m-sidebar)', color: 'var(--m-sidebar-foreground)' }}
    >
      <div className="flex items-center gap-2.5 px-6 py-5">
        {logo ? (
          <img src={logo} alt={companyName} className="h-9 w-auto max-w-[120px] object-contain" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
            <Car className="h-5 w-5" />
          </div>
        )}
        <div>
          <p className="text-sm font-semibold leading-tight">{companyName}</p>
          <p className="text-[11px] opacity-60">Manager</p>
        </div>
      </div>

      {/*
        Défilement LOCAL et assumé : la navigation peut être plus haute que
        l'écran (espace Développeur déplié). `overscroll-contain` l'empêche de
        rendre la main au document quand elle arrive en butée — sinon un geste
        appuyé dans le menu finit par faire défiler la page derrière lui.
      */}
      <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-2">
        {renderSpace('manager', 'Manager')}
        {/* Espace Développeur : ENTIÈREMENT absent pour les non-DEV (items filtrés). */}
        {renderSpace('dev', 'Développeur')}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-3 py-1">
          <p className="min-w-0 truncate text-sm font-medium">{user?.name || user?.email}</p>
          {user?.role && <RoleBadge role={user.role} className="shrink-0" />}
        </div>
        {/*
          D'OÙ VIENT CETTE IDENTITÉ (L12.B-UI).

          Un développeur connecté par L.Y Solution doit voir qu'il n'utilise
          PAS un compte de ce projet — sans quoi il chercherait son mot de
          passe dans « Profil », et s'étonnerait de ne pas pouvoir le changer.
          La mention est discrète : c'est un rappel, pas une décoration.
        */}
        {isPanelPrincipal(user) && (
          <p className="mb-2 px-3 text-[11px] uppercase tracking-wide opacity-70">
            Accès L.Y Solution
          </p>
        )}
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm opacity-80 transition hover:bg-white/10 hover:opacity-100"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({ item, onNavigate, badge }: { item: NavItem; onNavigate?: () => void; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === '/'} onClick={onNavigate}>
      {({ isActive }) => (
        <div
          className={cn(
            'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
            isActive ? 'font-medium' : 'opacity-70 hover:opacity-100 hover:bg-white/5'
          )}
        >
          {isActive && (
            <motion.div
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-md bg-white/10"
              transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            />
          )}
          <Icon className="relative z-10 h-4 w-4 shrink-0" />
          <span className="relative z-10 flex-1 truncate">{item.label}</span>
          {/* Badge numérique — ABSENT à zéro (résolu en amont). */}
          {badge !== undefined && (
            <span className="relative z-10 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-primary-foreground tabular-nums">
              {badge}
            </span>
          )}
        </div>
      )}
    </NavLink>
  );
}
