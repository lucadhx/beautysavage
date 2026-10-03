import mongoose from 'mongoose';
import { mediaDescriptorSchema } from './mediaDescriptor.schema.js';

/**
 * LE RÉFÉRENCEMENT DE L'ENTREPRISE — ce que les moteurs (Google, Bing) et les
 * assistants IA doivent comprendre de l'institut, et que rien d'autre ne dit.
 *
 * ══ POURQUOI UN DOCUMENT À PART ═════════════════════════════════════════════
 *
 * Presque tout le référencement est DÉRIVÉ : le nom, l'accroche, les offres,
 * leurs prix, les avis, les horaires d'ouverture (planning de réservation) —
 * chaque page le recompose à la volée depuis ce que le Manager publie. Ce
 * document ne porte donc que ce qu'aucune autre fiche ne sait :
 *
 *   · le TYPE d'établissement (institut de beauté, onglerie…) ;
 *   · une ADRESSE STRUCTURÉE (rue, code postal, ville) — la fiche entreprise
 *     n'a qu'une ligne libre, illisible pour une donnée structurée ;
 *   · la zone desservie, la gamme de prix, les profils externes (fiche
 *     Google, Facebook, Planity…) qui CORROBORENT l'entité ;
 *   · les textes et l'image de partage de l'accueil, si l'on veut les choisir.
 *
 * Tout champ vide se replie sur une valeur dérivée : un institut qui ne
 * touche jamais à cet écran a malgré tout un référencement complet.
 */
const addressSchema = new mongoose.Schema(
  {
    street: { type: String, default: '', maxlength: 200 },
    postalCode: { type: String, default: '', maxlength: 20 },
    city: { type: String, default: '', maxlength: 120 },
    region: { type: String, default: '', maxlength: 120 },
    country: { type: String, default: 'FR', maxlength: 2 },
  },
  { _id: false }
);

const seoSettingsSchema = new mongoose.Schema(
  {
    /** Faux : tout le site passe en « noindex » et le robots.txt ferme tout. */
    indexable: { type: Boolean, default: true },
    /** Type schema.org de l'établissement. */
    businessType: {
      type: String,
      enum: ['BeautySalon', 'NailSalon', 'DaySpa', 'HealthAndBeautyBusiness'],
      default: 'BeautySalon',
    },
    /** Titre de la page d'accueil (sinon : nom · accroche). */
    homeTitle: { type: String, default: '', maxlength: 120 },
    /** Description de l'accueil (sinon : introduction de l'accueil, ou accroche). */
    homeDescription: { type: String, default: '', maxlength: 320 },
    address: { type: addressSchema, default: () => ({}) },
    geo: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    /** « Nice et alentours », « Alpes-Maritimes »… */
    areaServed: { type: String, default: '', maxlength: 200 },
    /** « €€ » — l'échelle usuelle des annuaires. */
    priceRange: { type: String, default: '', maxlength: 10 },
    /** Profils publics qui décrivent la même entreprise (fiche Google, réseaux…). */
    sameAs: { type: [String], default: [] },
    /** Image de partage par défaut (réseaux sociaux) — sinon la bannière. */
    shareImage: { type: String, default: '' },
    shareImageMedia: { type: mediaDescriptorSchema, default: null },
  },
  { timestamps: true }
);

export const SeoSettings = mongoose.model('SeoSettings', seoSettingsSchema);
export default SeoSettings;
