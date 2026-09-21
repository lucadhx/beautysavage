import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { Company } from '../models/Company.model.js';
import { getSingleton } from '../utils/singleton.js';
import { resolveContactRecipients } from '../services/email/emailRecipientResolvers.js';

/**
 * Destinataires des notifications de nouvelle demande de contact.
 *
 * Réglage MÉTIER isolé : il vit sur `Company` mais s'édite par une route dédiée,
 * pour ne PAS transiter par le PUT /company « document entier » (dernier
 * écrivain gagne) — deux surfaces d'édition concurrentes sur le même champ se
 * marcheraient dessus. Ici, un seul champ, une seule intention.
 *
 * Ce n'est PAS de la configuration technique Brevo : le commerçant choisit qui
 * est prévenu, sans rien savoir de l'expéditeur ni du fournisseur.
 */

export const MAX_RECIPIENTS = 5;

/** Projection : la liste seule, jamais tout le document entreprise. */
function serialize(company) {
  return { recipients: Array.isArray(company.contactNotificationRecipients) ? company.contactNotificationRecipients : [] };
}

/**
 * La liste configurée PLUS la résolution EFFECTIVE (même règle que l'envoi,
 * jamais dupliquée) : l'administrateur voit QUI recevra réellement les
 * notifications — y compris quand le fallback ADMIN s'applique, ou quand
 * PERSONNE ne les recevrait (liste vide et aucun compte ADMIN valide).
 */
async function payload(company) {
  const resolution = await resolveContactRecipients();
  return {
    ...serialize(company),
    effective: {
      source: resolution.source, // CONFIGURED | ADMIN_FALLBACK | NONE
      emails: resolution.recipients.map((r) => r.email),
    },
  };
}

/** GET /api/company/contact-notification-recipients */
export const get = asyncHandler(async (req, res) => {
  return ok(res, await payload(await getSingleton(Company)));
});

/**
 * PUT /api/company/contact-notification-recipients
 *
 * Le validateur a déjà normalisé (trim, minuscules), validé les adresses,
 * dédupliqué et borné à MAX_RECIPIENTS. On persiste tel quel.
 */
export const update = asyncHandler(async (req, res) => {
  const company = await getSingleton(Company);
  company.contactNotificationRecipients = req.body.recipients;
  await company.save();
  return ok(res, await payload(company));
});
