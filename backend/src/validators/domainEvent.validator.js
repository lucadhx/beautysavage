import { z } from 'zod';
import { EVENT_DISPATCH_STATUS_VALUES } from '../utils/domainEventConstants.js';
import { DOMAIN_EVENT_TYPES } from '../utils/domainEventRegistry.js';

// Schémas STRICTS : seule barrière contre l'injection d'un opérateur Mongo via la
// query (les filtres alimentent directement `find`).

export const listEventsSchema = {
  query: z
    .object({
      // Le type est contraint au registre : impossible de sonder un champ arbitraire.
      type: z.enum(DOMAIN_EVENT_TYPES).optional(),
      entityType: z.string().trim().max(64).optional(),
      entityId: z.string().trim().max(128).optional(),
      dispatchStatus: z.enum(EVENT_DISPATCH_STATUS_VALUES).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.coerce.date().optional(),
    })
    .strict(),
};

export const eventIdSchema = {
  params: z.object({ eventId: z.string().trim().uuid("Identifiant d'événement invalide") }),
};
