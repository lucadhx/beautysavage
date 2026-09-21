import { Router } from 'express';
import { ok } from '../utils/apiResponse.js';
import { config } from '../config/env.js';
import {
  MEDIA_CATALOG,
  ROLES,
  MAX_GALLERY_IMAGES,
} from '../utils/constants.js';

// Static reference data shared with the frontends.
const router = Router();

router.get('/', (req, res) =>
  ok(res, {
    mediaCatalog: MEDIA_CATALOG,
    roles: ROLES,
    maxGalleryImages: MAX_GALLERY_IMAGES,
    // ENV APPLICATIF COURANT (TEST/PROD). Sert à n'afficher les outils de
    // recette qu'en TEST. À ne PAS confondre avec `Contract.environment`, figé
    // à la création : une base PROD promue depuis TEST porte des contrats
    // `environment: 'TEST'` — s'y fier afficherait des outils de recette en
    // production. Le refus reste de toute façon imposé côté service.
    environment: config.env,
  })
);

export default router;
