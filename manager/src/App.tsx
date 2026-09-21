import * as React from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth, RequireDev } from '@/components/RouteGuards';
import SignatureReturnPage from '@/pages/SignatureReturnPage';
import { ContactUnreadProvider } from '@/context/ContactUnreadContext';
import { Spinner } from '@/components/ui/primitives';

function lazyPage<T extends { default: React.ComponentType<any> }>(loader: () => Promise<T>) {
  return React.lazy(() => loader().catch((err) => {
    const message = String(err?.message || err || '');
    const chunkMissing = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(message);
    if (chunkMissing && sessionStorage.getItem('manager.chunk.reload') !== 'done') {
      sessionStorage.setItem('manager.chunk.reload', 'done');
      window.location.reload();
      return new Promise<T>(() => undefined);
    }
    throw err;
  }));
}

// Pages chargées à la demande (code-splitting) : le premier chargement ne
// télécharge plus les 20 pages + dnd-kit d'un bloc. Chaque page devient un chunk.
const LoginPage = lazyPage(() => import('@/pages/LoginPage'));
const ForgotPasswordPage = lazyPage(() => import('@/pages/PasswordResetPages').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazyPage(() => import('@/pages/PasswordResetPages').then((m) => ({ default: m.ResetPasswordPage })));
const ActivateAccountPage = lazyPage(() => import('@/pages/ActivateAccountPage'));
const FederatedCallbackPage = lazyPage(() => import('@/pages/FederatedCallbackPage'));
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'));
const CompanyPage = lazyPage(() => import('@/pages/CompanyPage'));
/*
  LES CHAPITRES DU RÉCIT — une liste, et une fiche par chapitre.

  La fiche a une ADRESSE plutôt qu'une fenêtre modale : un chapitre porte un
  chapô, jusqu'à douze volets réordonnables et une image de tête, ce qui ne
  tient pas dans une fenêtre posée sur une page qui défile déjà.
*/
const HomeContentPage = lazyPage(() => import('@/pages/HomeContentPage'));
const CommerceFormationsPage = lazyPage(() => import('@/pages/commerce/CommerceFormationsPage'));
const CommerceFormationEditPage = lazyPage(() => import('@/pages/commerce/CommerceFormationEditPage'));
const CommercePrestationsPage = lazyPage(() => import('@/pages/commerce/CommercePrestationsPage'));
const CommercePrestationEditPage = lazyPage(() => import('@/pages/commerce/CommercePrestationEditPage'));
const CommerceCalendarPage = lazyPage(() => import('@/pages/commerce/CommerceCalendarPage'));
const CommerceCommissionsPage = lazyPage(() => import('@/pages/commerce/CommerceCommissionsPage'));
const CommerceClientsPage = lazyPage(() => import('@/pages/commerce/CommerceClientsPage'));
const CommerceVentesPage = lazyPage(() => import('@/pages/commerce/CommerceVentesPage'));
const CommerceCartesCadeauxPage = lazyPage(() => import('@/pages/commerce/CommerceCartesCadeauxPage'));
const CommerceValidationFormationsPage = lazyPage(() => import('@/pages/commerce/CommerceValidationFormationsPage'));
const CommerceAvisPage = lazyPage(() => import('@/pages/commerce/CommerceAvisPage'));
const CommerceRemboursementsPage = lazyPage(() => import('@/pages/commerce/CommerceRemboursementsPage'));
const CommerceApiKeysPage = lazyPage(() => import('@/pages/commerce/CommerceApiKeysPage'));
const SitePagesPage = lazyPage(() => import('@/pages/SitePagesPage'));
const SitePageEditPage = lazyPage(() => import('@/pages/SitePageEditPage'));
const MediaLibraryPage = lazyPage(() => import('@/pages/MediaLibraryPage'));
const ContactsPage = lazyPage(() => import('@/pages/ContactsPage'));
const ThemePage = lazyPage(() => import('@/pages/ThemePage'));
const StatusPage = lazyPage(() => import('@/pages/StatusPage'));
const ProfilePage = lazyPage(() => import('@/pages/ProfilePage'));
const SupportInfoPage = lazyPage(() => import('@/pages/SupportInfoPage'));
const DevCompanyPage = lazyPage(() => import('@/pages/dev/DevCompanyPage'));
const DevTeamPage = lazyPage(() => import('@/pages/dev/DevTeamPage'));
const DevAccountsPage = lazyPage(() => import('@/pages/dev/DevAccountsPage'));
const DevManagerThemePage = lazyPage(() => import('@/pages/dev/DevManagerThemePage'));
const DevRolesPage = lazyPage(() => import('@/pages/dev/DevRolesPage'));
const SystemConfigPage = lazyPage(() => import('@/pages/dev/SystemConfigPage'));
const DevPanelPage = lazyPage(() => import('@/pages/dev/DevPanelPage'));
const DeploymentPage = lazyPage(() => import('@/pages/dev/DeploymentPage'));
const DeploymentsControlPage = lazyPage(() => import('@/pages/dev/DeploymentsControlPage'));
const DevEventsPage = lazyPage(() => import('@/pages/dev/DevEventsPage'));
const DevContractsPage = lazyPage(() => import('@/pages/dev/DevContractsPage'));
const DevEmailTemplatesPage = lazyPage(() => import('@/pages/dev/DevEmailTemplatesPage'));
const DevEmailDeliveriesPage = lazyPage(() => import('@/pages/dev/DevEmailDeliveriesPage'));
const MyContractPage = lazyPage(() => import('@/pages/MyContractPage'));
const MyCompanyPage = lazyPage(() => import('@/pages/MyCompanyPage'));
const FacturesPage = lazyPage(() => import('@/pages/FacturesPage'));
const ContactSubmissionsPage = lazyPage(() => import('@/pages/ContactSubmissionsPage'));
const ContractReturnPage = lazyPage(() => import('@/pages/ContractReturnPage'));
const NotFoundPage = lazyPage(() => import('@/pages/NotFoundPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-[calc(var(--m-viewport-h)*0.6)] items-center justify-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function App() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <React.Suspense fallback={<RouteFallback />}>
        <Routes location={location} key={location.pathname}>
          <Route path="/login" element={<LoginPage />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
        {/*
          ACTIVATION DU PREMIER ACCÈS (LOT 2C) — publique, forcément : son
          destinataire n'a pas encore de mot de passe.

          Deux chemins, UNE page. Le lien envoyé par e-mail porte le chemin
          français, cohérent avec le reste du manager ; `/activate-account` est
          l'alias que la spécification du lot nomme, conservé pour qu'une URL
          écrite à la main ne tombe pas sur un 404. Même composant : il n'y a
          rien à faire diverger.
        */}
        <Route path="/activer-mon-compte" element={<ActivateAccountPage />} />
        <Route path="/activate-account" element={<ActivateAccountPage />} />
        {/*
          RETOUR DE CONNEXION L.Y SOLUTION — PUBLIQUE, et c'est vital.

          À l'instant où le navigateur arrive ici, l'utilisateur n'a AUCUNE
          session de projet : il en apporte le MOYEN, pas le résultat. Une garde
          d'authentification le renverrait au login en détruisant au passage
          l'assertion qu'il transportait — et sans jamais dire pourquoi. C'est
          exactement le défaut qu'avait connu le lien de réinitialisation du
          Panel ; la leçon vaut d'être réappliquée plutôt que réapprise.

          Montée ici, avec les autres routes publiques, HORS de `RequireAuth`.
        */}
        <Route path="/connexion/ly-solution/retour" element={<FederatedCallbackPage />} />
          <Route
            element={
              <RequireAuth>
                <ContactUnreadProvider>
                  <AppLayout />
                </ContactUnreadProvider>
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="retour-signature" element={<SignatureReturnPage />} />
            <Route path="entreprise" element={<CompanyPage />} />
            <Route path="accueil" element={<HomeContentPage />} />
            <Route path="commerce" element={<Navigate to="/commerce/formations" replace />} />
            <Route path="commerce/formations" element={<CommerceFormationsPage />} />
            <Route path="commerce/formations/:id" element={<CommerceFormationEditPage />} />
            <Route path="commerce/prestations" element={<CommercePrestationsPage />} />
            <Route path="commerce/prestations/:id" element={<CommercePrestationEditPage />} />
            <Route path="commerce/calendrier" element={<CommerceCalendarPage />} />
            <Route path="commerce/vente" element={<Navigate to="/commerce/ventes" replace />} />
            <Route path="commerce/cartes-cadeaux" element={<CommerceCartesCadeauxPage />} />
            <Route path="commerce/validation-formations" element={<CommerceValidationFormationsPage />} />
            <Route path="commerce/validation-formations/:submissionId" element={<CommerceValidationFormationsPage />} />
            <Route path="commerce/avis" element={<CommerceAvisPage />} />
            <Route path="commerce/mails" element={<DevEmailTemplatesPage />} />
            <Route path="commerce/remboursements" element={<CommerceRemboursementsPage />} />
            <Route path="commerce/commissions" element={<CommerceCommissionsPage />} />
            <Route path="commerce/cles-api" element={<RequireDev><CommerceApiKeysPage /></RequireDev>} />
            <Route path="commerce/clients" element={<CommerceClientsPage />} />
            <Route path="commerce/clients/:customerId" element={<CommerceClientsPage />} />
            <Route path="commerce/ventes" element={<CommerceVentesPage />} />
            <Route path="commerce/ventes/:saleId" element={<CommerceVentesPage />} />
            {/* `:id` vaut « nouveau » pour une création — une seule page sert
                les deux cas, donc un seul formulaire à faire évoluer. */}
            <Route path="pages" element={<SitePagesPage />} />
            <Route path="pages/:id" element={<SitePageEditPage />} />
            <Route path="mediatheque" element={<MediaLibraryPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="theme" element={<ThemePage />} />
            <Route path="statut" element={<StatusPage />} />
            {/*
              MON ENTREPRISE — l’identité JURIDIQUE du client, en lecture seule.
              Distincte de « /entreprise », qui porte la fiche COMMERCIALE du
              site (enseigne, logos, horaires) et reste éditable.
            */}
            <Route path="mon-entreprise" element={<MyCompanyPage />} />
            <Route path="contrat" element={<MyContractPage />} />
            {/*
              * LE RETOUR DE SIGNATURE — une seule adresse, deux destinataires.
              *
              * La plateforme n'accepte qu'UNE URL de retour par document et n'y
              * ajoute aucun parametre : developpeur et client y atterrissent
              * ensemble. `/retour-signature` lit la session et renvoie chacun
              * chez lui ; la page ci-dessous reste celle du CLIENT.
              */}
            <Route path="contrat/retour-signature" element={<ContractReturnPage />} />
            <Route path="contrat/retour-paiement" element={<ContractReturnPage />} />
            <Route path="contrat/retour-abonnement" element={<ContractReturnPage />} />
            <Route path="factures" element={<FacturesPage />} />
            <Route path="profil" element={<ProfilePage />} />
            <Route path="support/information" element={<SupportInfoPage />} />

            {/* DEV only */}
            <Route
              path="dev/evenements"
              element={
                <RequireDev>
                  <DevEventsPage />
                </RequireDev>
              }
            />
            <Route path="demandes-contact" element={<ContactSubmissionsPage />} />
            <Route path="demandes-contact/:submissionId" element={<ContactSubmissionsPage />} />
            <Route
              path="dev/templates-email"
              element={
                <RequireDev>
                  <DevEmailTemplatesPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/livraisons-email"
              element={
                <RequireDev>
                  <DevEmailDeliveriesPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/contrats"
              element={
                <RequireDev>
                  <DevContractsPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/entreprise"
              element={
                <RequireDev>
                  <DevCompanyPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/equipe"
              element={
                <RequireDev>
                  <DevTeamPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/comptes"
              element={
                <RequireDev>
                  <DevAccountsPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/theme-manager"
              element={
                <RequireDev>
                  <DevManagerThemePage />
                </RequireDev>
              }
            />
            <Route
              path="dev/roles"
              element={
                <RequireDev>
                  <DevRolesPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/configuration"
              element={
                <RequireDev>
                  <SystemConfigPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/panel"
              element={
                <RequireDev>
                  <DevPanelPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/deploiement"
              element={
                <RequireDev>
                  <DeploymentPage />
                </RequireDev>
              }
            />
            <Route
              path="dev/deploiements"
              element={
                <RequireDev>
                  <DeploymentsControlPage />
                </RequireDev>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </React.Suspense>
    </AnimatePresence>
  );
}
