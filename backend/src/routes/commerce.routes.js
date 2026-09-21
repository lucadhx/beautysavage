import { Readable } from 'node:stream';
import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { authenticateCustomer } from '../middlewares/customerAuth.middleware.js';
import { uploadTrainingDeliverable, translateUploadErrors } from '../middlewares/upload.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { ROLES } from '../utils/constants.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import * as commerce from '../services/commerce.service.js';
import * as calendar from '../services/calendar.service.js';

export const publicCommerceRoutes = Router();
publicCommerceRoutes.get('/catalog', asyncHandler(async (_req, res) => ok(res, await commerce.listCatalog())));
publicCommerceRoutes.get('/availability', asyncHandler(async (req, res) => ok(res, await calendar.listAvailability(req.query))));
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
publicCommerceRoutes.get('/products/:slug', asyncHandler(async (req, res) => ok(res, await commerce.getProductBySlug(req.params.slug))));
publicCommerceRoutes.get('/reviews', asyncHandler(async (req, res) => ok(res, await commerce.listPublishedReviews(req.query))));

export const customerRoutes = Router();
const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Trop de tentatives de connexion client. Reessayez dans quelques minutes.',
});
customerRoutes.post('/register', asyncHandler(async (req, res) => created(res, await commerce.registerCustomer(req.body))));
customerRoutes.post('/login', customerLoginLimiter, asyncHandler(async (req, res) => ok(res, await commerce.loginCustomer(req.body.email, req.body.password))));
customerRoutes.post('/email-verification/confirm', customerLoginLimiter, asyncHandler(async (req, res) => ok(res, await commerce.verifyCustomerEmail(req.body.code || req.body.token))));
customerRoutes.post('/email-verification/request', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.requestCustomerEmailVerification(req.customer._id))));
customerRoutes.post('/password-reset/request', customerLoginLimiter, asyncHandler(async (req, res) => ok(res, await commerce.requestCustomerPasswordReset(req.body.email))));
customerRoutes.post('/password-reset/confirm', customerLoginLimiter, asyncHandler(async (req, res) => ok(res, await commerce.resetCustomerPassword(req.body))));
customerRoutes.get('/me', authenticateCustomer, asyncHandler(async (req, res) => ok(res, req.customer)));
customerRoutes.get('/cart', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.getCustomerCart(req.customer._id))));
customerRoutes.post('/cart/items', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.addCartItem(req.customer._id, req.body))));
customerRoutes.delete('/cart/items/:lineId', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.removeCartItem(req.customer._id, req.params.lineId))));
customerRoutes.post('/checkout', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createCheckout(req.customer._id, req.body))));
customerRoutes.get('/orders', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerOrders(req.customer._id))));
customerRoutes.get('/invoices', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerOrders(req.customer._id))));
customerRoutes.get('/gift-cards', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerGiftCards(req.customer._id))));
customerRoutes.get('/refund-requests', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerRefundRequests(req.customer._id))));
customerRoutes.post('/refund-requests', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createRefundRequest(req.customer._id, req.body))));
customerRoutes.get('/training-submissions', authenticateCustomer, asyncHandler(async (req, res) => ok(res, await commerce.listCustomerTrainingSubmissions(req.customer._id))));
customerRoutes.post('/training-deliverables', authenticateCustomer, uploadTrainingDeliverable.single('file'), translateUploadErrors, asyncHandler(async (req, res) => created(res, await commerce.uploadCustomerTrainingDeliverable(req.customer._id, req.file))));
customerRoutes.post('/training-submissions', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createTrainingSubmission(req.customer._id, req.body))));
customerRoutes.post('/reviews', authenticateCustomer, asyncHandler(async (req, res) => created(res, await commerce.createReview(req.customer._id, req.body))));
customerRoutes.get('/formations', authenticateCustomer, asyncHandler(async (req, res) => {
  ok(res, await commerce.listCustomerFormations(req.customer._id));
}));

export const managerCommerceRoutes = Router();
managerCommerceRoutes.use(authenticate);
managerCommerceRoutes.get('/products', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerProducts())));
managerCommerceRoutes.post('/products', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await commerce.upsertProduct(req.body))));
managerCommerceRoutes.put('/products/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.upsertProduct({ ...req.body, id: req.params.id }))));
managerCommerceRoutes.delete('/products/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.deleteProduct(req.params.id))));
managerCommerceRoutes.post('/videos/resolve-streamable', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.resolveStreamableVideo(req.body))));
managerCommerceRoutes.post('/videos/resolve-drive', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.resolveGoogleDriveVideo(req.body))));
managerCommerceRoutes.post('/training-files', authorize(ROLES.ADMIN, ROLES.DEV), uploadTrainingDeliverable.single('file'), translateUploadErrors, asyncHandler(async (req, res) => created(res, await commerce.uploadTrainingResourceFile(req.file))));
managerCommerceRoutes.get('/sales', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerSales())));
managerCommerceRoutes.post('/sales/:id/refund', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.refundSale(req.params.id, req.body, req.user?._id || null))));
managerCommerceRoutes.get('/customers', asyncHandler(async (_req, res) => ok(res, await commerce.listManagerCustomers())));
managerCommerceRoutes.get('/commissions', asyncHandler(async (_req, res) => ok(res, await commerce.listCommissions())));
managerCommerceRoutes.post('/commissions/recalculate', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (_req, res) => ok(res, await commerce.recalculateMonthlyCommissions())));
managerCommerceRoutes.post('/commissions/:id/pay', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await commerce.markCommissionPaid(req.params.id, req.body))));
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

export default managerCommerceRoutes;
