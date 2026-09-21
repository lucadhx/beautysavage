import { Router } from 'express';
import express from 'express';
import * as ctrl from '../controllers/webhook.controller.js';

/**
 * Routes webhook. IMPORTANT : ce routeur est monté AVANT express.json() dans
 * app.js et utilise express.raw() — la vérification de signature (Stripe &
 * Yousign) exige le corps BRUT non parsé.
 */
const router = Router();

const raw = express.raw({ type: '*/*', limit: '2mb' });

router.post('/stripe', raw, ctrl.stripeWebhook);
router.post('/stripe-institute', raw, ctrl.stripeInstituteWebhook);
/**
 * Sonde de JOIGNABILITÉ, appelée par notre propre backend sur l'URL publique
 * pour vérifier que le chemin d'arrivée est ouvert (tunnel de dev encore debout,
 * reverse-proxy correct) sans avoir à envoyer d'e-mail. Publique et anonyme :
 * elle ne révèle rien (`{ ok: true }`) et n'a aucun effet de bord.
 */
// Mêmes sondes pour Stripe et Yousign (webhooks gérés automatiquement) :
// anonymes, sans effet de bord, ne révèlent rien.
router.get('/stripe/health', (req, res) => res.json({ ok: true }));
router.get('/stripe-institute/health', (req, res) => res.json({ ok: true }));

export default router;
