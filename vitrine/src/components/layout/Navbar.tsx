import * as React from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useScroll, useTransform, type Variants } from 'framer-motion';
import { Menu, X, ArrowRight, ShoppingBag, UserCircle } from 'lucide-react';
import { HelpCircle, LogOut01, Settings01, User01 } from '@untitledui/icons';
import { useSiteData } from '@/context/SiteDataContext';
import { useCustomer } from '@/context/CustomerContext';
import { cn } from '@/lib/utils';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { useScrollLock } from '@/lib/scrollLock';

/**
 * LA BARRE DE NAVIGATION — quatre liens, à plat.
 *
 * ══ POURQUOI PLUS AUCUN MENU DÉROULANT ══════════════════════════════════════
 *
 * Le moteur d'origine servait un site de karting : accueil, présentation,
 * tracés, karts, photos, trois grilles tarifaires, contact. Onze entrées ne
 * tiennent pas dans une barre — d'où deux menus déroulants, et le code qui va
 * avec (survol, pont souris, un seul panneau ouvert à la fois, fermeture au
 * clic extérieur).
 *
 * L.Y Solution a QUATRE entrées, et c'est une décision du plan de site :
 * conception, architecture, l'expérience, présenter un projet. Un menu
 * déroulant pour quatre liens ajoute un geste entre le visiteur et sa
 * destination — et une centaine de lignes qui peuvent se tromper.
 *
 * ══ LES ENTRÉES SONT DES DONNÉES ════════════════════════════════════════════
 *
 * Elles viennent des CHAPITRES publiés et des PAGES éditoriales marquées « au
 * menu ». Un chapitre ajouté depuis le Manager apparaît sans redéploiement —
 * sans quoi l'éditeur n'aurait aucun intérêt. Seule « Présenter un projet »
 * est écrite ici : ce n'est pas un contenu, c'est la sortie du site.
 *
 * ══ LA BARRE NE CHANGE PAS DE HAUTEUR AU DÉFILEMENT ═════════════════════════
 *
 * Elle gagne un fond et une ligne, rien de plus. Une barre qui se rétracte
 * fait sauter tout ce qu'elle surplombe au premier pixel défilé, et ce saut se
 * rejoue à chaque remontée. Ce qui varie, c'est l'opacité du fond — une
 * propriété composable, donc gratuite.
 */

const tiroirNav: Variants = {
  hidden: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.16 } },
};
const tiroirItem: Variants = {
  hidden: { opacity: 0, x: 26 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', duration: 0.5, bounce: 0.2 } },
};

interface Entree {
  to: string;
  label: string;
}

export function Navbar() {
  const { data } = useSiteData();
  const [defile, setDefile] = React.useState(false);
  const [tiroir, setTiroir] = React.useState(false);
  const location = useLocation();
  const { customer, logout } = useCustomer();

  React.useEffect(() => {
    const onScroll = () => setDefile(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Une navigation referme le tiroir : sinon il reste ouvert par-dessus la page
  // d'arrivée, et le visiteur croit que son clic n'a rien fait.
  React.useEffect(() => setTiroir(false), [location.pathname]);
  useScrollLock(tiroir);

  const entrees: Entree[] = React.useMemo(() => {
    const pages = (data?.pages ?? [])
      .filter((p) => p.showInNav)
      .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
      .map((p) => ({ to: `/p/${p.slug}`, label: p.navLabel || p.title }));
    return [
      { to: '/formations', label: 'Formations' },
      { to: '/prestations', label: 'Prestations' },
      { to: '/boutique', label: 'Boutique' },
      { to: '/cartes-cadeaux', label: 'Cartes cadeaux' },
      { to: '/contact', label: 'Contact' },
      ...pages,
    ];
  }, [data?.pages]);

  const logo = resolvePreviewMediaUrl(data?.company?.logos?.header, data?.network?.backendUrl);
  const nom = data?.company?.name || 'BeautySavage';

  return (
    <>
      <header
        className="fixed inset-x-0 top-[var(--vv-top,0px)] z-40 transition-[background-color,border-color] duration-500"
        style={{
          background: defile
            ? 'color-mix(in srgb, var(--v-menu-background) 92%, transparent)'
            : 'var(--v-menu-background)',
          color: 'var(--v-menu-foreground)',
          backdropFilter: defile ? 'blur(18px)' : undefined,
          WebkitBackdropFilter: defile ? 'blur(18px)' : undefined,
          borderBottom: `1px solid ${defile ? 'var(--v-border)' : 'transparent'}`,
        }}
      >
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label={nom}>
            {logo ? (
              <img src={logo} alt={nom} className="h-8 w-auto md:h-9" />
            ) : (
              <span
                className="text-base font-semibold tracking-[-0.02em] md:text-lg"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {nom}
              </span>
            )}
          </Link>

          <nav className="hidden items-center gap-9 lg:flex">
            {entrees.map((e) => (
              <LienDeBarre key={e.to} to={e.to} actif={location.pathname === e.to}>
                {e.label}
              </LienDeBarre>
            ))}
            <Link
              to="/panier"
              aria-label="Panier"
              className="inline-flex h-10 w-10 items-center justify-center"
              style={{ color: 'var(--v-accent)', borderRadius: 'var(--v-radius)' }}
            >
              <ShoppingBag className="h-4 w-4" />
            </Link>
            <ProfileDropdown customer={customer} onLogout={logout} />
            <Link
              to="/prestations"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold transition-transform duration-300 hover:-translate-y-0.5"
              style={{
                background: 'var(--v-primary)',
                color: 'var(--v-primary-foreground)',
                borderRadius: 'var(--v-radius)',
              }}
            >
              Reserver
            </Link>
          </nav>

          <div className="flex items-center gap-2 lg:hidden">
            <Link
              to="/panier"
              aria-label="Panier"
              className="inline-flex h-10 w-10 items-center justify-center"
              style={{ color: 'var(--v-accent)', borderRadius: 'var(--v-radius)' }}
            >
              <ShoppingBag className="h-4 w-4" />
            </Link>
            <ProfileDropdown customer={customer} onLogout={logout} compact />
            <button
              type="button"
              onClick={() => setTiroir(true)}
              aria-label="Ouvrir le menu"
              className="inline-flex h-10 w-10 items-center justify-center"
              style={{ border: '1px solid color-mix(in srgb, var(--v-menu-foreground) 24%, transparent)', borderRadius: 'var(--v-radius)' }}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/*
          LE FILET DE PROGRESSION — un pixel, en bas de la barre.

          Il dit où l'on en est dans une page qui, par construction, est longue
          et peu meublée : sans repère, un chapitre de quatre volets donne
          l'impression de ne jamais finir. Un pixel suffit ; une barre épaisse
          serait un élément d'interface de plus à regarder.
        */}
        <ProgressionDeLecture />
      </header>

      <AnimatePresence>{tiroir && <Tiroir entrees={entrees} onFermer={() => setTiroir(false)} />}</AnimatePresence>
    </>
  );
}

function ProfileDropdown({
  customer,
  onLogout,
  compact = false,
}: {
  customer: ReturnType<typeof useCustomer>['customer'];
  onLogout: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const name = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email
    : 'Espace client';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Ouvrir le profil"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group inline-flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
        style={{ color: 'var(--v-accent)' }}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full">
          <UserCircle className="h-4 w-4" />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className={cn('absolute right-0 z-50 mt-3 w-64 overflow-hidden rounded-lg border text-sm shadow-xl', compact && 'right-[-3.25rem]')}
            style={{
              background: 'var(--v-menu-background)',
              color: 'var(--v-menu-foreground)',
              borderColor: 'color-mix(in srgb, var(--v-menu-foreground) 18%, transparent)',
              boxShadow: '0 20px 55px color-mix(in srgb, var(--v-foreground) 14%, transparent)',
            }}
          >
            <div className="flex items-center gap-3 border-b p-3" style={{ borderColor: 'color-mix(in srgb, var(--v-menu-foreground) 18%, transparent)' }}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
                <User01 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                <p className="truncate text-xs" style={{ color: 'color-mix(in srgb, var(--v-menu-foreground) 62%, var(--v-menu-background))' }}>{customer?.email || 'Connexion requise'}</p>
              </div>
            </div>
            <div className="grid p-2">
              <DropdownLink to="/espace-client" icon={User01} onClick={() => setOpen(false)}>
                {customer ? 'Mon espace client' : 'Connexion client'}
              </DropdownLink>
              <DropdownLink to="/espace-client/formations" icon={Settings01} onClick={() => setOpen(false)}>
                Mes formations
              </DropdownLink>
              <DropdownLink to="/contact" icon={HelpCircle} onClick={() => setOpen(false)}>
                Support institut
              </DropdownLink>
            </div>
            {customer && (
              <div className="border-t p-2" style={{ borderColor: 'color-mix(in srgb, var(--v-menu-foreground) 18%, transparent)' }}>
                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 font-semibold transition-colors hover:bg-white/10"
                >
                  <LogOut01 className="h-4 w-4" /> Deconnexion
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DropdownLink({
  to,
  icon: Icon,
  onClick,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-2 rounded-md px-3 py-2 font-semibold transition-colors hover:bg-white/10">
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </Link>
  );
}

/**
 * UN LIEN QUI SE SOULIGNE EN SE TRAÇANT.
 *
 * Le soulignement part de la gauche et s'étend — il ne se contente pas
 * d'apparaître. C'est le même geste que la barre du bloc « positionnement » de
 * l'accueil, et cette répétition n'est pas une économie : c'est ce qui fait
 * qu'un site a une écriture plutôt qu'une collection d'effets.
 */
function LienDeBarre({
  to, actif, children,
}: {
  to: string;
  actif: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group relative text-[13px] font-semibold tracking-[0.04em] transition-colors duration-300"
      style={{
        color: actif
          ? 'var(--v-menu-foreground)'
          : 'color-mix(in srgb, var(--v-menu-foreground) 70%, var(--v-menu-background))',
      }}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'absolute -bottom-1.5 left-0 h-px w-full origin-left transition-transform duration-300',
          actif ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
        )}
        style={{ background: 'var(--v-accent)' }}
      />
    </Link>
  );
}

function ProgressionDeLecture() {
  const { scrollYProgress } = useScroll();
  const opacite = useTransform(scrollYProgress, [0, 0.01], [0, 1]);
  return (
    <motion.div
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-px origin-left"
      style={{ background: 'var(--v-accent)', scaleX: scrollYProgress, opacity: opacite }}
    />
  );
}

/**
 * LE TIROIR MOBILE — dans un portail, hors de l'en-tête.
 *
 * L'en-tête porte `backdrop-filter` : tout descendant devient alors membre de
 * son contexte de composition, et un `position: fixed` posé dedans se cadre
 * sur L'EN-TÊTE au lieu de la fenêtre. Le tiroir occupait donc la hauteur de
 * la barre. `createPortal` le monte à la racine du document, où `fixed` veut
 * dire ce qu'il dit.
 */
function Tiroir({ entrees, onFermer }: { entrees: Entree[]; onFermer: () => void }) {
  const { data } = useSiteData();
  const logo = resolvePreviewMediaUrl(data?.company?.logos?.header, data?.network?.backendUrl);
  const nom = data?.company?.name || 'BeautySavage';
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] lg:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div
        className="absolute inset-0"
        onClick={onFermer}
        style={{ background: 'color-mix(in srgb, var(--v-background) 88%, transparent)' }}
      />
      <motion.div
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col px-7 pb-10 pt-7"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', duration: 0.5, bounce: 0.06 }}
        style={{ background: 'var(--v-menu-background)', color: 'var(--v-menu-foreground)', borderLeft: '1px solid color-mix(in srgb, var(--v-menu-foreground) 18%, transparent)' }}
      >
        <div className="flex items-center justify-between gap-4">
          <Link to="/" onClick={onFermer} className="min-w-0" aria-label={nom}>
            {logo ? (
              <img src={logo} alt={nom} className="h-9 max-w-[180px] object-contain" />
            ) : (
              <span className="truncate text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>{nom}</span>
            )}
          </Link>
          <button type="button" onClick={onFermer} aria-label="Fermer le menu" className="shrink-0">
            <X className="h-6 w-6" />
          </button>
        </div>

        <motion.nav
          variants={tiroirNav}
          initial="hidden"
          animate="show"
          className="mt-12 flex flex-col gap-7"
        >
          {entrees.map((e) => (
            <motion.div key={e.to} variants={tiroirItem}>
              <Link
                to={e.to}
                className="text-2xl font-semibold tracking-[-0.02em]"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                {e.label}
              </Link>
            </motion.div>
          ))}
          <motion.div variants={tiroirItem} className="mt-6">
            <Link
              to="/panier"
              className="inline-flex items-center gap-2 px-6 py-3.5 text-sm font-semibold"
              style={{
                background: 'var(--v-primary)',
                color: 'var(--v-primary-foreground)',
                borderRadius: 'var(--v-radius)',
              }}
            >
              Panier <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
          <motion.div variants={tiroirItem}>
            <Link to="/espace-client" className="text-lg font-semibold">Mon espace client</Link>
          </motion.div>
          <motion.div variants={tiroirItem}>
            <Link to="/espace-client/formations" className="text-lg font-semibold">Mes formations</Link>
          </motion.div>
        </motion.nav>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
