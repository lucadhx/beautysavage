import express from 'express';

import { getMenu, getPage } from '../controllers/vitrineController.js';
import { getActiveTheme } from '../controllers/themeController.js';
import { getUIConfigPublic } from '../controllers/uiConfigController.js';
import { getSiteIdentityPublic } from '../controllers/siteIdentityController.js';
import {
  getHighlightedItems,
  getShopListing,
  getFormationDetail as getVitrineFormationDetail,
  getProductDetail,
  getFormationReviewStats,
  getFormationReviews
} from '../controllers/vitrineShopController.js';
import { getGiftCardConfig } from '../controllers/giftCardController.js';
import { getActiveSocialLinks } from '../controllers/socialController.js';
import { getHomeSettingsPublic } from '../controllers/homeSettingsController.js';

const router = express.Router();

router.get('/menu', getMenu);
router.get('/pages/:slug', getPage);
router.get('/theme', getActiveTheme);
router.get('/ui-config', getUIConfigPublic);
router.get('/site-identity', getSiteIdentityPublic);
router.get('/home-settings', getHomeSettingsPublic);
router.get('/highlights', getHighlightedItems);
router.get('/shop', getShopListing);
router.get('/formations/:id', getVitrineFormationDetail);
router.get('/formations/:id/reviews/stats', getFormationReviewStats);
router.get('/formations/:id/reviews', getFormationReviews);
router.get('/products/:id', getProductDetail);
router.get('/gift-cards', getGiftCardConfig);
router.get('/social-links', getActiveSocialLinks);

export default router;
