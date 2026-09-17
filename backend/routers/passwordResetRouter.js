import express from 'express';
import rateLimit from 'express-rate-limit';

import {
  requestResetToken,
  validateResetToken,
  completeResetPassword
} from '../controllers/passwordResetController.js';

const router = express.Router();

function buildPasswordResetRateLimiter({ windowMs, max, code, error }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(_req, res) {
      return res.status(429).json({
        ok: false,
        code,
        error
      });
    }
  });
}

const PASSWORD_RESET_REQUEST_RATE_LIMIT = buildPasswordResetRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  code: 'PASSWORD_RESET_REQUEST_RATE_LIMIT',
  error: 'Trop de demandes de reinitialisation. Reessayez plus tard.'
});
const PASSWORD_RESET_VALIDATE_RATE_LIMIT = buildPasswordResetRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  code: 'PASSWORD_RESET_VALIDATE_RATE_LIMIT',
  error: 'Trop de tentatives de validation. Reessayez plus tard.'
});
const PASSWORD_RESET_COMPLETE_RATE_LIMIT = buildPasswordResetRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  code: 'PASSWORD_RESET_COMPLETE_RATE_LIMIT',
  error: 'Trop de tentatives de reinitialisation. Reessayez plus tard.'
});

router.post('/request', PASSWORD_RESET_REQUEST_RATE_LIMIT, requestResetToken);
router.post('/validate', PASSWORD_RESET_VALIDATE_RATE_LIMIT, validateResetToken);
router.post('/complete', PASSWORD_RESET_COMPLETE_RATE_LIMIT, completeResetPassword);

export default router;
