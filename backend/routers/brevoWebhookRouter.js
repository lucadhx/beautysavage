// routers/brevoWebhookRouter.js
// Public Brevo webhook endpoint. Mounted at /api/webhooks/brevo (after express.json).
import { Router } from 'express';
import { handleBrevoWebhook } from '../controllers/brevoWebhookController.js';

const router = Router();

router.post('/', handleBrevoWebhook);

export default router;
