import express from 'express';

import {
  downloadInvoiceByToken,
  getInvoiceStatusByToken,
  redirectInvoiceDownload
} from '../controllers/invoiceController.js';

const router = express.Router();

router.get('/api/invoice/:token', getInvoiceStatusByToken);
router.get('/api/invoice/download/:token', downloadInvoiceByToken);
router.get('/invoice/:invoiceId', redirectInvoiceDownload);

export default router;
