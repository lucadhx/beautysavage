/**
 * MON ENTREPRISE — l'identité juridique du client, EN LECTURE SEULE.
 *
 * ══ POURQUOI IL N'Y A QU'UN VERBE ═══════════════════════════════════════════
 *
 * `GET`. Pas de `PUT`, pas de `PATCH`, pas de route « corriger ». Ce n'est pas
 * une simplification à compléter plus tard : c'est le cœur du chantier.
 *
 * L'identité juridique d'un client — sa raison sociale, son SIREN, son adresse
 * de facturation, la personne qui l'engage — est ce qui figure sur SES FACTURES
 * et sur LES CONTRATS QU'IL SIGNE. Laisser le client la modifier depuis son
 * propre Manager reviendrait à lui laisser choisir sur quelle entité il est
 * facturé et qui le représente. L'autorité est le Panel, et l'absence de verbe
 * d'écriture est la seule façon de le rendre vrai plutôt que déclaratif.
 *
 * ══ UNE INFORMATION INCORRECTE ? ════════════════════════════════════════════
 *
 * L'écran affiche l'adresse de contact publique de L.Y Solution — celle que le
 * Panel publie déjà avec le reste de son identité (`contacts.publicContactEmail`).
 * Elle n'est jamais écrite en dur : c'est précisément le champ que le Panel a
 * centralisé pour que le parc entier n'ait qu'une adresse à changer.
 *
 * ══ QUI PEUT LIRE ═══════════════════════════════════════════════════════════
 *
 * Tout compte authentifié du Manager. Ce sont les informations de SA propre
 * entreprise : les réserver à un rôle reviendrait à cacher à un client ce qu'il
 * a lui-même fourni. Rien de sensible ne sort — pas de note interne, pas de
 * document, pas d'identifiant du Panel.
 */
import { Router } from 'express';

import { authenticate } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { myCompany } from '../controllers/clientCompany.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', asyncHandler(myCompany));

export default router;
