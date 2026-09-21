import mongoose from 'mongoose';
import { notifyEntitySaved } from '../utils/syncNotifier.js';
import { MEDIA_CATALOG } from '../utils/constants.js';
import { companySignerSchema } from './companySigner.schema.js';
import { mediaDescriptorSchema } from './mediaDescriptor.schema.js';

/**
 * A single contact/social medium.
 * The full catalog is preconfigured; the admin enables the ones they use.
 */
const mediaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // matches MEDIA_CATALOG key
    label: { type: String, required: true },
    icon: { type: String, required: true }, // Lucide icon name
    kind: { type: String, required: true }, // tel | email | url | handle | text
    value: { type: String, default: '' },
    enabled: { type: Boolean, default: false }, // "afficher" toggle
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    /**
     * ══ AUCUN CONTENU EN DÉFAUT — NI ICI, NI AILLEURS ═══════════════════════
     *
     * ── LE DÉFAUT QUE CE VIDE RÉPARE ────────────────────────────────────────
     *
     * `name` valait « Mon entreprise » et `homeIntro` portait un paragraphe
     * entier de copie « detailing automobile », hérité du projet d'origine de
     * la duplication.
     *
     * Un défaut de schéma n'est pas inerte : Mongoose le RÉAPPLIQUE à chaque
     * `save()` dont le champ est `undefined`. Un opérateur qui vide son texte
     * d'introduction, un import qui n'envoie pas la clé, une reprise qui
     * reconstruit le document — et la phrase du projet source revient, seule,
     * sans que personne n'ait rien demandé. C'est exactement le symptôme
     * observé : « la description revient à celle du seed initial ».
     *
     * Le contenu appartient au CLIENT. Le schéma décrit une FORME, pas un
     * texte. Une chaîne vide se voit à l'écran et s'appelle « à renseigner » ;
     * une phrase héritée se lit comme un choix qu'on aurait fait pour lui.
     *
     * ── CE QUI RESTE EN DÉFAUT, ET POURQUOI ─────────────────────────────────
     *
     * `media` garde son catalogue : ce sont des ENTRÉES VIDES et désactivées
     * (clé, libellé, icône, type). C'est de la structure — la liste des canaux
     * proposés à la saisie —, pas du contenu. Aucune valeur n'y est écrite.
     */
    name: { type: String, default: '' },
    tagline: { type: String, default: '' },
    // Texte d'introduction affiché sous la bannière d'accueil. Vide par défaut :
    // il s'écrit dans le Manager, il ne se sème pas.
    homeIntro: { type: String, default: '' },
    // Nombre de clients satisfaits affiché sur la vitrine ("X+ clients satisfaits").
    satisfiedClients: { type: Number, default: 0, min: 0 },

    /**
     * LES CHIFFRES CLÉS DE L'ACCUEIL — saisis, plus jamais devinés.
     *
     * ══ CE QU'ILS REMPLACENT ═════════════════════════════════════════════════
     *
     * L'accueil les DÉRIVAIT du contenu : le plus grand développé de piste, la
     * puissance maximale de la flotte, le meilleur chrono, le nombre de tracés.
     * Séduisant, et faux à trois titres :
     *
     *   · ce sont des chiffres qui BOUGENT. Un record du tour tombe, une fiche
     *     kart est corrigée, et l'accueil change sans que personne ne l'ait
     *     décidé ;
     *   · ils DISPARAISSENT en silence. Le jour où l'on a retiré d'une fiche
     *     kart une puissance qui n'était pas sourcée, deux tuiles de l'accueil
     *     se sont évanouies — sans erreur, sans trace, sans que la page ne le
     *     signale ;
     *   · les faits qu'un circuit met vraiment en avant — la surface de la
     *     piste, le nombre de stands couverts — ne se dérivent d'AUCUNE fiche.
     *     Ils n'étaient donc pas affichables.
     *
     * ══ TROIS AU MAXIMUM ═════════════════════════════════════════════════════
     *
     * La borne est dans le validateur, et elle est un choix : au-delà de trois,
     * une rangée de chiffres cesse d'être un argument pour devenir un tableau,
     * et plus personne n'en retient aucun.
     *
     * Vide, l'accueil n'affiche simplement pas la section — jamais une rangée à
     * moitié pleine.
     */
    keyFigures: {
      type: [new mongoose.Schema(
        {
          /** Le chiffre, TEL QU'IL S'AFFICHE — « 10 000 m² », « 2 », « 11 ». */
          value: { type: String, required: true, trim: true },
          /** Ce qu'il compte — « de piste », « tracés », « stands couverts ». */
          label: { type: String, default: '', trim: true },
          icon: { type: String, default: 'Flag' },
          order: { type: Number, default: 0 },
        },
        { _id: true },
      )],
      default: [],
    },
    // Contact/social media, preconfigured from the catalog.
    media: {
      type: [mediaSchema],
      default: () =>
        MEDIA_CATALOG.map((m, i) => ({
          key: m.key,
          label: m.label,
          icon: m.icon,
          kind: m.kind,
          value: '',
          enabled: false,
          order: i,
        })),
    },
    /**
     * CHEMINS DE STOCKAGE — repli historique, plus l'autorité.
     *
     * Ils restent lisibles pour les fiches antérieures au descripteur, et pour
     * les consommateurs qui n'attendent qu'une chaîne. Mais ce n'est plus eux
     * qui font foi : voir `logosMedia`.
     */
    logos: {
      header: { type: String, default: '' }, // logo affiché dans le header
      favicon: { type: String, default: '' }, // icône d'onglet
    },
    /**
     * LA SOURCE DE VÉRITÉ des médias de marque.
     *
     * ── POURQUOI UN DESCRIPTEUR ET PAS UNE URL ────────────────────────────
     * Une URL en fiche dépend du domaine courant : le jour d'un changement de
     * domaine, toutes les fiches pointent encore sur l'ancien. Et un projet
     * non encore déployé n'a aucune adresse publique — donc aucun média
     * enregistrable, c'est-à-dire aucune configuration possible avant la
     * première mise en ligne.
     *
     * L'identité d'un média est sa clé d'objet et son empreinte. L'adresse en
     * est DÉRIVÉE à la lecture, par `resolveProjectMediaUrl`.
     */
    logosMedia: {
      header: { type: mediaDescriptorSchema, default: null },
      favicon: { type: mediaDescriptorSchema, default: null },
    },
    // Image de fond de la section d'accueil (hero) de la vitrine.
    heroImage: { type: String, default: '' },
    heroImageMedia: { type: mediaDescriptorSchema, default: null },
    // Horaires d'ouverture + fuseau horaire (calcul « ouvert/fermé »).
    /**
     * ── SIGNATAIRE CONTRACTUEL — CHAMP GELÉ, CONSERVÉ EN BASE ────────────────
     *
     * ══ CE QU'IL FAISAIT ══════════════════════════════════════════════════
     *
     * Il portait la personne physique qui engage l'entreprise cliente, éditée
     * depuis l'écran « Informations » de ce Manager.
     *
     * ══ POURQUOI IL NE GOUVERNE PLUS RIEN ═════════════════════════════════
     *
     * Parce que le CLIENT choisissait ainsi l'identité qui signe le contrat que
     * son prestataire lui présente — et que deux sites d'un même client
     * pouvaient déclarer deux signataires pour une seule personne morale.
     *
     * L'autorité est désormais `ClientCompany.contractualSigner`, côté Panel,
     * publiée à ce projet par le pont (`CLIENT_COMPANY`). C'est la même bascule
     * que celle du signataire développeur, pour la même raison.
     *
     * ══ POURQUOI LE CHAMP RESTE DÉCLARÉ ═══════════════════════════════════
     *
     * Des fiches en production le portent, et des contrats déjà signés ont figé
     * leur instantané depuis lui. Le retirer du schéma effacerait la valeur au
     * premier enregistrement d'une fiche existante — une migration destructive
     * déguisée en nettoyage, pour un gain nul.
     *
     * Il reste donc INERTE : plus AUCUNE écriture ne le renseigne (le
     * contrôleur l'écarte), plus aucune lecture métier ne s'en sert, et aucun
     * écran ne le porte.
     */
    signer: { type: companySignerSchema, default: null },
    /**
     * Destinataires des notifications de NOUVELLE DEMANDE de contact.
     *
     * Champ MÉTIER explicite, distinct de l'expéditeur (`EmailConfiguration`) et
     * du contact public (`media`). Vide = fallback documenté sur l'adresse
     * support (cf. resolver CONTACT_NOTIFICATION_RECIPIENTS). Tableau dès
     * maintenant, même si l'UI commence avec une adresse : éviter une migration.
     */
    contactNotificationRecipients: { type: [String], default: [] },
  },
  { timestamps: true }
);


// Le Panel doit voir ce changement : on l'ANNONCE, sans rien savoir de lui.
// Le hook est posé AVANT `mongoose.model()` — après, il ne serait jamais rejoué.
// Les chemins modifiés sont capturés AVANT le save : Mongoose les efface
// ensuite, et `post` ne verrait plus rien changer.
companySchema.pre('save', function captureChangedPaths() {
  this.$locals.syncChangedPaths = this.isNew ? ['*'] : this.modifiedPaths();
});
companySchema.post('save', function announceSaved() {
  notifyEntitySaved('COMPANY', this.$locals.syncChangedPaths ?? []);
});

export const Company = mongoose.model('Company', companySchema);
export default Company;
