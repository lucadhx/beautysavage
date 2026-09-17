import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { IconButton, Badge } from '@bs/ui';
import { getSiteIdentity, resolveMediaUrl } from '@bs/api-client';
import { useAuth } from '@bs/auth';
import { useCart } from '../features/cart';

// RX3 — En-tête vitrine premium : marque, navigation active (NavLink), panier avec badge,
// et menu burger → Drawer partagé sur mobile. Mobile-first, cibles ≥44px, tokens --bs-* only.

interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Accueil', end: true },
  { to: '/prestations', label: 'Prestations' },
  { to: '/formations', label: 'Formations' },
  { to: '/produits', label: 'Produits' },
  { to: '/cartes-cadeaux', label: 'Cartes cadeaux' },
];

function CartLink({ count }: { count: number }) {
  return (
    <NavLink to="/panier" className="bs-nav-link vh-cart" aria-label={`Panier${count > 0 ? `, ${count} article${count > 1 ? 's' : ''}` : ''}`}>
      <i className="bi bi-bag" aria-hidden="true" />
      <span className="vh-cart__text">Panier</span>
      {count > 0 ? (
        <span className="vh-cart__badge">
          <Badge tone="accent">{count}</Badge>
        </span>
      ) : null}
    </NavLink>
  );
}

export function VitrineHeader() {
  const { status, user } = useAuth();
  const { summary } = useCart();
  const location = useLocation();
  const identity = useQuery({ queryKey: ['home', 'identity'], queryFn: ({ signal }) => getSiteIdentity(signal), staleTime: 300_000 });
  const siteName = identity.data?.siteName || 'Beauty Savage';
  const logo = resolveMediaUrl(identity.data?.logoUrl);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Ferme le menu mobile à chaque changement de route.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Menu ouvert : fermeture Escape + verrouillage du scroll de fond.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const accountEntry: NavEntry =
    status === 'authenticated' ? { to: '/mon-compte', label: 'Mon compte' } : { to: '/connexion', label: 'Connexion' };

  return (
    <div className="vh">
      <Link to="/" className="vh__brand" aria-label={`${siteName} — accueil`}>
        {logo ? <img className="vh__logo" src={logo} alt={siteName} /> : siteName}
      </Link>

      {/* Navigation principale (desktop) */}
      <nav className="vh__nav" aria-label="Navigation principale">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="bs-nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Actions (toujours visibles) */}
      <div className="vh__actions">
        <CartLink count={summary.count} />
        <NavLink to={accountEntry.to} className="bs-nav-link vh__account" title={user?.email ?? accountEntry.label}>
          <i className="bi bi-person-circle" aria-hidden="true" />
          <span className="vh__account-text">{accountEntry.label}</span>
        </NavLink>
        <span className="vh__burger">
          <IconButton label="Ouvrir le menu" onClick={() => setMenuOpen(true)}>
            <i className="bi bi-list" aria-hidden="true" />
          </IconButton>
        </span>
      </div>

      {/* Menu mobile : VRAIE sidebar à gauche, même couleur que le header, entrée item par item. */}
      {menuOpen ? (
        <div className="vh-side-root">
          <div className="vh-side-scrim" onClick={closeMenu} aria-hidden="true" />
          <nav className="vh-side" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="vh-side__head">
              <span className="vh-side__title">Menu</span>
              <IconButton label="Fermer le menu" onClick={closeMenu}>
                <i className="bi bi-x-lg" aria-hidden="true" />
              </IconButton>
            </div>
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="bs-nav-link vh-side__link" onClick={closeMenu}>
                {item.label}
              </NavLink>
            ))}
            <hr className="vh-side__sep" />
            <NavLink to="/mes-formations" className="bs-nav-link vh-side__link" onClick={closeMenu}>
              Mes formations
            </NavLink>
            <NavLink to={accountEntry.to} className="bs-nav-link vh-side__link" onClick={closeMenu}>
              {accountEntry.label}
            </NavLink>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
