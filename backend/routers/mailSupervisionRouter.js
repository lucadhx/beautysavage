// routers/mailSupervisionRouter.js
// M3E — Supervision mail, vue ADMIN/MANAGER (institut/client uniquement). Monté sous
// /api/gestion (déjà protégé par requireGestionRole = admin/dev). roleView='admin' imposé :
// les livraisons/logs plateforme (commission, technique, compte) sont exclus. Lecture seule.
import { Router } from 'express';
import { adminMailSupervision } from '../controllers/mailSupervisionController.js';

const deliveriesRouter = Router();
deliveriesRouter.get('/', adminMailSupervision.listDeliveries);
deliveriesRouter.get('/stats', adminMailSupervision.deliveryStats);
deliveriesRouter.get('/:id', adminMailSupervision.getDeliveryDetail);

const sendLogsRouter = Router();
sendLogsRouter.get('/', adminMailSupervision.listSendLogs);
sendLogsRouter.get('/stats', adminMailSupervision.sendLogStats);

export { deliveriesRouter as mailDeliveriesAdminRouter, sendLogsRouter as sendLogsAdminRouter };
