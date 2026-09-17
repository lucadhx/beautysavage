import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  getSalesStats,
  listSales,
  listCartSnapshots,
  downloadSaleInvoiceForGestion,
  listRefunds,
  updateRefundStatus,
  getServiceBookingForSale
} from '../controllers/salesController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/sales/stats', getSalesStats);
router.get('/sales', listSales);
router.get('/sales/:saleId/invoice', downloadSaleInvoiceForGestion);
router.get('/sales/:saleId/service-booking', getServiceBookingForSale);
router.get('/carts', listCartSnapshots);
router.get('/refunds', listRefunds);
// B1 (RX2) — Décision admin sur un remboursement (valider/refuser/annuler). Le handler existait
// mais n'était monté nulle part : aucun admin ne pouvait actionner un remboursement via l'API.
router.post('/refunds/:refundId/status', updateRefundStatus);

export default router;
