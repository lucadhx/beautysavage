// M4 — Communication Center (feature manager). Layouts, pages et composants.
export { AdminCommunicationLayout, DevCommunicationLayout, CommunicationCenterLayout } from './CommunicationCenterLayout';
export {
  AdminCommunicationDashboard,
  CommercialeIdentityPage,
  AdminMailsPage,
  DevCommunicationDashboard,
  SupportIdentityPage,
  DevMailDeliveriesPage,
  DevSendLogsPage,
} from './pages';
export { IdentityManager } from './IdentityManager';
export { IdentityForm } from './IdentityForm';
export { VerificationPanel } from './VerificationPanel';
export { MailDeliveriesView, SendLogsView } from './views';
export { CommunicationTriggersPage } from './CommunicationTriggersPage';
export { MailFilterBar, MobileFilterDrawer } from './MailFilters';
export {
  StatusBadge,
  RoleBadge,
  IdentityStatusCard,
  DnsStatusPanel,
  MailStatsCards,
  SendLogStatsCards,
  MailDeliveryList,
  SendLogList,
  CommunicationTabs,
} from './components';
