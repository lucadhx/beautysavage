import { z } from 'zod';
import { ROLE_VALUES } from '../utils/constants.js';

export const idParam = {
  params: z.object({ id: z.string().min(1) }),
};

// Réordonnancement générique : body = { items: [{ id, order }] }. Les clés
// inconnues sont supprimées (pas de passthrough) → aucun opérateur Mongo ne
// peut transiter vers findByIdAndUpdate.
export const reorderSchema = {
  body: z.object({
    items: z.array(z.object({ id: z.string().min(1), order: z.coerce.number() })),
  }),
};

/**
 * GAMME DE PRIX — un nom, un ordre, rien d'autre.
 *
 * Pas de `passthrough()` : une gamme ne porte AUCUN prix, et un corps qui en
 * proposerait un doit être refusé plutôt qu'ignoré. Le laisser passer vers
 * mongoose le ferait disparaître en silence — et l'opérateur croirait avoir
 * enregistré un tarif.
 */
export const pricingRangeCreateSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Nom de gamme requis').max(80, 'Nom de gamme trop long'),
    order: z.coerce.number().int().min(0).optional(),
  }).strict(),
};

export const pricingRangeUpdateSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().trim().min(1, 'Nom de gamme requis').max(80, 'Nom de gamme trop long').optional(),
    order: z.coerce.number().int().min(0).optional(),
  }).strict(),
};

export const accountCreateSchema = {
  body: z.object({
    email: z.string().email('Email invalide'),
    password: z.string().min(6, 'Mot de passe : 6 caractères minimum'),
    name: z.string().optional().default(''),
    role: z.enum(ROLE_VALUES),
  }),
};

export const accountUpdateSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    email: z.string().email('Email invalide').optional(),
    password: z.string().min(6).optional().or(z.literal('')),
    name: z.string().optional(),
    role: z.enum(ROLE_VALUES).optional(),
  }),
};

export const reviewSchema = {
  body: z.object({
    name: z.string().min(1, 'Nom requis'),
    photo: z.string().optional().default(''),
    images: z.array(z.string()).optional().default([]),
    rating: z.coerce.number().min(1).max(5),
    comment: z.string().optional().default(''),
    date: z.coerce.date().optional(),
    prestation: z
      .object({
        serviceId: z.string().nullable().optional(),
        categoryId: z.string().nullable().optional(),
        prestationId: z.string().nullable().optional(),
        label: z.string().optional(),
      })
      .partial()
      .optional(),
    order: z.coerce.number().optional(),
    published: z.boolean().optional(),
  }),
};

export const serviceSchema = {
  body: z
    .object({
      title: z.string().min(1, 'Titre requis'),
    })
    .passthrough(), // deep structure validated by Mongoose
};

export const suspendSchema = {
  body: z.object({
    reason: z.string().optional().default(''),
    suspendedAt: z.coerce.date().optional(),
    /**
     * NOTIFIER LES ADMINISTRATEURS — facultatif, et FAUX par défaut.
     *
     * Le défaut n'est pas neutre, il est prudent : cocher par défaut enverrait
     * un e-mail à tous les administrateurs d'un client à chaque manipulation
     * interne — une maintenance de dix minutes un dimanche matin comprise. La
     * case est un geste délibéré, et l'écran la présente décochée.
     *
     * Un corps sans le champ ne notifie donc pas, et c'est le comportement
     * historique des appels existants.
     */
    notifyAdmins: z.boolean().optional().default(false),
  }),
};

/**
 * Protection contractuelle : un booléen, et EXPLICITE.
 *
 * Pas de valeur par défaut : une requête sans `enabled` est refusée plutôt
 * qu'interprétée. Deviner « false » sur un corps vide désactiverait la
 * protection d'un site sur un appel malformé.
 */
export const contractProtectionSchema = {
  body: z.object({
    enabled: z.boolean({
      required_error: 'Le champ « enabled » est requis (true ou false).',
      invalid_type_error: 'Le champ « enabled » doit être un booléen.',
    }),
  }),
};
