/**
 * refundRequestedTemplateMigration.js
 * Idempotent migration — runs once at startup.
 * Supprime le template refund_requested en base s'il ne contient pas trackingUrl,
 * forçant sa régénération avec le contenu à jour au prochain envoi.
 */

export async function migrateRefundRequestedTemplate() {
  try {
    const { default: EmailTemplate } = await import('../models/EmailTemplate.js');
    const existing = await EmailTemplate.findOne({ functionName: 'refund_requested' }).lean();

    if (
      existing &&
      !existing.htmlContent?.includes('trackingUrl') &&
      !existing.htmlContent?.includes('trackingurl') &&
      !existing.fullHtml?.includes('trackingUrl') &&
      !existing.fullHtml?.includes('trackingurl') &&
      !existing.bodyHtml?.includes('trackingUrl') &&
      !existing.bodyHtml?.includes('trackingurl')
    ) {
      await EmailTemplate.deleteOne({ functionName: 'refund_requested' });
      console.log('[Migration] Template refund_requested réinitialisé avec trackingUrl');
    }
  } catch (err) {
    console.error('[Migration] Erreur refund_requested:', err.message);
  }
}
