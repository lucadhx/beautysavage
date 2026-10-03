import mongoose from 'mongoose';

/**
 * COLLECTION DE PRESTATIONS — un rayon de la vitrine.
 *
 * Avec des dizaines de prestations, la page « Prestations » devenait une liste
 * interminable. Les collections la découpent en rayons (« Extensions de cils »,
 * « Beauté des pieds »…) : la vitrine montre d'abord les collections, puis les
 * prestations de celle qu'on ouvre.
 *
 *   · `order`       rang de la collection sur la page (0 = première) ;
 *   · `productIds`  prestations de la collection, DANS L'ORDRE d'affichage.
 *
 * Aucune collection = la vitrine garde sa liste simple : ajouter cette notion
 * ne change rien tant que l'institut ne s'en sert pas.
 */
const serviceCollectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '', maxlength: 1000 },
    coverUrl: { type: String, default: '' },
    order: { type: Number, default: 0, index: true },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommerceProduct' }],
  },
  { timestamps: true }
);

export const ServiceCollection = mongoose.model('ServiceCollection', serviceCollectionSchema);
export default ServiceCollection;
