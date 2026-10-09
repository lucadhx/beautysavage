import { Readable } from 'node:stream';
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { authenticateCustomer, identifyCustomer } from '../middlewares/customerAuth.middleware.js';
import { uploadTrainingDeliverable, translateUploadErrors } from '../middlewares/upload.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { ROLES } from '../utils/constants.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { authRateLimit } from '../middlewares/authRateLimit.js';
import { requireSiteOpenForPurchase } from '../middlewares/purchaseGate.middleware.js';
import * as commissionPayment from '../services/commissionPayment.service.js';
import { siteUrlFor } from '../utils/siteOrigin.js';
import * as customerAgenda from '../services/customerAgenda.service.js';
import * as commerce from '../services/commerce.service.js';
import * as calendar from '../services/calendar.service.js';
import * as sessions from '../services/formationSessions.service.js';

import * as collections from '../services/serviceCollection.service.js';
export const publicCommerceRoutes = Router();
publicCommerceRoutes.get('/catalog', asyncHandler(async (_req, res) => ok(res, await commerce.listCatalog())));
// Collections de prestations (rayons de la page « Prestations »), dans l'ordre choisi.
publicCommerceRoutes.get('/collections', asyncHandler(async (_req, res) => ok(res, await collections.listPublicCollections())));
publicCommerceRoutes.get('/availability', requireSiteOpenForPurchase, identifyCustomer, asyncHandler(async (req, res) => ok(res, await calendar.listAvailability(req.query, { customerId: req.customer?._id }))));
publicCommerceRoutes.get('/videos/streamable/:shortcode/playback-url', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  ok(res, await commerce.getStreamableTemporaryPlayback(req.params.shortcode));
}));
publicCommerceRoutes.get('/videos/google-drive/:fileId/playback-url', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  ok(res, await commerce.getGoogleDriveTemporaryPlayback(req.params.fileId));
}));
publicCommerceRoutes.get('/videos/google-drive/:fileId/stream', asyncHandler(async (req, res, next) => {
  const { upstream, contentType } = await commerce.getGoogleDriveVideoUpstream(req.params.fileId, req.headers.range || '');
  const headers = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
  for (const header of headers) {
    const value = upstream.headers.get(header);
    if (value) res.set(header, value);
  }
  if (contentType) res.type(contentType);
  res.set('Cache-Control', 'private, max-age=300');
  res.set('Content-Disposition', 'inline');
  res.status(upstream.status === 206 ? 206 : 200);
  if (!upstream.body) return res.end();
  return Readable.fromWeb(upstream.body).on('error', next).pipe(res);
}));
publicCommerceRoutes.get('/products/:slug', identifyCustomer, asyncHandler(async (req, res) => ok(res, await commerce.getProductBySlug(req.params.slug, { customerId: req.customer?._id }))));
publicCommerceRoutes.get('/reviews', asyncHandler(async (req, res) => ok(res, await commerce.listPublishedReviews(req.query))));

export const customerRoutes = Router();
/**
 * MÊME PROTECTION QUE LE MANAGER (`authRateLimit`) : compteurs persistés en
 * base, par IP ET par identité, actifs sur TEST comme sur PROD. L'ancien
 * `rateLimit` était en mémoire, par IP seule, et désactivé hors PROD.
 */
const customerLoginLimiter = authRateLimit({ scope: 'customer-login' });
const customerRegisterLimiter = authRateLimit({ scope: 'customer-register' });
const customerOtpLimiter = authRateLimit({ scope: 'customer-otp', identityFrom: () => null });
const customerResetRequestLimiter = authRateLimit({ scope: 'customer-reset-request' });
const customerResetConfirmLimiter = authRateLimit({ scope: 'customer-reset-confirm', identityFrom: () => null });
customerRoutes.post('/register', customerRegisterLimiter, asyncHandler(async (req, res) => created(res, await commerce.registerCustomer(req.body))));
customerRoutes.post('/login', customerLoginLimiter, asyncHandler(async (req, res) => ok(res, await commerce.loginCustomer(req.body.email, req.body.password))));
customerRoutes.post('/email-verification/confirm', customerOtpLimiter, asyncHandler(async (req, res) => ok(res, await commerce.verifyCustomerEmail(req.body.code || req.body.token))));
customerRoutes.post('/email-verification/request', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.requestCustomerEmailVerification(req.customer._id))));
customerRoutes.post('/password-reset/request', customerResetRequestLimiter, asyncHandler(async (req, res) => ok(res, await commerce.requestCustomerPasswordReset(req.body.email, { siteUrl: await siteUrlFor(req) }))));
customerRoutes.post('/password-reset/confirm', customerResetConfirmLimiter, asyncHandler(async (req, res) => ok(res, await commerce.resetCustomerPassword(req.body))));
customerRoutes.get('/me', authenticateCustomer, asyncHandler(async (req, res) => ok(res, req.customer)));
customerRoutes.get('/cart', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.getCustomerCart(req.customer._id))));
customerRoutes.post('/cart/items', authenticateCustomer, requireSiteOpenForPurchase, asyncHandler(async (req, res) => ok(res, await commerce.addCartItem(req.customer._id, req.body))));
customerRoutes.put('/cart/items/:lineId/booking', authenticateCustomer, requireSiteOpenForPurchase, asyncHandler(async (req, res) => ok(res, await commerce.setCartItemBooking(req.customer._id, req.params.lineId, req.body))));
customerRoutes.delete('/cart/items/:lineId', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.removeCartItem(req.customer._id, req.params.lineId))));
// Le retour après paiement se fait sur le site d'où vient la cliente (origine autorisée), jamais sur une adresse devinée.
customerRoutes.post('/checkout', authenticateCustomer, requireSiteOpenForPurchase, asyncHandler(async (req, res) => created(res, await commerce.createCheckout(req.customer._id, { ...req.body, siteUrl: await siteUrlFor(req) }))));
// Retour « annuler » depuis Stripe : rend tout de suite le créneau retenu.
customerRoutes.post('/checkout/abandon', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.abandonCheckout(req.customer._id, req.body?.saleNumber))));
customerRoutes.post('/checkout/quick',authenticateCustomer, requireSiteOpenForPurchase, asyncHandler(async (req, res) => created(res, await commerce.createQuickCheckout(req.customer._id, { ...req.body, siteUrl: await siteUrlFor(req) }))));
// La page de succès vérifie que le paiement est bien enregistré (et le finalise si le webhook tarde).
customerRoutes.get('/checkout/status', authenticateCustomer, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  ok(res, await commerce.getCustomerCheckoutStatus(req.customer._id, req.query.session_id, req.query.commande));
}));
customerRoutes.get('/orders', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerOrders(req.customer._id))));
customerRoutes.get('/invoices', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerOrders(req.customer._id))));
customerRoutes.get('/gift-cards', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerGiftCards(req.customer._id))));
// Vérifier / ajouter un code : limité, un code ne se devine pas à coups d'essais.
const giftCodeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Trop d’essais de code. Réessayez dans quelques minutes.' });
customerRoutes.post('/gift-cards/check', authenticateCustomer, giftCodeLimiter, asyncHandler(async (req, res) => ok(res, await commerce.checkCustomerGiftCard(req.customer._id, req.body))));
customerRoutes.post('/gift-cards/wallet', authenticateCustomer, giftCodeLimiter, asyncHandler(async (req, res) => ok(res, await commerce.addGiftCardToWallet(req.customer._id, req.body))));
customerRoutes.get('/refund-requests', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerRefundRequests(req.customer._id))));
customerRoutes.post('/refund-requests', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createRefundRequest(req.customer._id, req.body))));
customerRoutes.get('/training-submissions', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerTrainingSubmissions(req.customer._id))));
customerRoutes.post('/training-deliverables', authenticateCustomer, uploadTrainingDeliverable.single('file'), translateUploadErrors, asyncHandler(async (req, res) => created(res, await commerce.uploadCustomerTrainingDeliverable(req.customer._id, req.file))));
customerRoutes.delete('/training-deliverables', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.deleteCustomerTrainingDeliverable(req.customer._id, req.body?.url || req.query.url))));
customerRoutes.post('/training-submissions', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createTrainingSubmission(req.customer._id, req.body))));
customerRoutes.post('/reviews', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createReview(req.customer._id, req.body))));
// L'agenda de la cliente : prochains rendez-vous / sessions, solde sur place, conditions d'annulation.
customerRoutes.get('/appointments', authenticateCustomer, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  ok(res, await customerAgenda.listCustomerAppointments(req.customer._id));
}));
customerRoutes.post('/appointments/:id/cancel', authenticateCustomer, rateLimit({ windowMs: 60_000, max: 6 }), asyncHandler(async (req, res) => ok(res, await customerAgenda.cancelCustomerAppointment(req.customer._id, req.params.id))));
customerRoutes.get('/formations', authenticateCustomer, asyncHandler(async (req, res) => {
  ok(res, await commerce.listCustomerFormations(req.customer._id));
}));

export const managerCommerceRoutes = Router();
managerCommerceRoutes.use(authenticate);
managerCommerceRoutes.get('/products', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerProducts())));
managerCommerceRoutes.post('/products', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await commerce.upsertProduct(req.body))));
managerCommerceRoutes.put('/products/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.upsertProduct({ ...req.body, id: req.params.id }))));
managerCommerceRoutes.delete('/products/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.deleteProduct(req.params.id))));
// Collections de prestations : liste, fiche, création, modification, ordre, suppression.
managerCommerceRoutes.get('/collections', asyncHandler(async (_req, res) => ok(res, await collections.listCollections())));
managerCommerceRoutes.put('/collections/order', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await collections.reorderCollections(req.body.ids))));
managerCommerceRoutes.get('/collections/:id', asyncHandler(async (req, res) => ok(res, await collections.getCollection(req.params.id))));
managerCommerceRoutes.post('/collections', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await collections.saveCollection(req.body))));
managerCommerceRoutes.put('/collections/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await collections.saveCollection(req.body, req.params.id))));
managerCommerceRoutes.delete('/collections/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await collections.deleteCollection(req.params.id))));
managerCommerceRoutes.put('/home-featured/:group', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.setHomeFeatured(req.params.group, req.body.productIds))));
managerCommerceRoutes.post('/products/:id/sessions', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await sessions.createSession(req.params.id, req.body))));
managerCommerceRoutes.put('/products/:id/sessions/:sessionId', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await sessions.updateSession(req.params.id, req.params.sessionId, req.body))));
managerCommerceRoutes.post('/products/:id/sessions/:sessionId/cancel', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await sessions.cancelSession(req.params.id, req.params.sessionId, req.body, req.user?._id || null))));
managerCommerceRoutes.delete('/products/:id/sessions/:sessionId', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await sessions.deleteSession(req.params.id, req.params.sessionId))));
managerCommerceRoutes.post('/videos/resolve-streamable', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.resolveStreamableVideo(req.body))));
managerCommerceRoutes.post('/videos/resolve-drive', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.resolveGoogleDriveVideo(req.body))));
managerCommerceRoutes.post('/training-files', authorize(ROLES.ADMIN, ROLES.DEV), uploadTrainingDeliverable.single('file'), translateUploadErrors, asyncHandler(async (req, res) => created(res, await commerce.uploadTrainingResourceFile(req.file))));
managerCommerceRoutes.get('/sales', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerSales())));
managerCommerceRoutes.get('/sales/:id/payment', asyncHandler(async (req, res) => ok(res, await commerce.getSalePaymentDetails(req.params.id))));
managerCommerceRoutes.post('/sales/:id/refund', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.refundSale(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/customers', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerCustomers())));
managerCommerceRoutes.post('/customers/:id/access-link', asyncHandler(async (req, res) => ok(res, await commerce.resendCustomerAccessLink(req.params.id))));
managerCommerceRoutes.get('/commissions', asyncHandler(async (_req, res) => ok(res, await commerce.listCommissions())));
managerCommerceRoutes.post('/commissions/recalculate', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (_req, res) => ok(res, await commerce.recalculateMonthlyCommissions({ reprice: true }))));
managerCommerceRoutes.get('/commissions/summary', asyncHandler(async (_req, res) => ok(res, await commissionPayment.commissionSummary())));
// Payer une commission = une page de paiement Stripe ; personne ne la « marque payée » à la main.
managerCommerceRoutes.post('/commissions/:id/checkout', authorize(ROLES.ADMIN, ROLES.DEV), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(async (req, res) => ok(res, await commissionPayment.openCommissionCheckout(req.params.id))));
managerCommerceRoutes.post('/commissions/:id/sync', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  ok(res, await commissionPayment.syncCommissionPayment(req.params.id));
}));
managerCommerceRoutes.get('/reviews', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerReviews())));
managerCommerceRoutes.post('/reviews/manual', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await commerce.createManualReview(req.body, req.user?._id || null))));
managerCommerceRoutes.post('/reviews/:id/moderate', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.moderateReview(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/refund-requests', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerRefundRequests())));
managerCommerceRoutes.post('/refund-requests/:id/decision', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.decideRefundRequest(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/gift-cards', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerGiftCards())));
managerCommerceRoutes.post('/gift-cards', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await commerce.issueGiftCard(req.body, { userId: req.user?._id || null, source: 'MANAGER', revealCode: true }))));
managerCommerceRoutes.post('/gift-cards/:id/adjust', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.adjustGiftCard(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/training-submissions', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerTrainingSubmissions())));
managerCommerceRoutes.post('/training-submissions/:id/decision', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.decideTrainingSubmission(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/integrations', authorize(ROLES.DEV), asyncHandler(async (_req, res) => ok(res, await commerce.getInstituteIntegrations())));
managerCommerceRoutes.put('/integrations', authorize(ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.saveInstituteIntegration(req.body))));
managerCommerceRoutes.post('/integrations/test', authorize(ROLES.DEV), rateLimit({ windowMs: 60_000, max: 12 }), asyncHandler(async (req, res) => ok(res, await commerce.testInstituteIntegration(req.body?.provider))));

export default managerCommerceRoutes;
