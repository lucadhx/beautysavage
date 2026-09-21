import mongoose from 'mongoose';

/**
 * Signataire contractuel d'une entreprise (développeur ou cliente).
 *
 * Configuration MÉTIER explicite : c'est la personne physique qui engage
 * l'entreprise. Elle n'est JAMAIS déduite d'un compte utilisateur (un compte
 * DEV/ADMIN sert à se connecter, pas à signer), ni d'un média public
 * (`Company.media`), dont l'affichage sur la vitrine n'a aucun rapport avec un
 * engagement contractuel.
 *
 * `null` tant que l'entreprise ne l'a pas renseigné — la validation d'un
 * contrat l'exige alors explicitement.
 *
 * Réutilisé tel quel par Company et DevCompany : les deux parties ont la même
 * forme, seul le `companyName` (figé au snapshot) les distingue.
 */
export const companySignerSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: '', trim: true },
    lastName: { type: String, default: '', trim: true },
    jobTitle: { type: String, default: '', trim: true }, // facultatif (mention de courtoisie)
    email: { type: String, default: '', trim: true, lowercase: true },
  },
  { _id: false }
);

export default companySignerSchema;
