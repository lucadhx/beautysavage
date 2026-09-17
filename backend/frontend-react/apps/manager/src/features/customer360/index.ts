// M12 — Customer 360 (Client Hub). Point d'entrée de la feature.
export { Customer360Page } from './Customer360Page';
export { ClientsListPage } from './ClientsListPage';
export { useCustomer360, useCustomerSearch } from './useCustomer360';
export {
  CustomerHeader, CustomerHeroCard, CustomerSummaryCards, CustomerFinancialCard, CustomerTimeline,
  TimelineCard, BookingSection, SaleSection, FormationSection, ProductSection, GiftCardSection,
  RefundSection, DocumentsSection, CommunicationsSection, NotificationSection, QuickActions,
  CustomerDrawer, MobileBottomActions, CustomerSkeleton, CustomerEmptyState, CustomerTabs,
  Accordion, ClientSearchCard, StatusBadge, money, fmtDate, fmtDateTime, initials,
} from './components';
export {
  CreateGiftCardDrawer, ManualGiftCardDebitDrawer, ManualBookingDrawer, CustomerNoteDrawer,
} from './m13Drawers';
