import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { SuspensionBanner } from './SuspensionBanner';
import { useCompany } from '@/context/CompanyContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { useScrollLock } from '@/lib/scrollLock';
import { PageSkeleton } from '@/components/ui/Skeleton';

/**
 * SQUELETTE DU MANAGER — LE DOCUMENT EST LE SEUL PROPRIÉTAIRE DU DÉFILEMENT.
 *
 * Ce qu'il y avait avant, et pourquoi ça se battait :
 *
 *   #root            height: 100%            → hauteur du viewport COURANT
 *   layout           h-screen overflow-hidden → hauteur du viewport LARGE (100vh)
 *   colonne          overflow-hidden
 *   <main>           overflow-y-auto          → le vrai défilement
 *
 * Sur mobile, `100vh` vaut la hauteur écran barre d'adresse RÉTRACTÉE. Le
 * layout dépassait donc `#root` de la hauteur de cette barre : le document
 * gagnait un défilement résiduel de ~60-110 px EN PLUS de celui de `<main>`.
 * D'où les symptômes : le premier geste consommait le défilement du document
 * (la barre du haut, simple enfant de la colonne, partait avec lui), et il en
 * fallait un second pour atteindre `<main>`. Au retour, même péage à l'envers.
 * `overflow-hidden` sur les deux ancêtres interdisait par ailleurs tout
 * `position: sticky` de fonctionner à ce niveau.
 *
 * Ce qu'il y a maintenant :
 *
 *   layout           min-h-viewport, AUCUN overflow      → hauteur naturelle
 *   ├─ sidebar       sticky top-0, h-viewport (desktop)  → épinglée, scroll interne
 *   └─ colonne       flex col, min-w-0, AUCUN overflow
 *      ├─ <header>   sticky top-0                        → bandeau + barre mobile
 *      └─ <main>     contenu naturel                     → défile AVEC le document
 *
 * Un seul défilement vertical : celui du document. Un geste = une réponse.
 * Les défilements imbriqués restants sont locaux et fonctionnels (navigation de
 * la sidebar, corps de modale, tableau large) et portent `overscroll-contain`.
 */
export function AppLayout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { company } = useCompany();
  const { pathname } = useLocation();
  const companyName = company?.name?.trim() || 'Manager';
  // Résolution canonique même-origine — JAMAIS la backendUrl publique (réseau).
  const logo = resolvePreviewMediaUrl(company?.logos?.header);

  /*
    Le tiroir ne survit à AUCUN changement de route. `onNavigate` couvre le clic
    sur un lien ; ceci couvre le reste — bouton « précédent » du navigateur,
    redirection d'une garde, navigation programmée. Sans ça, un retour arrière
    laissait le tiroir ouvert ET le verrou de défilement posé.
  */
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  /*
    Tiroir ouvert = page gelée. Le verrou est partagé et compté (voir
    lib/scrollLock) : une modale ouverte par-dessus le tiroir ne rendra pas le
    défilement en se fermant, et le tiroir le rendra en se fermant même si son
    animation de sortie court encore.
  */
  useScrollLock(mobileOpen);

  /*
    RÉINITIALISATION AU CHANGEMENT DE PAGE — ce n'est pas un cache-misère.

    Le défilement appartient désormais au document : sans cette remise à zéro,
    on arrive au milieu d'une page neuve après avoir lu le bas de la
    précédente. `useLayoutEffect` la pose avant la peinture, donc sans saut
    visible, et en `instant` pour ne pas animer un déplacement qu'on n'a pas
    demandé.
  */
  React.useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return (
    <div className="flex min-h-[var(--m-viewport-h)] bg-background">
      {/*
        Sidebar desktop — `sticky` plutôt que `fixed` : elle reste dans le flux,
        donc elle réserve sa largeur sans marge de compensation à maintenir. Son
        enveloppe est un élément flex étiré sur toute la hauteur du document,
        ce qui donne au `sticky` la course dont il a besoin.
      */}
      <div className="hidden shrink-0 md:block">
        <div className="sticky top-0 h-[var(--m-viewport-h)]">
          <Sidebar />
        </div>
      </div>

      {/*
        TIROIR MOBILE — toujours monté, jamais un voile fantôme.

        Il vivait dans un <AnimatePresence> : fermé, son voile plein écran
        (`fixed inset-0`) restait dans la page tant que l'animation de sortie
        n'était pas déclarée finie. Or elle calait quand on choisissait une
        page dans le menu (la page change au même instant) : le voile restait
        là, transparent (opacité 0), par-dessus tout le manager. Plus rien ne
        répondait au doigt — ni les « … », ni les poignées de glisser, ni les
        lignes — alors que tout marchait en ouvrant une page par son adresse.

        Désormais l'état du tiroir est porté par une classe, pas par la fin
        d'une animation : fermé, il est `pointer-events-none` IMMÉDIATEMENT,
        et le panneau devient invisible (hors tabulation) une fois rentré.
      */}
      <div
        className={`fixed inset-0 z-40 md:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
        data-testid="mobile-drawer"
        data-open={mobileOpen || undefined}
      >
        <motion.div
          className="absolute inset-0 bg-black/50"
          initial={false}
          animate={{ opacity: mobileOpen ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setMobileOpen(false)}
        />
        <motion.div
          className="absolute left-0 top-0 h-full"
          initial={false}
          animate={mobileOpen ? { x: 0, visibility: 'visible' } : { x: '-100%', transitionEnd: { visibility: 'hidden' } }}
          style={{ visibility: 'hidden' }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </motion.div>
      </div>

      {/*
        `min-w-0` : sans lui, un enfant large (tableau, ligne de code, URL non
        coupée) impose sa largeur à la colonne flex, qui pousse le layout
        au-delà du viewport et fait apparaître un défilement horizontal global.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          EN-TÊTE COLLANT — bandeau de suspension + barre mobile.

          Les deux sont dans le MÊME bloc collant, pour deux raisons :
          - sur desktop, le bandeau restait visible en permanence (il vivait
            hors du conteneur défilant) ; `sticky` reproduit exactement ça ;
          - sur mobile, la barre et le bandeau doivent bouger ensemble, sinon
            l'un recouvre l'autre.

          `z-30` : au-dessus du dock d'enregistrement (z-20), sous le tiroir
          (z-40) et les modales (z-50). Fond opaque obligatoire — un `sticky`
          transparent laisse défiler le contenu par-dessous en transparence.
        */}
        <header className="sticky top-0 z-30 bg-background">
          <SuspensionBanner />
          <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
              className="rounded-md p-1.5 hover:bg-muted"
            >
              <Menu className="h-5 w-5" />
            </button>
            {logo ? (
              <img src={logo} alt={companyName} className="h-7 w-auto max-w-[110px] object-contain" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Car className="h-4 w-4" />
              </div>
            )}
            <span className="min-w-0 truncate text-sm font-semibold">{companyName}</span>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-5 sm:py-8 md:px-8">
            {/*
              Seul le CONTENU change d'une page à l'autre : la barre latérale
              reste. Pendant que le code de la page arrive, un contenu fantôme
              occupe la place ; la page entre ensuite en fondu. La clé par
              adresse remonte la page à chaque navigation (comme avant), sans
              toucher à la mise en page.
            */}
            <React.Suspense fallback={<PageSkeleton />}>
              <motion.div
                key={pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            </React.Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
