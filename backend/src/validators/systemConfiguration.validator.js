import { z } from 'zod';
import { normalizeAppUrl } from '../utils/normalizeAppUrl.js';

// Champ URL : validé ET normalisé (origine sans slash final). Message FR explicite.
const appUrl = z.string().transform((value, ctx) => {
  try {
    return normalizeAppUrl(value);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e.message });
    return z.NEVER;
  }
});

const networkBody = z.object({
  backendUrl: appUrl,
  managerUrl: appUrl,
  websiteUrl: appUrl,
});

export const networkUpdateSchema = { body: networkBody };
export const networkTestSchema = { body: networkBody };
