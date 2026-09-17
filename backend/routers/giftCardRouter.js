import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireSiteActiveForPurchases } from '../middlewares/siteStatusGuards.js';
import {
  purchaseGiftCard,
  listMyGiftCards,
  getGiftCardDetail,
  validateGiftCard,
  validateGiftCardCredentials,
  redeemGiftCard
} from '../controllers/giftCardController.js';

const router = express.Router();

router.post('/', requireAuth(), requireSiteActiveForPurchases(), purchaseGiftCard);
router.get('/my', requireAuth(), listMyGiftCards);
router.get('/:id', requireAuth(), getGiftCardDetail);
router.post('/validate', requireAuth(), validateGiftCard);
router.post('/validate-credentials', requireAuth(), validateGiftCardCredentials);
router.post('/redeem', requireAuth(), requireSiteActiveForPurchases(), redeemGiftCard);

export default router;
