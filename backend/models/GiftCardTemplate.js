import mongoose from 'mongoose';

/**
 * M13 — GiftCardTemplate (Gift Card Template Studio, dev-only).
 *
 * Modèle de RENDU visuel d'une carte cadeau (HTML + CSS + variables). Patterns mirrorés :
 *  - Versioning façon EmailTemplate/NotificationTemplate : `version`, `status` draft/published/archived,
 *    index unique partiel "un seul publié par slug".
 *  - "Un seul actif" façon Theme : index unique partiel sur `active:true` → au plus UN template actif
 *    dans toute la collection. La règle "impossible d'avoir zéro template actif" est garantie côté
 *    service (refus de désactiver le dernier) + seed d'un template système.
 *
 * `visible` : apparaît dans la librairie admin (l'admin choisit l'actif parmi les visibles).
 */

export const GIFT_CARD_TEMPLATE_STATUSES = Object.freeze(['draft', 'published', 'archived']);

// Variables supportées par le moteur de rendu (Part 6). Le studio affiche utilisées/inconnues.
export const GIFT_CARD_TEMPLATE_VARIABLES = Object.freeze([
  'recipientName',
  'purchaserName',
  'amount',
  'code',
  'pin',
  'qrCode',
  'message',
  'createdAt',
  'paymentLabel',
  'instituteName'
]);

const giftCardTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Slug = identité logique d'un template (toutes les versions d'un même template le partagent).
    slug: { type: String, required: true, trim: true, lowercase: true },

    html: { type: String, default: '' },
    css: { type: String, default: '' },

    // Noms de variables autorisées (informational, pour le studio).
    variables: { type: [String], default: () => [...GIFT_CARD_TEMPLATE_VARIABLES] },
    // Données fictives pour la preview (variable -> valeur d'exemple).
    previewData: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // Apparaît dans la librairie admin.
    visible: { type: Boolean, default: true },
    // Template actif (rendu réel des cartes). Au plus un dans toute la collection.
    active: { type: Boolean, default: false },

    // --- Versioning ---------------------------------------------------------------------
    version: { type: Number, default: 1 },
    status: { type: String, enum: GIFT_CARD_TEMPLATE_STATUSES, default: 'published' },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdFromVersion: { type: Number, default: null },
    isSystemDefault: { type: Boolean, default: false },

    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' }
  },
  {
    timestamps: true,
    collection: 'gift_card_templates'
  }
);

giftCardTemplateSchema.index({ slug: 1, version: -1 });
giftCardTemplateSchema.index({ status: 1, visible: 1 });
// Un seul document publié par slug (comme EmailTemplate).
giftCardTemplateSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { status: 'published' }, name: 'uniq_published_gift_card_template' }
);
// Au plus UN template actif dans toute la collection (toutes les clés valent `true` → unique global).
giftCardTemplateSchema.index(
  { active: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'uniq_active_gift_card_template' }
);

const GiftCardTemplate = mongoose.model('GiftCardTemplate', giftCardTemplateSchema);
export default GiftCardTemplate;
