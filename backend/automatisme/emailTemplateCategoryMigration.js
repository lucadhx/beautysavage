/**
 * emailTemplateCategoryMigration.js
 * Idempotent migration — runs once at startup.
 * Creates default EmailTemplateCategory documents and assigns categoryId + recipient
 * to each EmailTemplate (as isMetadataOnly docs if they don't already exist).
 */

import EmailTemplateCategory from '../models/EmailTemplateCategory.js';
import EmailTemplate from '../models/EmailTemplate.js';
import { mailTemplateDefaults } from '../services/mailService.js';

const DEFAULT_CATEGORIES = [
  { name: 'Ventes', slug: 'ventes', order: 1 },
  { name: 'Commissions', slug: 'commissions', order: 2 },
  { name: 'Remboursements', slug: 'remboursements', order: 3 },
  { name: 'Sessions & Annulations', slug: 'sessions', order: 4 },
  { name: 'Compte client', slug: 'compte', order: 5 },
  { name: 'Statut du site', slug: 'statut_site', order: 6 }
];

// Maps functionName → { categorySlug, recipient }
const TEMPLATE_CATEGORY_MAP = {
  vente:                          { categorySlug: 'ventes',        recipient: 'client' },
  commission_available:           { categorySlug: 'commissions',   recipient: 'institute' },
  commission_reminder:            { categorySlug: 'commissions',   recipient: 'institute' },
  commission_last_day:            { categorySlug: 'commissions',   recipient: 'institute' },
  refund_requested:               { categorySlug: 'remboursements', recipient: 'client' },
  refund_auto_initiated:          { categorySlug: 'remboursements', recipient: 'client' },
  refund_confirmed:               { categorySlug: 'remboursements', recipient: 'client' },
  gift_card_compensation:         { categorySlug: 'remboursements', recipient: 'client' },
  session_cancelled_choice:       { categorySlug: 'sessions',      recipient: 'client' },
  formation_deleted_choice:       { categorySlug: 'sessions',      recipient: 'client' },
  session_updated_choice:         { categorySlug: 'sessions',      recipient: 'client' },
  session_rescheduled:            { categorySlug: 'sessions',      recipient: 'client' },
  session_client_cancelled_refund:    { categorySlug: 'sessions',  recipient: 'client' },
  session_client_cancelled_no_refund: { categorySlug: 'sessions',  recipient: 'client' },
  institute_client_cancelled_notice:  { categorySlug: 'sessions',  recipient: 'institute' },
  email_confirmation_code:        { categorySlug: 'compte',        recipient: 'client' },
  password_reset:                 { categorySlug: 'compte',        recipient: 'client' },
  site_suspended:                 { categorySlug: 'statut_site',   recipient: 'institute' },
  site_reactivated:               { categorySlug: 'statut_site',   recipient: 'institute' },
  site_maintenance_start:         { categorySlug: 'statut_site',   recipient: 'institute' },
  site_maintenance_end:           { categorySlug: 'statut_site',   recipient: 'institute' }
};

async function ensureCategories() {
  const existing = await EmailTemplateCategory.find().lean();
  const existingSlugs = new Set(existing.map(c => c.slug));
  const toInsert = DEFAULT_CATEGORIES.filter(c => !existingSlugs.has(c.slug));
  if (toInsert.length) {
    await EmailTemplateCategory.insertMany(toInsert);
  }
  // Return full map slug → _id
  const all = await EmailTemplateCategory.find().lean();
  return new Map(all.map(c => [c.slug, c._id]));
}

async function ensureTemplateMetadata(categorySlugToId) {
  const entries = Object.entries(TEMPLATE_CATEGORY_MAP);
  for (const [functionName, { categorySlug, recipient }] of entries) {
    const categoryId = categorySlugToId.get(categorySlug) || null;
    const existing = await EmailTemplate.findOne({ functionName }).lean();
    if (!existing) {
      // Create a metadata-only doc so the list view can display it
      await EmailTemplate.create({
        functionName,
        subject: '',
        bodyHtml: '',
        fullHtml: '',
        mode: 'text',
        categoryId,
        recipient,
        isMetadataOnly: true
      });
    } else {
      // Update category/recipient only if not already set
      const needsUpdate =
        !existing.categoryId ||
        existing.recipient !== recipient;
      if (needsUpdate) {
        await EmailTemplate.updateOne(
          { functionName },
          { $set: { categoryId, recipient } }
        );
      }
    }
  }
}

// Patch docs that exist in DB with an empty subject (e.g. created as isMetadataOnly)
async function patchMissingSubjects() {
  const docsWithEmptySubject = await EmailTemplate.find({
    subject: { $in: [null, ''] }
  }).lean();

  for (const doc of docsWithEmptySubject) {
    const defaults = mailTemplateDefaults[doc.functionName];
    if (!defaults?.subject) continue;
    await EmailTemplate.updateOne(
      { _id: doc._id, subject: { $in: [null, ''] } },
      { $set: { subject: String(defaults.subject) } }
    );
  }

  if (docsWithEmptySubject.length) {
    console.log(
      `[EmailTemplateCategoryMigration] ${docsWithEmptySubject.length} sujet(s) manquant(s) patchés.`
    );
  }
}

export async function runEmailTemplateCategoryMigration() {
  try {
    const categorySlugToId = await ensureCategories();
    await ensureTemplateMetadata(categorySlugToId);
    await patchMissingSubjects();
    console.log('[EmailTemplateCategoryMigration] Migration terminée.');
  } catch (error) {
    console.error('[EmailTemplateCategoryMigration] Erreur lors de la migration :', error);
  }
}
