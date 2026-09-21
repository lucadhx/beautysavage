import { Router } from 'express';
import * as ctrl from '../controllers/billing.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { attachInvoiceSchema } from '../validators/billing.validator.js';
import { ROLES } from '../utils/constants.js';

// ADMIN — ses factures.
export const myInvoicesRouter = Router();
myInvoicesRouter.use(authenticate, authorize(ROLES.ADMIN));
myInvoicesRouter.get('/', ctrl.myInvoices);
/**
 * L10.5 — LES PRESTATIONS À RÉGLER, et le paiement de l'une d'elles.
 *
 * Sous `my-invoices` parce que c'est l'espace du CLIENT : la garde ADMIN au
 * dessus vaut pour les deux, et un compte DEV n'a rien à payer.
 *
 * ══ AUCUN MONTANT DANS LE CORPS ═════════════════════════════════════════════
 *
 * La route de paiement ne lit RIEN du corps de la requête. L'identité vient du
 * chemin, le montant du Panel. Un client qui poserait `{ amount: 600 }` verrait
 * son champ ignoré — non pas rejeté par une validation, mais jamais lu.
 */
myInvoicesRouter.get('/payment-requests', ctrl.myPaymentRequests);
myInvoicesRouter.post('/payment-requests/:paymentRequestId/pay', ctrl.payPaymentRequest);

/**
 * L10.6B-3 — LES INCIDENTS DE PAIEMENT D'ABONNEMENT.
 *
 * ══ EN LECTURE SEULE, ET IL N'Y A PAS DE VERBE À CÔTÉ ═══════════════════════
 *
 * Aucun `POST .../retry`, aucun `POST .../pay`, et ce n'est pas un oubli :
 * Stripe est l'unique ordonnanceur des tentatives de prélèvement sur une
 * facture d'abonnement. Une route qui appellerait `invoices/{id}/pay` entrerait
 * en course avec la tentative que Stripe a déjà programmée sur la même facture
 * — c'est-à-dire créerait le double débit.
 *
 * Le client qui veut régler tout de suite passe par la facture hébergée que
 * Stripe a émise (`hostedInvoiceUrl`), qui est SA page de paiement pour CETTE
 * facture. Rien à ouvrir, rien à réserver, aucun montant à transmettre.
 *
 * ══ ET AUCUNE PRESTATION ICI ════════════════════════════════════════════════
 *
 * Une prestation L10.5 peut être « à payer », mais elle n'ouvre jamais un
 * incident d'abonnement, ne déclenche aucune échéance de grâce et ne suspend
 * aucun site. Les deux surfaces restent distinctes pour que cette frontière
 * soit structurelle et non seulement respectée.
 */
myInvoicesRouter.get('/subscription-incidents', ctrl.mySubscriptionIncidents);

// DEV — vue globale + détail (le détail vérifie l'accès ADMIN dans le controller).
export const invoicesRouter = Router();
invoicesRouter.use(authenticate);
invoicesRouter.get('/', authorize(ROLES.DEV), ctrl.allInvoices);
// Rattachement manuel d'une facture Stripe existante (DEV). Ne crée rien chez
// Stripe : la facture est lue via l'API puis reflétée.
invoicesRouter.post('/attach', authorize(ROLES.DEV), validate(attachInvoiceSchema), ctrl.attachInvoice);
invoicesRouter.get('/:id', ctrl.getInvoice);
