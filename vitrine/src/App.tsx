import { Routes, Route, useLocation } from 'react-router-dom';
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSiteData } from '@/context/SiteDataContext';
import { Loader } from '@/components/Loader';
import { themeApplied } from '@/lib/theme';
import { useMinimumDuration } from '@/lib/minimumDuration';
import { useVisualViewportTop } from '@/lib/viewport';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { CustomerProvider } from '@/context/CustomerContext';
import { RouteBoundary, RouteFallback } from '@/components/RouteBoundary';
import HomePage from '@/pages/HomePage'; // page d'accueil (LCP) : chargée d'emblée
// Les autres routes sont découpées en chunks séparés (code-splitting).
const chargerContact = () => import('@/pages/ContactPage');
/*
  LES PAGES LÉGALES — un seul morceau de code pour les deux.

  Elles partagent composant, mise en forme et états d'erreur : les séparer
  aurait produit deux chunks quasi identiques, et garanti qu'une correction
  n'atteigne qu'une des deux.

  Elles ne sont PAS préchargées : on y va depuis le pied de page, rarement.
*/
const chargerLegal = () => import('@/pages/LegalPage');
const chargerPage = () => import('@/pages/SitePageView');
const ContactPage = React.lazy(chargerContact);
const MentionsLegalesPage = React.lazy(() => chargerLegal().then((m) => ({ default: m.MentionsLegalesPage })));
const PolitiqueConfidentialitePage = React.lazy(() => chargerLegal().then((m) => ({ default: m.PolitiqueConfidentialitePage })));
const SitePageView = React.lazy(chargerPage);
const SuspendedPage = React.lazy(() => import('@/pages/SuspendedPage'));
const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'));
const CatalogPage = React.lazy(() => import('@/pages/CatalogPage'));
const ProductPage = React.lazy(() => import('@/pages/ProductPage'));
const CartPage = React.lazy(() => import('@/pages/CartPage'));
const CustomerAccountPage = React.lazy(() => import('@/pages/CustomerAccountPage'));
const CustomerTrainingsPage = React.lazy(() => import('@/pages/CustomerTrainingsPage'));
const CustomerPasswordResetPage = React.lazy(() => import('@/pages/CustomerPasswordResetPage'));

/**
 * LES PAGES SUIVANTES SONT CHARGÉES PENDANT QU'ON LIT L'ACCUEIL.
 *
 * Corollaire de la navigation en transition : React garde la page courante à
 * l'écran tant que la suivante n'est pas prête. Le clignotement a disparu,
 * mais l'attente, elle, existe toujours — elle est simplement passée du côté
 * du clic, où elle se lit comme un bouton qui ne répond pas.
 *
 * On la supprime à la source : les morceaux de code sont réclamés dès que le
 * navigateur n'a plus rien à faire. Au clic, ils sont déjà là et la bascule
 * est immédiate. `import()` dédoublonne : les réclamer ici ne les télécharge
 * pas deux fois.
 *
 * `requestIdleCallback` — absent de Safari jusqu'à récemment — est optionnel :
 * à défaut, un simple délai, assez long pour laisser l'accueil finir de
 * s'afficher avant qu'on ne demande quoi que ce soit de plus au réseau.
 */
function usePrechargementDesPages() {
  React.useEffect(() => {
    const precharger = () => {
      void chargerContact();
      void chargerPage();
    };
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(precharger);
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(precharger, 1500);
    return () => clearTimeout(t);
  }, []);
}

/** Retour en haut à chaque route, ou vers l'ancre visée. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  React.useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    // Retour en haut INSTANTANÉ : animé, il continuait de tirer la page vers le
    // haut pendant que le visiteur balayait déjà vers le bas.
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash]);
  return null;
}

/**
 * LES PAGES ENTRENT EN FONDU — et rien ne conditionne plus leur arrivée.
 *
 * ══ LE TROU NOIR, ET SA VRAIE CAUSE ═════════════════════════════════════════
 *
 * Après une visite un peu longue, une navigation affichait un en-tête et un
 * pied intacts autour d'un centre VIDE. Un rechargement réparait. La cause
 * était `mode="wait"` : il fait attendre le montage de la page entrante
 * jusqu'à ce que la sortante ait signalé la FIN de son fondu — signal qui peut
 * ne jamais venir (navigation qui interrompt le fondu, onglet en arrière-plan,
 * page entrante qui SUSPEND). L'attente n'avait alors pas de fin.
 *
 * Plus d'`AnimatePresence` ici, donc plus d'animation de SORTIE, donc plus
 * rien à attendre : React démonte l'ancienne page et monte la nouvelle dans le
 * même rendu, et celle-ci se contente d'apparaître en fondu.
 *
 * ══ L'ORDRE DES ROUTES EST UNE DÉCISION ═════════════════════════════════════
 *
 * `/:slug` — un chapitre — est déclarée EN DERNIER, après les routes fixes.
 * Les chapitres vivent à la racine (`/conception`, `/architecture`) parce que
 * c'est ce que le plan de site demande : ce sont les chapitres du site, pas
 * des sous-pages. Le prix est qu'un slug de chapitre pourrait entrer en
 * collision avec une adresse fixe — d'où cet ordre, qui tranche en faveur des
 * adresses fixes, et un `slug` figé côté serveur, qui empêche un renommage de
 * créer la collision après coup.
 */
function PagesEnFondu() {
  const location = useLocation();
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {/*
        ══ DEUX FILETS, ET ILS SONT ICI POUR DE BONNES RAISONS ═══════════════

        `RouteBoundary` BORNE à la zone de contenu l'échec d'une page. Sans
        elle, le morceau de code d'une route qui ne peut plus être chargé — un
        déploiement a remplacé les empreintes pendant que l'onglet restait
        ouvert — faisait démonter la racine ENTIÈRE par React : en-tête et
        pied compris, écran noir, et rien à lire.

        `RouteFallback` remplace le repli d'attente, qui était une boîte VIDE
        d'une hauteur d'écran : un centre de la couleur du fond, entre un
        en-tête et un pied intacts. Elle garde sa hauteur — le pied ne doit pas
        remonter dans le champ — mais annonce désormais ce qu'elle attend.
      */}
      <RouteBoundary resetKey={location.pathname}>
        <React.Suspense fallback={<RouteFallback />}>
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            {/*
              « PRÉSENTER UN PROJET », et non « Contact ».

              Le plan de site est explicite : la prise de contact doit
              ressembler à l'ouverture d'une collaboration, pas à une demande
              de devis. L'adresse le dit avant la page. `/contact` reste
              déclarée : c'est celle qu'un lien déjà écrit porte, et une
              adresse ne meurt pas parce qu'on a trouvé mieux.
            */}
            <Route path="/presenter-un-projet" element={<ContactPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/formations" element={<CatalogPage kind="training" />} />
            <Route path="/prestations" element={<CatalogPage kind="service" />} />
            <Route path="/boutique" element={<CatalogPage kind="all" />} />
            <Route path="/cartes-cadeaux" element={<CatalogPage kind="gift" />} />
            <Route path="/catalogue/:slug" element={<ProductPage />} />
            <Route path="/panier" element={<CartPage />} />
            <Route path="/connexion-client" element={<CustomerAccountPage />} />
            <Route path="/inscription-client" element={<CustomerAccountPage />} />
            <Route path="/espace-client" element={<CustomerAccountPage />} />
            <Route path="/espace-client/formations" element={<CustomerTrainingsPage />} />
            <Route path="/espace-client/mot-de-passe" element={<CustomerPasswordResetPage />} />
            {/*
              ROUTES LÉGALES, ET STABLES.

              Elles sont citées par le pied de page et par la fiche projet du
              Panel. Les renommer casserait des liens déjà indexés — une page
              légale est faite pour être trouvée à la même adresse dans deux
              ans.
            */}
            <Route path="/mentions-legales" element={<MentionsLegalesPage />} />
            <Route path="/politique-de-confidentialite" element={<PolitiqueConfidentialitePage />} />
            {/*
              LES PAGES ÉDITORIALES — une route DYNAMIQUE, jamais une par page.

              Elles vivent sous `/p/` pour ne pas disputer la racine aux
              chapitres : les deux référentiels sont dynamiques, et deux
              espaces de noms qui se recouvrent finissent toujours par se
              recouvrir vraiment.
            */}
            <Route path="/p/:slug" element={<SitePageView />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </React.Suspense>
      </RouteBoundary>
    </motion.div>
  );
}

export function App() {
  const { data, loading, error } = useSiteData();
  // Garde les barres fixes collées au haut de l'écran visible sur mobile.
  useVisualViewportTop();

  /*
    L'ORDRE D'AFFICHAGE — la palette, puis le loader, puis le site.

    `themeApplied()` est lu à CHAQUE rendu, et non gardé dans un état : il
    devient vrai pendant la résolution du bootstrap, donc avant le rendu que
    déclenche `loading`. Aucun état supplémentaire n'a à suivre ça.

    Tant qu'aucune palette n'est connue — la toute première visite, avant
    mémorisation — on ne rend RIEN. Le fond du document reste seul visible,
    quelques centaines de millisecondes. Afficher le loader à ce moment
    reviendrait à le peindre aux couleurs par défaut, puis à le voir changer.
  */
  const palettePrete = themeApplied();
  const chargementVisible = useMinimumDuration(palettePrete && loading, 1000);

  /*
    L'EXCEPTION : un bootstrap en ÉCHEC dès la première visite n'apportera
    jamais de palette. Attendre celle-ci laisserait la page éternellement vide,
    sans un mot d'explication. Le message d'indisponibilité passe donc avant la
    règle, quitte à s'afficher aux couleurs par défaut.
  */
  if (!palettePrete && !error) return null;

  let contenu: React.ReactNode = null;
  if (chargementVisible) {
    contenu = null;
  } else if (error || !data) {
    contenu = (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Site momentanément indisponible</h1>
          <p className="mt-2 text-muted-foreground">Merci de réessayer dans quelques instants.</p>
        </div>
      </div>
    );
  } else if (data.suspended) {
    contenu = (
      <React.Suspense fallback={<Loader />}>
        <SuspendedPage />
      </React.Suspense>
    );
  } else {
    contenu = <Site />;
  }

  return (
    <>
      {/*
        LE CROISEMENT. Le loader est fixe et au-dessus ; le contenu paraît
        dessous en même temps qu'il s'efface. Un `mode="wait"` ici enchaînerait
        les deux fondus bout à bout : une seconde de plus à regarder un écran
        vide, après celle qu'on vient déjà d'imposer.
      */}
      <AnimatePresence>{chargementVisible && <Loader key="loader" />}</AnimatePresence>
      {contenu && (
        <motion.div
          /* `opacity` seule : une transformation ferait de ce bloc le référent
             des positions fixes qu'il contient — la barre de navigation
             cesserait d'être collée à la fenêtre. */
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          {contenu}
        </motion.div>
      )}
    </>
  );
}

/** Le site lui-même, une fois les données là et le site ni suspendu ni en panne. */
function Site() {
  usePrechargementDesPages();
  return (
    <CustomerProvider>
      <ScrollManager />
      <Navbar />
      {/* `v-clip-x` empêche le contenu de rendre la page balayable
          latéralement (voir index.css) ; les surfaces fixes vivent hors de ce
          conteneur. */}
      <div className="v-clip-x">
        <main>
          <PagesEnFondu />
        </main>
        <Footer />
      </div>
    </CustomerProvider>
  );
}
