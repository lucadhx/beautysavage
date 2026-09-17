// routers/customer360Router.js
// M12 — Customer 360 (Client Hub). Admin/dev uniquement. Monté AVANT les broad-mounts dev-only
// (commissionRouter requireStrictDev) dans app.js, sinon shadow 403 pour les admins (cf. M3A/M11B).
import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireAdminOrDev } from '../middlewares/requireDev.js';
import {
  listCustomers,
  getCustomer360,
  listCustomerNotes,
  createCustomerNote
} from '../controllers/customer360Controller.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireAdminOrDev);

router.get('/', listCustomers);
router.get('/:customerId/360', getCustomer360);
// M13 — notes internes client.
router.get('/:customerId/notes', listCustomerNotes);
router.post('/:customerId/notes', createCustomerNote);

export default router;
