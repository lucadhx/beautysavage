import { z } from 'zod';
import { MAX_RECIPIENTS } from '../controllers/contactNotificationRecipients.controller.js';
import { MAX_EMAIL_LENGTH } from '../utils/contactConstants.js';

/**
 * Destinataires des notifications de contact.
 *
 * STRICT et NORMALISÉ à la frontière : adresses trimées, en minuscules,
 * dédupliquées, bornées. La liste PEUT être vide — c'est le cas « fallback sur
 * l'adresse support » assumé, pas une erreur.
 */
export const updateRecipientsSchema = {
  body: z
    .object({
      recipients: z
        .array(
          z
            .string()
            .trim()
            .toLowerCase()
            .email('Adresse email invalide')
            .max(MAX_EMAIL_LENGTH, 'Adresse trop longue')
        )
        .max(MAX_RECIPIENTS, `Au maximum ${MAX_RECIPIENTS} adresses`)
        // Déduplication après normalisation : deux fois la même adresse = une seule.
        .transform((list) => Array.from(new Set(list))),
    })
    .strict(),
};
