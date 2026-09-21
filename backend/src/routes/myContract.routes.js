import { Router } from 'express';
import * as ctrl from '../controllers/contract.admin.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

/**
 * Parcours ADMIN (« mon contrat »). authorize(ADMIN) — le DEV reste superset.
 * L'ADMIN n'accède qu'à SON contrat (résolu côté controller), jamais par id.
 */
const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/', ctrl.getMyContract);
router.get('/activation', ctrl.getActivation);
router.get('/timeline', ctrl.timeline);
router.get('/launch-fee-status', ctrl.launchFeeStatus);
router.get('/subscription-status', ctrl.subscriptionStatus);
router.post('/start-signature', ctrl.startSignature);
router.post('/create-launch-checkout', ctrl.createLaunchCheckout);
router.post('/create-subscription-checkout', ctrl.createSubscriptionCheckout);
router.post('/subscription/reconcile', ctrl.reconcileSubscription);
router.get('/payment-method', ctrl.paymentMethod);
router.post('/billing-portal', ctrl.createBillingPortal);
router.post('/activate', ctrl.activate);
router.post('/cancel', ctrl.cancel);

export default router;
