import { z } from 'zod';

/**
 * Rattachement manuel d'une facture Stripe (DEV).
 *
 * `url` accepte un lien Stripe OU un identifiant `in_…` : la reconnaissance
 * fine (domaine, forme) appartient au service, qui sait quoi dire à
 * l'utilisateur. Ici on borne seulement la taille et on impose une chaîne.
 *
 * `label` est le SEUL champ métier saisi : tout le reste est dérivé de Stripe.
 */
export const attachInvoiceSchema = {
  body: z
    .object({
      url: z.string().trim().min(1, 'Lien ou identifiant requis').max(2048, 'Lien trop long'),
      label: z.string().trim().max(80, 'Nom trop long (80 caractères max)').optional().default(''),
    })
    .strict(),
};

export default attachInvoiceSchema;
