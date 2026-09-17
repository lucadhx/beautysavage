// routers/notificationDevRouter.js
// M3A — Espace Dev : notifications d'audience 'dev' UNIQUEMENT.
// Monté sur /api/gestion/dev/notifications (sous requireGestionRole global) puis
// verrouillé par requireStrictDev → admin/client refusés (403/401).
import { Router } from 'express';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listDevNotifications,
  markDevNotificationAsRead,
  markAllDevNotificationsAsRead,
  deleteDevNotification
} from '../controllers/notificationController.js';

const router = Router();

// Dev-only sur toutes les routes.
router.use(requireStrictDev);

// Lecture (audience dev).
router.get('/', listDevNotifications);

// Marquer toutes lues (avant /:notificationId).
router.patch('/read-all', markAllDevNotificationsAsRead);

// Actions sur une notification dev.
router.patch('/:notificationId/read', markDevNotificationAsRead);
router.delete('/:notificationId', deleteDevNotification);

export default router;
