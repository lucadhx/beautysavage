import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';
import { verifyStripeWebhookAnyMode } from '../services/stripe/stripe.service.js';
import { handleStripeWebhook } from '../services/contractWebhook.service.js';
import { finalizeInstituteStripeCheckout } from '../services/commerce.service.js';
import { verifyInstituteStripeWebhook } from '../services/instituteStripe.service.js';
import { emailDebug, redactHeaders } from '../utils/emailDebug.js';

/**
 * Endpoints webhook — PUBLICS au sens réseau mais protégés par vérification
 * CRYPTOGRAPHIQUE de signature. Le corps est reçu BRUT (express.raw) : la
 * vérification HMAC exige le payload non parsé. La vérité vient d'ici (ou de la
 * réconciliation), jamais d'une redirection navigateur.
 *
 * Sélection du secret par MODE fournisseur (jamais par ENV) : on vérifie avec le
 * secret du mode ACTIF, puis en repli avec l'autre mode (événement retardé après
 * un basculement) — dans ce cas l'événement est ACQUITTÉ (2xx) mais NON traité
 * pour éviter toute pollution inter-mode. Un événement authentique mais sans
 * contrat SB Auto rattachable répond aussi 2xx (ignoré proprement) pour éviter
 * les retries inutiles ; seule une signature invalide renvoie 400.
 */

function rawBodyString(req) {
  return Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
}

export const stripeWebhook = asyncHandler(async (req, res) => {
  const raw = rawBodyString(req);
  const signature = req.headers['stripe-signature'];

  let verification;
  try {
    verification = await verifyStripeWebhookAnyMode(raw, signature);
  } catch (err) {
    logger.error('[webhook] Vérification Stripe impossible', err.message);
    return res.status(500).json({ success: false, message: 'Configuration webhook manquante' });
  }
  if (!verification.verified) {
    return res.status(400).json({ success: false, message: 'Signature invalide' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ success: false, message: 'Payload invalide' });
  }

  try {
    const result = await handleStripeWebhook(event, verification);
    return res.json({ received: true, ...result });
  } catch (err) {
    // 500 -> Stripe réessaiera (l'idempotence protège du double traitement).
    logger.error('[webhook] Stripe traitement échoué', err.message);
    return res.status(500).json({ received: false });
  }
});

export const stripeInstituteWebhook = asyncHandler(async (req, res) => {
  const raw = rawBodyString(req);
  const signature = req.headers['stripe-signature'];
  const verified = await verifyInstituteStripeWebhook(raw, signature);
  if (!verified) {
    return res.status(400).json({ success: false, message: 'Signature institut invalide' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ success: false, message: 'Payload invalide' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await finalizeInstituteStripeCheckout(event.data?.object);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      logger.warn('[webhook] Paiement institut asynchrone echoue', event.data?.object?.id);
    }
    return res.json({ received: true });
  } catch (err) {
    logger.error('[webhook] Stripe Institut traitement echoue', err.message);
    return res.status(500).json({ received: false });
  }
});

/*
 *  a ete RETIRE en R10.5C.
 *
 * Yousign appelle desormais le PANEL, qui verifie, resout l'appartenance,
 * normalise le fait et le projette DURABLEMENT par le pont. Un projet eteint
 * rattrape a la reconnexion au lieu de perdre l evenement.
 *
 * L'applicateur local vit dans .
 */

/*
 * R11 — LE WEBHOOK BREVO LOCAL A ETE RETIRE, comme Yousign avant lui.
 *
 * Les e-mails de ce projet partent du compte Brevo DU PANEL. Or les evenements
 * de livraison suivent le COMPTE : Brevo n'appelait donc plus cette route, il
 * appelle le Panel. Celui-ci resout l'appartenance, normalise le fait et le
 * projette DURABLEMENT par le pont — un projet eteint rattrape a la reconnexion
 * au lieu de perdre l'evenement.
 *
 * L'applicateur local vit dans `email/emailDeliveryEvent.applier.js`, et il est
 * CONSERVE : c'est lui qui recoit `EMAIL_DELIVERED` / `EMAIL_BOUNCED`.
 */
