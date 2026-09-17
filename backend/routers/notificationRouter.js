import { Router } from 'express';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getConfig,
  updateConfig,
  deleteCategory
} from '../controllers/notificationController.js';

const router = Router();

// Config (avant les routes paramétrées pour éviter les conflits)
router.get('/config', getConfig);
router.put('/config', updateConfig);
router.delete('/config/categories/:categoryId', deleteCategory);

// Lecture
router.get('/', listNotifications);

// Marquer toutes lues (avant /:notificationId pour priorité)
router.patch('/read-all', markAllAsRead);

// Actions sur une notification
router.patch('/:notificationId/read', markAsRead);
router.delete('/:notificationId', deleteNotification);

export default router;
