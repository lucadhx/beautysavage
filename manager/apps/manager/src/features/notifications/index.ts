// M9 — Notification Center (panel Manager/Admin + Dev). Point d'entrée de la feature.
export { NotificationBell } from './NotificationBell';
export { NotificationDrawer, NotificationPulseBanner } from './NotificationDrawer';
export {
  NotificationMotionProvider,
  useNotificationMotion,
  NotificationBadge,
  NotificationCategoryChip,
  NotificationPriorityBadge,
  NotificationPersistentBadge,
  NotificationActionButton,
  NotificationEmptyState,
  NotificationDetailPanel,
  NotificationCard,
  NotificationList,
  NotificationFilterBar,
  type NotificationFilterValue,
} from './components';
export {
  useNotifications,
  shouldPulse,
  pulseBannerText,
  PULSE_VISIBLE_MS,
} from './useNotifications';
