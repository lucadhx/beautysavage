import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { resolveProviderEnvironment } from '../services/integratedApiEnvironment.js';
import * as service from '../services/emailConfiguration.service.js';

/**
 * Configuration e-mail — DEV UNIQUEMENT (garde posée sur le routeur).
 *
 * Le contrôleur n'appelle jamais Brevo : il délègue au service. Le MODE n'est
 * jamais lu depuis la requête — toujours résolu côté serveur — pour qu'un écran
 * affichant TEST ne puisse en aucun cas écrire dans PROD.
 */

/** Mode Brevo actif, ou refus explicite : sans mode, il n'y a rien à écrire. */
async function requireActiveMode() {
  const mode = resolveProviderEnvironment('BREVO');
  if (!mode) {
    throw ApiError.badRequest(
      "Aucun mode d'envoi actif pour ce projet.",
      { code: 'PROVIDER_NOT_CONFIGURED' }
    );
  }
  return mode;
}

/** Réponse canonique : le Manager remplace son état par cette projection. */
async function respond(res, cfg) {
  const environment = resolveProviderEnvironment('BREVO');
  return ok(res, await service.serializeEmailConfiguration(cfg, environment));
}

/** GET /email-configuration */
export const get = asyncHandler(async (req, res) => {
  return respond(res, await service.getEmailConfiguration());
});

/*
 * `updateSender` et `testSend` ont été RETIRÉS en R10.5.
 *
 * Le premier écrivait le From de ce projet ; le second envoyait un e-mail en
 * appelant Brevo directement avec une clé locale. Les deux surfaces vivent
 * désormais dans le Panel, où l'expéditeur est unique et où le test emprunte la
 * chaîne réelle — voir `routes/emailConfiguration.routes.js`.
 */

/**
 * POST /email-configuration/restore — « Rétablir le service ».
 *
 * UNE action utilisateur, plusieurs sous-étapes qu'il n'a pas à connaître :
 * resynchronisation du suivi, sonde réelle de l'URL publique, relecture de
 * l'état. La réponse porte l'état FINAL et un `ready` booléen — c'est lui, et
 * rien d'autre, qui autorise le Manager à annoncer un succès.
 *
 * Toujours 200 : un service non rétabli est un RÉSULTAT, pas une panne HTTP.
 */
export const restore = asyncHandler(async (req, res) => {
  const mode = await requireActiveMode();
  const { cfg, ready, code } = await service.restoreEmailService({ mode, actor: req.user });
  const environment = resolveProviderEnvironment('BREVO');
  return ok(res, {
    ...(await service.serializeEmailConfiguration(cfg, environment)),
    restore: { ready, code },
  });
});

/**
 * GET /email-configuration/test-status — suivi CIBLÉ du dernier test.
 *
 * Charge utile minimale, volontairement : recharger la configuration complète
 * pour suivre une livraison faisait travailler tout l'écran pour un seul champ.
 */
export const testStatus = asyncHandler(async (req, res) => {
  const mode = await requireActiveMode();
  return ok(res, await service.getTestDeliveryStatus({ mode }));
});
