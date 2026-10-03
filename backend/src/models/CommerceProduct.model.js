import mongoose from 'mongoose';

export const PRODUCT_KIND = Object.freeze({
  DISTANCE_TRAINING: 'DISTANCE_TRAINING',
  IN_PERSON_TRAINING: 'IN_PERSON_TRAINING',
  SERVICE: 'SERVICE',
  GIFT_CARD: 'GIFT_CARD',
  PRODUCT: 'PRODUCT',
});

export const PRODUCT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  DISABLED: 'DISABLED',
  ARCHIVED: 'ARCHIVED',
});

const moneySchema = new mongoose.Schema(
  {
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR' },
  },
  { _id: false }
);

const productOptionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    priceCents: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    capacity: { type: Number, default: 0, min: 0 },
    reservedCount: { type: Number, default: 0, min: 0 },
    // L'éditeur propose « Complète » et « Bloquée » : sans eux dans l'énumération,
    // choisir l'un des deux faisait échouer tout l'enregistrement de la formation.
    status: { type: String, enum: ['ACTIVE', 'FULL', 'BLOCKED', 'CANCELLED'], default: 'ACTIVE' },
    cancellationReason: { type: String, default: '' },
    /**
     * LES JOURS DE LA SESSION — une formation de 2 jours réserve 2 plages
     * (jour 1, jour 2), pas la nuit entre les deux. `startsAt` / `endsAt`
     * restent le début du premier jour et la fin du dernier (messages,
     * tri, compatibilité). Vide pour une session d'avant : une seule plage.
     */
    days: {
      type: [new mongoose.Schema({ startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true }
);

const commerceProductSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },
    kind: { type: String, enum: Object.values(PRODUCT_KIND), required: true, index: true },
    status: { type: String, enum: Object.values(PRODUCT_STATUS), default: PRODUCT_STATUS.DRAFT, index: true },
    price: { type: moneySchema, required: true },
    coverUrl: { type: String, default: '' },
    gallery: [{ type: String }],
    options: [productOptionSchema],
    sessions: [sessionSchema],
    durationMinutes: { type: Number, default: 0, min: 0 },
    distanceDeliveryMode: { type: String, enum: ['MANUAL', 'IMMEDIATE', null], default: null },
    requiresLegalWaiver: { type: Boolean, default: false },
    boostRank: { type: Number, default: null },
    /**
     * MISE EN AVANT SUR L'ACCUEIL — choisie depuis la page de gestion
     * (formations ou prestations), plus depuis un onglet de chaque fiche.
     * `homeFeaturedRank` ordonne les fiches retenues (1 = première).
     */
    homeFeatured: { type: Boolean, default: false, index: true },
    homeFeaturedRank: { type: Number, default: null },
    trailer: { type: mongoose.Schema.Types.Mixed, default: {} },
    whatsappGroup: { type: mongoose.Schema.Types.Mixed, default: {} },
    faq: { type: [mongoose.Schema.Types.Mixed], default: [] },
    training: { type: mongoose.Schema.Types.Mixed, default: {} },
    modules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    promotion: { type: mongoose.Schema.Types.Mixed, default: {} },
    evaluation: { type: mongoose.Schema.Types.Mixed, default: {} },
    service: { type: mongoose.Schema.Types.Mixed, default: {} },
    paymentRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    bookingRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    /**
     * RÉFÉRENCEMENT — facultatif. Vide, le titre et la description de la page
     * sont COMPOSÉS à partir de la fiche (nom, type, prix, lieu, description) :
     * le référencement suit donc tout seul ce que l'institut modifie. Rempli,
     * il prend la main.
     */
    seo: {
      metaTitle: { type: String, default: '', maxlength: 120 },
      metaDescription: { type: String, default: '', maxlength: 320 },
    },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

commerceProductSchema.index({ kind: 1, status: 1, boostRank: 1, title: 1 });

export const CommerceProduct = mongoose.model('CommerceProduct', commerceProductSchema);
export default CommerceProduct;
