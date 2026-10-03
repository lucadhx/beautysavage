import { z } from 'zod';

/**
 * LE RÉFÉRENCEMENT DE L'ENTREPRISE — longueurs et formats, rien de plus.
 * Les profils externes doivent être des adresses absolues : une donnée
 * structurée `sameAs` relative ne désigne rien.
 */
const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Adresse web invalide (https://…)');

export const seoSettingsUpdateSchema = z.object({
  indexable: z.boolean().optional(),
  businessType: z.enum(['BeautySalon', 'NailSalon', 'DaySpa', 'HealthAndBeautyBusiness']).optional(),
  homeTitle: z.string().max(120).optional(),
  homeDescription: z.string().max(320).optional(),
  address: z.object({
    street: z.string().max(200).optional(),
    postalCode: z.string().max(20).optional(),
    city: z.string().max(120).optional(),
    region: z.string().max(120).optional(),
    country: z.string().max(2).optional(),
  }).partial().optional(),
  geo: z.object({
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  }).partial().optional(),
  areaServed: z.string().max(200).optional(),
  priceRange: z.string().max(10).optional(),
  sameAs: z.array(url).max(12).optional(),
  shareImage: z.string().max(500).optional(),
}).passthrough();
