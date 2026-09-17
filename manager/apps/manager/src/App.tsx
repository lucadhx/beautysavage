import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole } from '@bs/auth';
import { LoadingState } from '@bs/ui';
import { DevLayout } from './layouts/DevLayout';
import { ManagerLayout } from './layouts/ManagerLayout';
import { ManagerModeGate } from './layouts/ManagerModeGate';
import { ManagerHome } from './pages/ManagerHome';
import { ComingSoon } from './pages/ComingSoon';
import { ManagerForgotPasswordPage } from './pages/ManagerForgotPasswordPage';
import { ManagerInvitationPage } from './pages/ManagerInvitationPage';
import { ManagerLoginPage } from './pages/ManagerLoginPage';
import { ManagerResetPasswordPage } from './pages/ManagerResetPasswordPage';
import { Placeholder } from './pages/Placeholder';

const l = <T, K extends keyof T>(loader: () => Promise<T>, key: K) =>
  lazy(() => loader().then((module) => ({ default: module[key] as unknown as ComponentType })));

const comm = () => import('./features/communication');
const theme = () => import('./features/themeStudio');
const mailTemplates = () => import('./features/mailTemplates');
const notificationTemplates = () => import('./features/notificationTemplates');
const customer360 = () => import('./features/customer360');
const giftCardTemplates = () => import('./features/giftCardTemplates');
const catalogue = () => import('./features/catalogue');
const results = () => import('./features/results');
const finance = () => import('./features/finance');
const devPanel = () => import('./features/devPanel');
const integratedApiMgmt = () => import('./features/integratedApi');

const AdminCommunicationLayout = l(comm, 'AdminCommunicationLayout');
const DevCommunicationLayout = l(comm, 'DevCommunicationLayout');
const CommunicationTriggersPage = l(comm, 'CommunicationTriggersPage');
const AdminCommunicationDashboard = l(comm, 'AdminCommunicationDashboard');
const CommercialeIdentityPage = l(comm, 'CommercialeIdentityPage');
const AdminMailsPage = l(comm, 'AdminMailsPage');
const DevCommunicationDashboard = l(comm, 'DevCommunicationDashboard');
const SupportIdentityPage = l(comm, 'SupportIdentityPage');
const DevMailDeliveriesPage = l(comm, 'DevMailDeliveriesPage');
const DevSendLogsPage = l(comm, 'DevSendLogsPage');

const ThemeStudioLayout = l(theme, 'ThemeStudioLayout');
const ThemeStudioDashboard = l(theme, 'ThemeStudioDashboard');
const VitrineThemeEditorPage = l(theme, 'VitrineThemeEditorPage');
const PanelThemeEditorPage = l(theme, 'PanelThemeEditorPage');

const SystemSettingsPage = l(() => import('./features/systemSettings'), 'SystemSettingsPage');
const SettingsPage = l(() => import('./features/settings'), 'SettingsPage');

const MailTemplateStudioLayout = l(mailTemplates, 'MailTemplateStudioLayout');
const MailTemplateStudioDashboard = l(mailTemplates, 'MailTemplateStudioDashboard');
const MailTemplateEditorPage = l(mailTemplates, 'MailTemplateEditorPage');
const TemplateVersionsPage = l(mailTemplates, 'TemplateVersionsPage');

const NotificationStudioLayout = l(notificationTemplates, 'NotificationStudioLayout');
const NotificationTemplateDashboard = l(notificationTemplates, 'NotificationTemplateDashboard');
const NotificationTemplateEditorPage = l(notificationTemplates, 'NotificationTemplateEditorPage');
const NotificationTemplateVersionsPage = l(notificationTemplates, 'NotificationTemplateVersionsPage');
const NotificationCategoriesPage = l(notificationTemplates, 'NotificationCategoriesPage');

const PlanningPage = l(() => import('./features/planning'), 'PlanningPage');
const ClientsListPage = l(customer360, 'ClientsListPage');
const Customer360Page = l(customer360, 'Customer360Page');

const GiftCardTemplateStudioLayout = l(giftCardTemplates, 'GiftCardTemplateStudioLayout');
const GiftCardTemplateStudioDashboard = l(giftCardTemplates, 'GiftCardTemplateStudioDashboard');
const GiftCardTemplateEditorPage = l(giftCardTemplates, 'GiftCardTemplateEditorPage');
const GiftCardTemplateVersionsPage = l(giftCardTemplates, 'GiftCardTemplateVersionsPage');

const GiftCardLibraryPage = l(() => import('./features/giftCardLibrary'), 'GiftCardLibraryPage');

const CatalogueLayout = l(catalogue, 'CatalogueLayout');
const CatalogueDashboard = l(catalogue, 'CatalogueDashboard');
const ServicesListPage = l(catalogue, 'ServicesListPage');
const ServiceEditorPage = l(catalogue, 'ServiceEditorPage');
const TrainingsListPage = l(catalogue, 'TrainingsListPage');
const TrainingEditorPage = l(catalogue, 'TrainingEditorPage');
const GiftCardCataloguePage = l(catalogue, 'GiftCardCataloguePage');
const ProductsUnavailablePage = l(catalogue, 'ProductsUnavailablePage');
const ResultsListPage = l(results, 'ResultsListPage');
const ResultDetailPage = l(results, 'ResultDetailPage');

const SessionPresencePage = l(() => import('./features/learning'), 'SessionPresencePage');
const ReviewModerationPage = l(() => import('./features/reviews'), 'ReviewModerationPage');
const GeneralFaqPage = l(() => import('./features/faq'), 'GeneralFaqPage');

const FinanceDashboardPage = l(finance, 'FinanceDashboardPage');
const FinanceTimelinePage = l(finance, 'FinanceTimelinePage');
const CommissionOverviewPage = l(finance, 'CommissionOverviewPage');
const CommissionDetailPage = l(finance, 'CommissionDetailPage');
const FinanceGiftCardsPage = l(finance, 'FinanceGiftCardsPage');
const GiftCardFinanceDetailPage = l(finance, 'GiftCardFinanceDetailPage');

const DevDashboardPage = l(devPanel, 'DevDashboardPage');
const DevContractsPage = l(devPanel, 'DevContractsPage');
const IntegratedApiManagementPage = l(integratedApiMgmt, 'IntegratedApiManagementPage');
const EventLogsPage = l(devPanel, 'EventLogsPage');
const WebhookFailuresPage = l(devPanel, 'WebhookFailuresPage');

const ManagerUsersPage = l(() => import('./features/managerUsers'), 'ManagerUsersPage');

export function App() {
  return (
    <Suspense fallback={<LoadingState label="Chargement…" />}>
      <Routes>
        <Route path="/login" element={<ManagerLoginPage />} />
        <Route path="/invitation/:token" element={<ManagerInvitationPage />} />
        <Route path="/mot-de-passe-oublie" element={<ManagerForgotPasswordPage />} />
        <Route path="/reinitialiser-mot-de-passe/:token" element={<ManagerResetPasswordPage />} />

        <Route element={<RequireRole allow={['admin', 'dev']} loginPath="/login" />}>
          <Route element={<ManagerModeGate />}>
            <Route element={<ManagerLayout />}>
              <Route index element={<ManagerHome />} />
              <Route
                path="onboarding/contrat"
                element={
                  <ComingSoon
                    title="Onboarding — Contrat"
                    description="L’activation du contrat se fait via l’assistant d’onboarding."
                    links={[{ to: '/finance', label: 'Finance' }]}
                  />
                }
              />

              <Route path="planning" element={<PlanningPage />} />
              <Route path="planning/:date" element={<PlanningPage />} />

              <Route path="clients" element={<ClientsListPage />} />
              <Route path="clients/:id" element={<Customer360Page />} />

              <Route path="reservations" element={<Navigate to="/planning" replace />} />
              <Route path="ventes" element={<Navigate to="/finance/timeline?type=sale" replace />} />
              <Route path="remboursements" element={<Navigate to="/finance/timeline?type=refund" replace />} />
              <Route path="commissions" element={<Navigate to="/finance/commissions" replace />} />
              <Route path="parametres" element={<SettingsPage />} />
              <Route path="parametres/theme" element={<VitrineThemeEditorPage />} />

              <Route path="catalogue" element={<CatalogueLayout />}>
                <Route index element={<CatalogueDashboard />} />
                <Route path="prestations" element={<ServicesListPage />} />
                <Route path="prestations/new" element={<ServiceEditorPage />} />
                <Route path="prestations/:id" element={<ServiceEditorPage />} />
                <Route path="formations" element={<TrainingsListPage />} />
                <Route path="formations/new" element={<TrainingEditorPage />} />
                <Route path="formations/:id" element={<TrainingEditorPage />} />
                <Route path="formations/:id/sessions/:sessionId/presence" element={<SessionPresencePage />} />
                <Route path="cartes-cadeaux" element={<GiftCardCataloguePage />} />
                <Route path="produits" element={<ProductsUnavailablePage />} />
              </Route>

              <Route path="cartes-cadeaux/templates" element={<GiftCardLibraryPage />} />
              <Route path="avis" element={<ReviewModerationPage />} />
              <Route path="faq" element={<GeneralFaqPage />} />
              <Route path="resultats" element={<ResultsListPage />} />
              <Route path="resultats/:attemptId" element={<ResultDetailPage />} />

              <Route element={<RequireRole allow={['dev']} loginPath="/login" deniedPath="/" />}>
                <Route path="users" element={<ManagerUsersPage />} />
              </Route>

              <Route path="finance" element={<FinanceDashboardPage />} />
              <Route path="finance/timeline" element={<FinanceTimelinePage />} />
              <Route path="finance/commissions" element={<CommissionOverviewPage />} />
              <Route path="finance/commissions/:year/:month" element={<CommissionDetailPage />} />
              <Route path="finance/cartes-cadeaux" element={<FinanceGiftCardsPage />} />
              <Route path="finance/cartes-cadeaux/:giftCardId" element={<GiftCardFinanceDetailPage />} />

              <Route path="communication" element={<AdminCommunicationLayout />}>
                <Route index element={<AdminCommunicationDashboard />} />
                <Route path="identite-commerciale" element={<CommercialeIdentityPage />} />
                <Route path="mails" element={<AdminMailsPage />} />
              </Route>

              <Route path="dev" element={<RequireRole allow={['dev']} loginPath="/login" deniedPath="/" />}>
                <Route element={<DevLayout />}>
                  <Route index element={<DevDashboardPage />} />
                  <Route path="contrats" element={<DevContractsPage />} />
                  <Route path="commissions" element={<Navigate to="/finance/commissions" replace />} />
                  <Route path="integrated-api" element={<IntegratedApiManagementPage />} />
                  <Route path="system" element={<SystemSettingsPage />} />

                  <Route path="email-templates" element={<MailTemplateStudioLayout />}>
                    <Route index element={<MailTemplateStudioDashboard />} />
                    <Route path=":templateKey" element={<MailTemplateEditorPage />} />
                    <Route path=":templateKey/versions" element={<TemplateVersionsPage />} />
                  </Route>

                  <Route path="gift-card-templates" element={<GiftCardTemplateStudioLayout />}>
                    <Route index element={<GiftCardTemplateStudioDashboard />} />
                    <Route path=":slug" element={<GiftCardTemplateEditorPage />} />
                    <Route path=":slug/versions" element={<GiftCardTemplateVersionsPage />} />
                  </Route>

                  <Route path="notification-templates" element={<NotificationStudioLayout />}>
                    <Route index element={<NotificationTemplateDashboard />} />
                    <Route path=":templateKey" element={<NotificationTemplateEditorPage />} />
                    <Route path=":templateKey/versions" element={<NotificationTemplateVersionsPage />} />
                  </Route>

                  <Route path="notification-categories" element={<NotificationStudioLayout />}>
                    <Route index element={<NotificationCategoriesPage />} />
                  </Route>

                  <Route path="send-logs" element={<Navigate to="/dev/communication/send-logs" replace />} />
                  <Route path="event-logs" element={<EventLogsPage />} />
                  <Route path="webhook-failures" element={<WebhookFailuresPage />} />

                  <Route path="communication" element={<DevCommunicationLayout />}>
                    <Route index element={<DevCommunicationDashboard />} />
                    <Route path="identite-support" element={<SupportIdentityPage />} />
                    <Route path="mail-deliveries" element={<DevMailDeliveriesPage />} />
                    <Route path="send-logs" element={<DevSendLogsPage />} />
                    <Route path="triggers" element={<CommunicationTriggersPage />} />
                  </Route>

                  <Route path="theme-studio" element={<ThemeStudioLayout />}>
                    <Route index element={<ThemeStudioDashboard />} />
                    <Route path="vitrine" element={<VitrineThemeEditorPage />} />
                    <Route path="panel" element={<PanelThemeEditorPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Placeholder title="Page introuvable" description="404." />} />
      </Routes>
    </Suspense>
  );
}
