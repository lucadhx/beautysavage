import mongoose from 'mongoose';

/**
 * DEMANDE D'AVIS — une par prestation ou formation TERMINÉE, pour une cliente.
 *
 * `sourceKey` dit ce qui a été vécu, sans ambiguïté :
 *   · `CAL:<calendarEventId>`        un rendez-vous prestation passé ;
 *   · `SES:<saleId>:<lineId>`        une session de formation présentielle finie ;
 *   · `SUB:<trainingSubmissionId>`   une formation à distance validée par l'institut.
 *
 * Le calendrier des envois est FIGÉ à la création (`steps`) : modifier la
 * configuration d'une fiche vaut pour les prochaines demandes, pas pour celles
 * déjà lancées. `step` est le prochain envoi à faire ; `nextSendAt` sa date.
 */
const stepSchema = new mongoose.Schema(
  {
    value: { type: Number, required: true, min: 1 },
    unit: { type: String, enum: ['HOURS', 'DAYS', 'WEEKS', 'MONTHS'], required: true },
  },
  { _id: false }
);

const reviewRequestSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct', required: true, index: true },
    productKind: { type: String, default: '' },
    title: { type: String, default: '', trim: true },
    sourceKey: { type: String, required: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommerceSale', default: null },
    completedAt: { type: Date, required: true },
    /** Premier envoi puis relances, chacune comptée après l'envoi précédent. */
    steps: { type: [stepSchema], default: [] },
    step: { type: Number, default: 0 },
    nextSendAt: { type: Date, default: null, index: true },
    sentAt: { type: [Date], default: [] },
    /**
     * ACTIVE     des envois restent à faire ;
     * COMPLETED  tous les envois sont partis, aucun avis encore ;
     * REVIEWED   l'avis est reçu (ici ou sur une autre demande du même produit) ;
     * CANCELLED  plus rien à envoyer (cliente sans adresse, fiche retirée…).
     */
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'REVIEWED', 'CANCELLED'], default: 'ACTIVE', index: true },
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review', default: null },
    origin: { type: String, enum: ['AUTO', 'BACKFILL'], default: 'AUTO' },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

reviewRequestSchema.index({ customerId: 1, sourceKey: 1 }, { unique: true });
reviewRequestSchema.index({ status: 1, nextSendAt: 1 });

export const ReviewRequest = mongoose.model('ReviewRequest', reviewRequestSchema);

/**
 * Point de départ de la détection automatique : posé au premier passage.
 * Les prestations terminées AVANT ne déclenchent rien d'elles-mêmes — leur
 * demande, si on la veut, part par une campagne explicite (rattrapage).
 */
const reviewRequestStateSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'global', unique: true },
    discoverySince: { type: Date, required: true },
  },
  { timestamps: true }
);

export const ReviewRequestState = mongoose.model('ReviewRequestState', reviewRequestStateSchema);
export default ReviewRequest;
