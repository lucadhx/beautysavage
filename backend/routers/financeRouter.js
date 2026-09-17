// routers/financeRouter.js
// RX2 — Espace Finance (admin/dev). Monté AVANT les broad-mounts dev-only sur '/api/gestion'
// (commissionRouter requireStrictDev) dans app.js, sinon shadow 403 pour les admins (cf. M3A/M11B/M12).
import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireAdminOrDev } from '../middlewares/requireDev.js';
import {
  getFinanceDashboard, getFinanceTimeline, getFinanceMovementDetail,
  getCommissionOverview, getCommissionHistory, getCommissionDetail,
  getGiftCardsFinance, getGiftCardFinanceDetailHandler,
} from '../controllers/financeController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireAdminOrDev);

router.get('/dashboard', getFinanceDashboard);
// RX2.2 — Financial Timeline (mouvements + résumé filtrable).
router.get('/timeline', getFinanceTimeline);
// RX2.3 — Détail d'un mouvement (breakdown paiement + profit net estimé).
router.get('/movement-detail', getFinanceMovementDetail);
// RX2.5 — Commissions premium (lecture). Le paiement reste sur /api/commissions/payments/:id/* (U3 hosted).
router.get('/commissions/current', getCommissionOverview);
router.get('/commissions/history', getCommissionHistory);
router.get('/commissions/:year/:month', getCommissionDetail);
// RX2.6 — Gift Card Finance (cycle de vie financier des cartes cadeaux).
router.get('/gift-cards', getGiftCardsFinance);
router.get('/gift-cards/:giftCardId', getGiftCardFinanceDetailHandler);

export default router;
