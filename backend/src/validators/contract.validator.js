import { z } from 'zod';
import {
  SIGNER_ROLE_VALUES, SUBSCRIPTION_INTERVAL_VALUES, SIGNATURE_REQUIREMENT_VALUES,
  SUBSCRIPTION_RECURRENCE_UNIT_VALUES, MAX_SUBSCRIPTION_INTERVAL_BY_UNIT,
  MAX_PAYMENT_GRACE_DAYS,
} from '../utils/contractConstants.js';

// Montants saisis en EUROS (HT) côté Manager -> convertis en centimes au service.
const pricingLine = z
  .object({
    enabled: z.boolean(),
    amountExcludingTax: z.number().nonnegative().optional(), // EUROS (HT) — convertis en centimes côté service
  })
  .strict();

/**
 * LA RÉCURRENCE — « tous les <interval> <unit> ».
 *
 * ══ CE QUE CE SCHÉMA REFUSE, ET POURQUOI IL LE REFUSE ICI ═══════════════════
 *
 *     interval = 0      un abonnement sans échéance ne s'échoit jamais
 *     interval = -1     une périodicité ne remonte pas le temps
 *     interval = 1.5    Stripe compte des pas entiers, pas des demi-mois
 *     unit = WEEK       aucun écran, aucune facture ne sait dire cette offre
 *
 * Le compteur du Manager empêche déjà de les composer — et c'est exactement
 * pour cela qu'ils doivent être refusés ici : un formulaire n'est pas une
 * garantie, c'est un confort. Une requête forgée, un script de reprise ou un
 * client mal à jour n'en passent pas par lui.
 *
 * `int()` avant `min()` : sans lui, `1.5` échouerait sur un message parlant de
 * bornes plutôt que d'entiers, et l'appelant chercherait longtemps.
 */
const subscriptionRecurrence = z
  .object({
    unit: z.enum(SUBSCRIPTION_RECURRENCE_UNIT_VALUES),
    interval: z.number().int().min(1),
  })
  .strict()
  /**
   * LE PLAFOND DÉPEND DE L'UNITÉ — trois ans, dites en mois ou en années.
   * `superRefine` plutôt que deux schémas : la règle est une, et la scinder la
   * ferait diverger à la première correction. Voir
   * `MAX_SUBSCRIPTION_INTERVAL_BY_UNIT`.
   */
  .superRefine((r, ctx) => {
    const plafond = MAX_SUBSCRIPTION_INTERVAL_BY_UNIT[r.unit];
    if (r.interval > plafond) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['interval'],
        message: `Périodicité trop longue : au plus ${plafond} pour l'unité ${r.unit} (le fournisseur borne une période à trois ans).`,
      });
    }
  });

/**
 * Ligne d'abonnement. Le montant saisi est celui débité à CHAQUE échéance —
 * jamais un prix mensuel à multiplier, quelle que soit la récurrence.
 *
 * `interval` (chaîne) reste accepté le temps de la transition : un Manager non
 * encore rechargé continue de l'envoyer. Il est lu comme « tous les 1 <unité> »
 * et n'écrase jamais un `recurrence` présent — voir `updateDraft`.
 */
const subscriptionLine = z
  .object({
    enabled: z.boolean(),
    amountExcludingTax: z.number().nonnegative().optional(),
    recurrence: subscriptionRecurrence.optional(),
    interval: z.enum(SUBSCRIPTION_INTERVAL_VALUES).optional(),
  })
  .strict();

const updateDraftBody = z
  .object({
    name: z.string().max(160).optional(),
    launchFee: pricingLine.optional(),
    subscription: subscriptionLine.optional(),
    taxRate: z.number().min(0).max(100).optional(),
    // Décision EXPLICITE : une signature doit-elle être réalisée dans ce
    // parcours ? (REQUIRED | NOT_REQUIRED)
    signatureRequirement: z.enum(SIGNATURE_REQUIREMENT_VALUES).optional(),
  })
  .strict();

const zone = z
  .object({
    id: z.string().min(1),
    name: z.string().optional().default(''),
    signerRole: z.enum(SIGNER_ROLE_VALUES),
    page: z.number().int().min(1),
    xRatio: z.number().min(0).max(1),
    yRatio: z.number().min(0).max(1),
    widthRatio: z.number().min(0).max(1),
    heightRatio: z.number().min(0).max(1),
    type: z.string().optional().default('SIGNATURE'),
  })
  .strict();

const signatureConfigBody = z.object({ zones: z.array(zone) }).strict();

/**
 * Politique de grâce en cas d'impayé (L10.6B-1).
 *
 * `nullable()` sans `optional()` : le champ est OBLIGATOIRE dans le corps, et
 * `null` y est une valeur licite qui veut dire « aucune politique ». Rendre le
 * champ optionnel aurait confondu « je retire la politique » avec « je n'ai
 * rien envoyé » — deux intentions qu'un réglage de suspension ne doit jamais
 * mélanger.
 */
const paymentGracePolicyBody = z
  .object({
    paymentGraceDays: z.number().int().min(0).max(MAX_PAYMENT_GRACE_DAYS).nullable(),
  })
  .strict();

export const updateDraftSchema = { body: updateDraftBody };
export const signatureConfigSchema = { body: signatureConfigBody };
export const paymentGracePolicySchema = { body: paymentGracePolicyBody };
