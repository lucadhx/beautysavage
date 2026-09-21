import { Router } from 'express';
import { getVersion } from '../controllers/version.controller.js';

const router = Router();
// Public + non sensible : commit / branche / date du build déployé.
router.get('/', getVersion);
export default router;
