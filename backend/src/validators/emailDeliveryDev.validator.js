import { z } from 'zod';
import { DELIVERY_STATUS_VALUES } from '../utils/emailTemplateConstants.js';
import { NORMALIZED_EVENT_VALUES } from '../utils/brevoTransactionalEventRegistry.js';
import { WEBHOOK_PROCESSING_STATUS_VALUES } from '../utils/brevoWebhookConstants.js';

/**
 * Schémas STRICTS des consultations DEV du suivi de livraison. `.strict()` est la
 * seule barrière contre l'injection d'un opérateur Mongo via la query (les filtres
 * alimentent directement `find`). Aucun champ ne fait fuiter de secret ou de PII.
 */

const providerMode = z.enum(['TEST', 'PROD']).optional();
const dateRange = { from: z.coerce.date().optional(), to: z.coerce.date().optional() };
const paging = {
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce.date().optional(),
};
const search = z.string().trim().max(128).optional();

export const listDeliveriesSchema = {
  query: z
    .object({
      providerMode,
      status: z.enum(DELIVERY_STATUS_VALUES).optional(),
      eventType: z.enum(NORMALIZED_EVENT_VALUES).optional(),
      templateId: z.string().trim().max(120).optional(),
      search,
      ...dateRange,
      ...paging,
    })
    .strict(),
};

export const deliveryIdSchema = {
  params: z.object({ deliveryId: z.string().trim().min(1).max(64) }),
};

export const listWebhookEventsSchema = {
  query: z
    .object({
      providerMode,
      eventType: z.enum(NORMALIZED_EVENT_VALUES).optional(),
      processingStatus: z.enum(WEBHOOK_PROCESSING_STATUS_VALUES).optional(),
      matched: z.coerce.boolean().optional(),
      search,
      ...dateRange,
      ...paging,
    })
    .strict(),
};

export const webhookEventIdSchema = {
  params: z.object({ webhookEventId: z.string().trim().min(1).max(64) }),
};
