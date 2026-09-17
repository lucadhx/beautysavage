// routers/mailSupervisionDevRouter.js
// M3E — Supervision mail, vue DEV (tout, safe). Monté sous /api/gestion/dev (déjà admin/dev),
// verrouillé STRICT dev. Lecture seule.
// NB : la LISTE des send-logs dev existe déjà (devDiagnosticRouter GET /send-logs) ; ici on
// n'ajoute que les stats send-logs + les mail-deliveries (pas de redéfinition de /send-logs).
import { Router } from 'express';
import { requireStrictDev } from '../middlewares/requireDev.js';
import { devMailSupervision } from '../controllers/mailSupervisionController.js';

const router = Router();
router.use(requireStrictDev);

// Mail event deliveries (ledger M2).
router.get('/mail-deliveries', devMailSupervision.listDeliveries);
router.get('/mail-deliveries/stats', devMailSupervision.deliveryStats);
router.get('/mail-deliveries/:id', devMailSupervision.getDeliveryDetail);

// Send-logs : stats (la liste reste servie par devDiagnosticController).
router.get('/send-logs/stats', devMailSupervision.sendLogStats);

export default router;
