import mongoose from 'mongoose';
import {
  CONTACT_REASON_VALUES,
  CONTACT_STATUS,
  CONTACT_STATUS_VALUES,
  CONTACT_SOURCE,
  CONTACT_SOURCE_VALUES,
  MAX_NAME_LENGTH,
  MAX_COMPANY_LENGTH,
  MAX_ACTIVITY_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_URL_LENGTH,
} from '../utils/contactConstants.js';

/**
 * Demande de contact déposée depuis la vitrine.
 *
 * ═══ C'EST LA SEULE COPIE DU MESSAGE ═════════════════════════════════════════
 *
 * Le `DomainEvent` n'en porte pas (il ne transporte que de quoi router l'action),
 * `EmailDelivery` n'en porte pas (le journal ne conserve pas le HTML rendu). Le
 * contenu du message n'existe donc QU'ICI. C'est voulu : une donnée personnelle
 * doit avoir un seul domicile, celui où l'on pense à aller la chercher le jour
 * d'une demande d'effacement.
 *
 * ═══ CE QUI N'EST PAS COLLECTÉ ═══════════════════════════════════════════════
 *
 * Pas d'IP, pas de cookie, pas de jeton, pas d'empreinte de navigateur, pas
 * d'en-têtes, pas de payload brut. Un formulaire de contact n'en a besoin pour
 * rien : ni pour répondre au visiteur, ni pour qualifier sa demande.
 *
 * L'anti-abus n'en a pas besoin non plus — il travaille sur le geste (honeypot,
 * délai de saisie) et sur un compteur en mémoire, pas sur l'identification du
 * visiteur. Collecter une IP « au cas où » créerait une donnée à protéger, à
 * documenter et à purger, en échange de rien.
 *
 * `metadataSafe` est volontairement pauvre : une FAMILLE de navigateur
 * (« Chrome ») et une locale, rien qui identifie. La chaîne User-Agent complète
 * est un quasi-identifiant : elle n'est jamais stockée.
 */

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: MAX_NAME_LENGTH },
    /** Normalisée en minuscules : c'est elle qui sert à la recherche et au regroupement. */
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: MAX_EMAIL_LENGTH },
    phone: { type: String, default: '', trim: true, maxlength: MAX_PHONE_LENGTH },
  },
  { _id: false }
);

const metadataSchema = new mongoose.Schema(
  {
    /** « Chrome », « Firefox »… JAMAIS la chaîne User-Agent complète. */
    userAgentFamily: { type: String, default: '', maxlength: 32 },
    locale: { type: String, default: '', maxlength: 16 },
  },
  { _id: false }
);

const contactSubmissionSchema = new mongoose.Schema(
  {
    /** Identifiant PUBLIC, non devinable. C'est lui qui circule dans les URL. */
    submissionId: { type: String, required: true, unique: true },

    /**
     * Clé d'idempotence fournie par le CLIENT.
     *
     * Protège du double envoi accidentel (double clic, retry réseau, retour
     * arrière). Voir l'index partiel plus bas.
     */
    clientSubmissionId: { type: String, default: null },

    /**
     * Entreprise concernée. Le dépôt est mono-entreprise (singleton `Company`) :
     * ce champ n'a donc qu'une valeur possible aujourd'hui. Il est renseigné
     * quand même — le jour où le produit devient multi-entreprises, une demande
     * sans rattachement serait irrécupérable, alors qu'un champ inutile ne coûte
     * rien.
     */
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },

    source: { type: String, enum: CONTACT_SOURCE_VALUES, default: CONTACT_SOURCE.PUBLIC_WEBSITE },

    contact: { type: contactSchema, required: true },

    /** CODE du motif, jamais son libellé (cf. contactConstants). */
    /**
     * L'ENTREPRISE QUI SE PRÉSENTE — obligatoire, et c'est le sujet même.
     *
     * L.Y ne conçoit pas pour des particuliers : une demande sans entreprise
     * est soit une erreur de saisie, soit hors sujet. L'exiger ici évite les
     * deux, et donne à la liste du Manager sa colonne la plus utile.
     */
    companyName: { type: String, required: true, trim: true, maxlength: MAX_COMPANY_LENGTH },
    /** Son métier, en quelques mots. Facultatif : le projet le dira souvent. */
    activity: { type: String, default: '', trim: true, maxlength: MAX_ACTIVITY_LENGTH },

    reason: { type: String, enum: CONTACT_REASON_VALUES, required: true },
    /** TEXTE BRUT. Jamais du HTML : l'échappement est l'affaire du renderer. */
    message: { type: String, required: true, maxlength: MAX_MESSAGE_LENGTH },

    pageUrl: { type: String, default: '', maxlength: MAX_URL_LENGTH },
    referrerUrl: { type: String, default: '', maxlength: MAX_URL_LENGTH },

    status: { type: String, enum: CONTACT_STATUS_VALUES, default: CONTACT_STATUS.NEW },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    metadataSafe: { type: metadataSchema, default: () => ({}) },

    /**
     * Signaux anti-abus relevés à la soumission (HONEYPOT, TOO_FAST…). La demande
     * a été ACCEPTÉE malgré eux (un signal isolé n'est pas un rejet) : c'est une
     * TRACE pour le DEV, jamais un motif affiché au commerçant. Une demande
     * légitime ne doit plus jamais apparaître « rejetée » à cause d'un autofill.
     */
    antiAbuseSignals: { type: [String], default: [] },

    submittedAt: { type: Date, required: true, default: Date.now },
    /** Première ouverture par un humain. Renseigné UNE fois, jamais réécrit. */
    firstViewedAt: { type: Date, default: null },
    /** Effacé si la demande quitte RESOLVED : une date de résolution périmée mentirait. */
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * IDEMPOTENCE — index PARTIEL, pas `sparse`.
 *
 * `sparse` ignore les documents dont le champ est ABSENT, mais pas ceux où il
 * vaut `null`. Or le schéma pose `default: null` : une seconde soumission sans
 * `clientSubmissionId` violerait un index sparse unique. `$type: 'string'` ne
 * contraint que les vraies clés. Même raisonnement que
 * `EmailDelivery.actionExecutionId`.
 *
 * C'est MongoDB qui tranche, pas une vérification applicative : deux clics
 * simultanés produisent deux requêtes concurrentes, et une lecture suivie d'une
 * écriture perdrait la course.
 */
contactSubmissionSchema.index(
  { clientSubmissionId: 1 },
  { unique: true, partialFilterExpression: { clientSubmissionId: { $type: 'string' } } }
);

/** Liste du Manager : filtre par statut, tri par date décroissante. */
contactSubmissionSchema.index({ status: 1, submittedAt: -1 });
/** Liste sans filtre + pagination par curseur. */
contactSubmissionSchema.index({ submittedAt: -1 });
/** Regrouper les demandes d'une même personne. */
contactSubmissionSchema.index({ 'contact.email': 1, submittedAt: -1 });
/** Filtre par motif. */
contactSubmissionSchema.index({ reason: 1, submittedAt: -1 });
// La recherche du Manager porte aussi sur l'entreprise — c'est par là qu'on
// retrouve une demande six semaines plus tard, pas par le nom du signataire.
contactSubmissionSchema.index({ companyName: 1, submittedAt: -1 });

export const ContactSubmission = mongoose.model('ContactSubmission', contactSubmissionSchema);
export default ContactSubmission;
