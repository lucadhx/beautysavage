/**
 * servicePagesMigration.js
 * Upserts the vitrine pages required for the services/prestations feature.
 * Safe to run multiple times (idempotent).
 */
import Page from '../models/Page.js';

const PAGES = [
  {
    slug: 'prestations',
    moduleFile: 'services',
    type: 'vitrine',
    order: 50,
    navigationPlacement: null,
    access: { public: true, requiresAuth: false, requiresPurchase: false }
  },
  {
    slug: 'service-detail',
    moduleFile: 'serviceDetail',
    type: 'vitrine',
    order: 51,
    navigationPlacement: null,
    access: { public: true, requiresAuth: false, requiresPurchase: false }
  },
  {
    slug: 'mes-prestations',
    moduleFile: 'myServices',
    type: 'vitrine',
    order: 52,
    navigationPlacement: null,
    access: { public: false, requiresAuth: true, requiresPurchase: false }
  }
];

export async function runServicePagesMigration() {
  for (const page of PAGES) {
    const existing = await Page.findOne({ slug: page.slug }).lean();
    if (existing) {
      // Only fix moduleFile if it's wrong — don't overwrite intentional customizations
      if (existing.moduleFile !== page.moduleFile) {
        await Page.updateOne({ slug: page.slug }, { $set: { moduleFile: page.moduleFile } });
        console.log(`[ServicePagesMigration] Fixed moduleFile for slug="${page.slug}": "${existing.moduleFile}" -> "${page.moduleFile}"`);
      } else {
        console.log(`[ServicePagesMigration] slug="${page.slug}" already correct (moduleFile="${page.moduleFile}").`);
      }
    } else {
      await Page.create(page);
      console.log(`[ServicePagesMigration] Created page slug="${page.slug}" moduleFile="${page.moduleFile}".`);
    }
  }
}
