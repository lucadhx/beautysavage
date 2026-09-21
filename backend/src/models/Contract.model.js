import mongoose from 'mongoose';
import { notifyEntitySaved } from '../utils/syncNotifier.js';
import {
  CONTRACT_STATUS_VALUES,
  CONTRACT_STATUS,
  SIGNER_ROLE_VALUES,
  LAUNCH_FEE_STATUS,
  LAUNCH_FEE_STATUS_VALUES,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_STATUS_VALUES,
  SIGNATURE_STATUS,
  SIGNATURE_STATUS_VALUES,
  DEFAULT_TAX_RATE,
  CURRENCY,
  SUBSCRIPTION_INTERVAL,
  SUBSCRIPTION_INTERVAL_VALUES,
  SUBSCRIPTION_RECURRENCE_UNIT_VALUES,
  DEFAULT_SUBSCRIPTION_RECURRENCE,
  SIGNATURE_REQUIREMENT,
  SIGNATURE_REQUIREMENT_VALUES,
  MAX_PAYMENT_GRACE_DAYS,
} from '../utils/contractConstants.js';

/**
 * Contrat — pilote l'activation commerciale du site. Machine à états explicite
 * (voir services/contractStateMachine.js). Tous les montants sont en CENTIMES.
 */

// Ligne tarifaire (frais de lancement ou abonnement) — montants en centimes.
const pricingLineSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amountExcludingTax: { type: Number, default: 0, min: 0 }, // HT, centimes
    taxRate: { type: Number, default: DEFAULT_TAX_RATE, min: 0 }, // %
    taxAmount: { type: Number, default: 0, min: 0 }, // centimes
    amountIncludingTax: { type: Number, default: 0, min: 0 }, // TTC, centimes
    currency: { type: String, default: CURRENCY },
  },
  { _id: false }
);

/**
 * LA RÉCURRENCE CONTRACTUELLE — « tous les <interval> <unit> ».
 *
 * ══ DEUX CHAMPS, PARCE QU'UNE PÉRIODICITÉ EN COMPTE DEUX ════════════════════
 *
 * `MONTH`/`YEAR` seuls n'exprimaient que deux offres. Un trimestriel ou un
 * triennal n'était pas « une option manquante » : il était INEXPRIMABLE, et
 * chaque écran avait fini par coder en dur le binaire mensuel/annuel.
 *
 * ══ CE QUE `interval` N'EST PAS ═════════════════════════════════════════════
 *
 * Ce n'est pas une durée, ni un nombre de jours : c'est un NOMBRE DE PAS de
 * l'unité. `3 + MONTH` se lit « tous les trois mois », et le montant de la
 * ligne est ce qui est débité à CHACUN de ces rendez-vous — jamais un prix
 * mensuel à multiplier. Voir `utils/subscriptionRecurrence.js`.
 */
const subscriptionRecurrenceSchema = new mongoose.Schema(
  {
    unit: {
      type: String,
      enum: SUBSCRIPTION_RECURRENCE_UNIT_VALUES,
      default: DEFAULT_SUBSCRIPTION_RECURRENCE.unit,
    },
    // Le plafond dépend de l'unité (Stripe borne une période à trois ans) : il
    // se fait respecter à la SAISIE, `normalizeSubscriptionRecurrence`. Le
    // modèle ne garantit ici que l'invariant absolu — un entier au moins égal
    // à 1, jamais 0 ni négatif.
    interval: {
      type: Number,
      default: DEFAULT_SUBSCRIPTION_RECURRENCE.interval,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "L'intervalle de récurrence doit être un entier.",
      },
    },
  },
  { _id: false }
);

const subscriptionLineSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amountExcludingTax: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: DEFAULT_TAX_RATE, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    amountIncludingTax: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: CURRENCY },
    /**
     * LA SOURCE DE VÉRITÉ de la périodicité. Tout le code métier la lit par
     * `recurrenceOf()`, jamais directement.
     *
     * ══ AUCUN DÉFAUT ICI, ET C'EST LE POINT DÉLICAT DU LOT ═════════════════
     *
     * Un `default` aurait été le réflexe — et il aurait effacé le parc. Mongoose
     * applique les défauts aux chemins ABSENTS au chargement du document : un
     * contrat annuel d'avant ce lot, qui ne porte que `interval: 'YEAR'`, se
     * serait présenté avec un `recurrence` fabriqué à « tous les 1 mois ». Or
     * `recurrenceOf` fait précisément confiance à `recurrence` quand il existe :
     * le défaut aurait donc BATTU la donnée héritée, et un abonnement annuel
     * serait devenu mensuel à la simple lecture — sans écriture, sans trace.
     *
     * `undefined` se lit « pas encore migré », et laisse la lecture retomber sur
     * l'héritage. La valeur n'apparaît qu'écrite : par le backfill, ou par une
     * saisie. Voir `utils/subscriptionRecurrence.js`.
     */
    recurrence: { type: subscriptionRecurrenceSchema, default: undefined },
    /**
     * ══ HÉRITAGE — CONSERVÉ, PLUS JAMAIS CONSULTÉ ═════════════════════════
     *
     * L'UNITÉ seule, sous son ancien nom. Le champ reste déclaré pour deux
     * raisons, et aucune n'est le confort :
     *
     *   · le BACKFILL doit pouvoir le LIRE. Mongoose n'expose pas les chemins
     *     absents du schéma : le retirer d'abord rendrait invisible la donnée
     *     même qu'il faut migrer, et le parc historique perdrait sa
     *     périodicité en silence ;
     *   · un Panel non encore redéployé le lit sur le fil. Il continue donc
     *     d'être ÉCRIT, en miroir dérivé de `recurrence.unit` — jamais
     *     l'inverse.
     *
     * Sa suppression est conditionnée, et la condition est écrite : une fois
     * le Panel du parc à jour et le backfill passé partout, ce champ et son
     * miroir d'écriture disparaissent d'un bloc.
     */
    interval: { type: String, enum: SUBSCRIPTION_INTERVAL_VALUES, default: SUBSCRIPTION_INTERVAL },
  },
  { _id: false }
);

// Présentation d'un signataire dans l'éditeur/aperçu de zones, et rattachement
// à son identifiant Yousign. L'identité CONTRACTUELLE, elle, vit dans
// `signersSnapshot` (seule source de vérité juridique) — voir plus bas.
const signerSchema = new mongoose.Schema(
  {
    role: { type: String, enum: SIGNER_ROLE_VALUES, required: true },
    displayName: { type: String, default: '' },
    companyName: { type: String, default: '' },
    logo: { type: String, default: '' },
    email: { type: String, default: '' },
    color: { type: String, default: '#2563eb' }, // couleur d'édition (éditeur/preview)
    /*
     * `yousignSignerId` A ÉTÉ RETIRÉ DU SCHÉMA.
     *
     * Aucun code ne l'écrivait ni ne le lisait — vérifié sur les deux dépôts.
     * C'était un vestige d'une première version où l'identifiant du signataire
     * chez le fournisseur était rangé dans la CONFIGURATION du contrat ; il vit
     * depuis dans le bloc de signature (`devSignerId` / `clientSignerId`), qui
     * est l'endroit où il décrit un FAIT plutôt qu'un réglage.
     *
     * Les documents existants gardent la valeur en base : la retirer du schéma
     * cesse seulement de la faire remonter. Rien ne la cherchait.
     */
  },
  { _id: false }
);

// Identité d'une partie, FIGÉE à la validation du contrat.
const signerSnapshotSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    email: { type: String, default: '' },
    companyName: { type: String, default: '' },
  },
  { _id: false }
);

// Zone de signature — coordonnées NORMALISÉES en ratios (indépendantes du zoom
// et des dimensions d'écran). La conversion vers Yousign est centralisée/testée.
const zoneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // identifiant stable côté éditeur
    name: { type: String, default: '' },
    signerRole: { type: String, enum: SIGNER_ROLE_VALUES, required: true },
    page: { type: Number, required: true, min: 1 }, // 1-indexé
    xRatio: { type: Number, required: true, min: 0, max: 1 },
    yRatio: { type: Number, required: true, min: 0, max: 1 },
    widthRatio: { type: Number, required: true, min: 0, max: 1 },
    heightRatio: { type: Number, required: true, min: 0, max: 1 },
    type: { type: String, default: 'SIGNATURE' },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    originalPdfUrl: { type: String, default: '' },
    originalFilename: { type: String, default: '' }, // nom sur disque (non devinable)
    originalChecksum: { type: String, default: '' }, // sha256
    signedPdfUrl: { type: String, default: '' },
    signedFilename: { type: String, default: '' },
    signedChecksum: { type: String, default: '' },
    signedFetchedAt: { type: Date, default: null },
    /**
     * LA PREUVE D'AUDIT — une troisième pièce, pas une variante du contrat.
     *
     * Elle atteste QUI a signé, QUAND et DEPUIS OÙ. Le fournisseur la publie
     * séparément ; on la garde séparée. Fusionner les deux rendrait impossible
     * de produire l'engagement sans sa preuve, et l'opération est irréversible.
     *
     * Les contrats signés chez le fournisseur historique n'en ont pas : ces
     * champs restent vides, et c'est un fait, pas un défaut.
     */
    certificateFilename: { type: String, default: '' },
    certificateChecksum: { type: String, default: '' },
    /** Rendu par le fournisseur — un fichier archivé sans son type se relit mal. */
    certificateContentType: { type: String, default: '' },
    certificateFetchedAt: { type: Date, default: null },
    pageCount: { type: Number, default: 0 },
    // Dimensions PDF (points = pixels @72dpi) par page : base de conversion
    // des zones (ratios) vers les coordonnées absolues Yousign.
    pageSizes: {
      type: [
        new mongoose.Schema(
          { page: Number, width: Number, height: Number },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    reference: { type: String, default: '' }, // référence lisible (ex. CTR-2026-0001)
    name: { type: String, default: '' }, // libellé humain (ex. « Contrat annuel 2026 »)
    status: {
      type: String,
      enum: CONTRACT_STATUS_VALUES,
      default: CONTRACT_STATUS.DRAFT,
      index: true,
    },
    archived: { type: Boolean, default: false }, // soft-delete (contrats à valeur légale)
    archivedAt: { type: Date, default: null },

    document: { type: documentSchema, default: () => ({}) },

    signatureConfiguration: {
      version: { type: Number, default: 0 }, // numéro de la version COURANTE (la dernière)
      locked: { type: Boolean, default: false },
      signers: { type: [signerSchema], default: [] },
      zones: { type: [zoneSchema], default: [] },
      // Historique : CHAQUE sauvegarde crée une version (snapshot des zones). Le
      // contrat conserve la dernière dans `zones`/`version` ; l'historique permet
      // l'audit et un éventuel retour arrière ultérieur.
      versions: {
        type: [
          new mongoose.Schema(
            {
              version: Number,
              zones: { type: [zoneSchema], default: [] },
              savedAt: { type: Date, default: Date.now },
              savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    /**
     * Identité des deux parties, COPIÉE depuis Company.signer / DevCompany.signer
     * au moment de la validation. À partir de là, c'est la SEULE source de vérité :
     * Yousign en dérive ses signataires, et une modification ultérieure d'une fiche
     * Entreprise n'a aucun effet rétroactif sur les contrats déjà validés.
     *
     * `null` sur les deux parties = contrat en DRAFT (jamais validé), ou contrat
     * validé AVANT l'introduction des signataires configurables (cf. migration
     * `migrateCompanySigners` dans config/bootstrap.js).
     */
    signersSnapshot: {
      developer: { type: signerSnapshotSchema, default: null },
      client: { type: signerSnapshotSchema, default: null },
    },

    pricing: {
      launchFee: { type: pricingLineSchema, default: () => ({}) },
      subscription: { type: subscriptionLineSchema, default: () => ({}) },
    },
    taxRate: { type: Number, default: DEFAULT_TAX_RATE }, // taux par défaut du contrat

    /**
     * DÉLAI DE GRÂCE EN CAS D'IMPAYÉ D'ABONNEMENT, EN JOURS (L10.6B-1).
     *
     * ══ POURQUOI SUR LE CONTRAT ═════════════════════════════════════════════
     *
     * Parce que c'est un ENGAGEMENT COMMERCIAL, négocié avec ce client-là. Une
     * variable d'environnement l'aurait imposé à tout le parc, et
     * `CONTRACT_PAYMENT_GRACE_DAYS` — qui existait justement ainsi — n'a jamais
     * été lu par personne : un réglage global que nul ne consulte finit par
     * mentir à tout le monde.
     *
     * ══ POURQUOI `null` PAR DÉFAUT, ET SURTOUT PAS UN NOMBRE ════════════════
     *
     * Aucun contrat existant ne porte cette politique, et il n'existe AUCUNE
     * valeur métier dont on puisse la déduire. Inscrire 7 serait inventer une
     * clémence que personne n'a accordée ; inscrire 0 fermerait le site au
     * premier prélèvement refusé, ce que personne n'a décidé non plus.
     *
     * `null` se lit « politique non configurée », et le Panel en tire la seule
     * conséquence sûre : il OUVRE l'incident, le suit, l'affiche — et ne
     * suspend JAMAIS automatiquement. La fermeture reste alors une décision
     * humaine, ce qui est le bon comportement tant que personne n'a fixé de
     * règle.
     *
     * ══ CE QU'ELLE NE CONFIGURE PAS ═════════════════════════════════════════
     *
     * Les nouvelles tentatives de prélèvement. Stripe en est l'unique
     * ordonnanceur, et ce champ ne l'influence en rien.
     */
    /**
   * La borne haute existait au service et au validateur, pas au schéma : un
   * `updateOne` direct les contournait tous les deux. Elle est désormais
   * portée par la donnée elle-même.
   */
  paymentGraceDays: { type: Number, default: null, min: 0, max: MAX_PAYMENT_GRACE_DAYS },

    /**
     * LA SIGNATURE, SANS NOM DE FOURNISSEUR.
     *
     * ══ POURQUOI CE BLOC REMPLACE `yousign` ═══════════════════════════════
     *
     * Le parcours de signature ne dépend plus d'un fournisseur unique : les
     * nouvelles demandes partent chez OpenSign, les anciennes restent chez
     * Yousign, et un contrat signé doit rester relisible aussi longtemps qu'il
     * a une valeur juridique.
     *
     * Un champ nommé d'après un fournisseur rendait cette coexistence
     * indicible : `contract.yousign.signatureRequestId` valant un identifiant
     * OpenSign aurait été faux à la lecture, et faux dans chaque écran, chaque
     * export, chaque requête d'exploitation qui le mentionne.
     *
     * ══ `provider` EST LE CHAMP QUI PORTE TOUT LE RESTE ═══════════════════
     *
     * C'est lui qui dit à qui parler pour relire, annuler ou télécharger. Sans
     * lui, la seule stratégie serait d'essayer les fournisseurs l'un après
     * l'autre — c'est-à-dire d'envoyer l'identifiant d'un contrat chez un
     * fournisseur qui ne le connaît pas.
     *
     * ══ ET `yousign` RESTE LISIBLE ═══════════════════════════════════════
     *
     * Il n'est PLUS ÉCRIT. Il demeure au schéma pour que les contrats
     * antérieurs à la migration se relisent sans conversion, et pour que la
     * migration elle-même soit vérifiable après coup.
     */
    signature: {
      /** `OPENSIGN` | `YOUSIGN` — jamais deviné, jamais nul sur une demande ouverte. */
      provider: { type: String, default: null },
      requestId: { type: String, default: null },
      documentId: { type: String, default: null },
      devSignerId: { type: String, default: null },
      clientSignerId: { type: String, default: null },
      status: { type: String, enum: SIGNATURE_STATUS_VALUES, default: SIGNATURE_STATUS.NONE },
      devSignedAt: { type: Date, default: null },
      clientSignedAt: { type: Date, default: null },
      /**
       * LE FOURNISSEUR RAMÈNE-T-IL LE SIGNATAIRE ? — un FAIT constaté.
       *
       * Chez Yousign, un abonnement en Trial refusait les redirections, et
       * l'écran devait alors dire au signataire de revenir de lui-même.
       * OpenSign les respecte toujours — mais le champ reste un CONSTAT, pas un
       * réglage : le jour où un fournisseur refuse, l'écran doit pouvoir le
       * dire sans qu'on ait à redéployer.
       */
      autoReturn: { type: Boolean, default: false },
    },

    /**
     * HISTORIQUE — n'est plus écrit depuis la bascule vers `signature`.
     *
     * Conservé pour la lecture des contrats antérieurs et pour que la
     * migration reste vérifiable. Le supprimer effacerait la seule preuve que
     * les valeurs recopiées venaient bien de là.
     */
    yousign: {
      signatureRequestId: { type: String, default: null },
      documentId: { type: String, default: null },
      devSignerId: { type: String, default: null },
      adminSignerId: { type: String, default: null },
      status: { type: String, enum: SIGNATURE_STATUS_VALUES, default: SIGNATURE_STATUS.NONE },
      devSignedAt: { type: Date, default: null },
      adminSignedAt: { type: Date, default: null },
      // Yousign a-t-il ACCEPTÉ de ramener le signataire à la fin du flux ?
      // FAIT CONSTATÉ à la création de la demande, pas un réglage : un
      // abonnement en Trial refuse les redirections, et l'écran doit alors dire
      // au signataire de revenir de lui-même. Ni configuration, ni ENV.
      autoReturn: { type: Boolean, default: false },
    },

    stripe: {
      customerId: { type: String, default: null },
      // Projection LISIBLE des frais de lancement (source de vérité = journal Payment).
      launchFee: {
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
        checkoutSessionId: { type: String, default: null },
        paymentIntentId: { type: String, default: null },
        status: { type: String, enum: LAUNCH_FEE_STATUS_VALUES, default: LAUNCH_FEE_STATUS.PENDING },
        attempt: { type: Number, default: 0 },
        paidAt: { type: Date, default: null },
        lastError: { type: String, default: null },
      },
      // Projection LISIBLE de l'abonnement (source de vérité = Stripe + webhooks).
      subscription: {
        checkoutSessionId: { type: String, default: null },
        /**
         * TENTATIVE DE PAIEMENT — ce qui porte l'idempotence, et non le clic.
         *
         * Une même tentative doit toujours retomber sur la MÊME session Stripe,
         * quels que soient le nombre de clics et leur simultanéité : c'est ce
         * qui interdit deux souscriptions pour un contrat. Une tentative ne
         * s'ouvre que sur un fait constaté chez Stripe — session expirée, ou
         * abandonnée sans paiement. Jamais parce qu'on reclique.
         */
        attempt: { type: Number, default: 0 },
        subscriptionId: { type: String, default: null },
        productId: { type: String, default: null },
        priceId: { type: String, default: null },
        priceContractVersion: { type: Number, default: null },
    // Périodicité du Price créé — un changement de périodicité ou de montant
    // invalide le cache et crée un NOUVEAU Price (un Price Stripe est immuable).
    priceInterval: { type: String, default: null },
    priceAmount: { type: Number, default: null }, // version du contrat au moment du Price (immuable)
        latestInvoiceId: { type: String, default: null },
        status: {
          type: String,
          enum: SUBSCRIPTION_STATUS_VALUES,
          default: SUBSCRIPTION_STATUS.NONE,
        },
        currentPeriodStart: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },
        /**
         * QUAND L'ÉTAT PROJETÉ CI-DESSUS A ÉTÉ OBSERVÉ CHEZ LE FOURNISSEUR.
         *
         * ══ LE DÉFAUT QUE CE CHAMP FERME ════════════════════════════════════
         *
         * Stripe n'ordonne pas ses livraisons, et chaque événement transporte
         * un INSTANTANÉ de l'objet pris au moment où l'événement a été produit.
         * Le 21 août, l'ordre réel a été :
         *
         *     10:32:03.370  invoice.paid                  → ACTIVE
         *     10:32:03.563  customer.subscription.created → « incomplete »
         *
         * Le second est plus RÉCEMMENT ARRIVÉ mais décrit un état PLUS ANCIEN :
         * `customer.subscription.created` porte l'abonnement tel qu'il était à
         * sa naissance, c'est-à-dire avant le règlement de sa première facture.
         * Appliqué sans garde, il a fait régresser un abonnement payé vers
         * « à régler », et le parcours client s'est bloqué sur un écran
         * « Paiement à confirmer » qu'aucun webhook ultérieur ne venait défaire.
         *
         * ══ POURQUOI UNE DATE, ET NON UN COMPTEUR ═══════════════════════════
         *
         * Parce que la seule chose que le fournisseur nous donne pour ordonner
         * ses annonces est l'heure de l'ÉVÉNEMENT (`evt.created`). Un compteur
         * local compterait nos réceptions, c'est-à-dire exactement l'ordre
         * trompeur qu'on cherche à ignorer.
         *
         * Une lecture DIRECTE de l'abonnement (réconciliation) est par
         * construction la plus fraîche qui soit : elle est observée « maintenant ».
         *
         * `null` se lit « jamais observé » : la première annonce s'applique.
         */
        statusObservedAt: { type: Date, default: null },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        cancelledAt: { type: Date, default: null },
        endedAt: { type: Date, default: null },
        // Dernière erreur sûre (jamais de secret) : { code, message, at }.
        lastError: {
          code: { type: String, default: null },
          message: { type: String, default: null },
          at: { type: Date, default: null },
        },
      },
    },

    activation: {
      activatedAt: { type: Date, default: null },
      activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },

    // Environnement dans lequel le contrat a été créé (TEST/PROD) — un contrat
    // TEST ne doit jamais piloter la prod et inversement.
    /**
   * Une signature doit-elle être réalisée DANS SB Auto 06 ? Défaut REQUIRED :
   * les contrats antérieurs (sans ce champ) conservent exactement leur
   * comportement historique. NOT_REQUIRED = PDF déjà signé en externe ou
   * signature inutile — zéro Yousign, guideline sans étape signature.
   */
  signatureRequirement: {
    type: String,
    enum: SIGNATURE_REQUIREMENT_VALUES,
    default: SIGNATURE_REQUIREMENT.REQUIRED,
  },
  environment: { type: String, enum: ['TEST', 'PROD'], required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Recherche fréquente du contrat « vivant » (ACTIVE / CANCEL_AT_PERIOD_END).
contractSchema.index({ status: 1, archived: 1 });


// Le Panel projette le contrat COURANT : chaque mutation doit l'annoncer.
// Posé AVANT `mongoose.model()` — un hook ajouté après ne serait jamais rejoué.
// Les chemins modifiés sont capturés AVANT le save : Mongoose les efface
// ensuite, et `post` ne verrait plus rien changer.
contractSchema.pre('save', function captureChangedPaths() {
  this.$locals.syncChangedPaths = this.isNew ? ['*'] : this.modifiedPaths();
});
contractSchema.post('save', function announceSaved() {
  notifyEntitySaved('CONTRACT', this.$locals.syncChangedPaths ?? []);
});
contractSchema.post('deleteOne', { document: true, query: false }, function announceRemoved() {
  notifyEntitySaved('CONTRACT', ['*']);
});
/**
 * SUPPRESSION PAR REQUÊTE — le cas réel, et il était muet.
 *
 * Le hook ci-dessus ne se déclenche que sur `doc.deleteOne()`. Or les services
 * suppriment par REQUÊTE (`Contract.deleteOne({ _id })`), forme qui ne passe
 * par aucun document : rien n'était annoncé, et le Panel gardait à l'écran un
 * contrat qui n'existait plus — jusqu'au prochain redémarrage du projet.
 */
for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete']) {
  contractSchema.post(operation, { document: false, query: true }, function announceQueryRemoval() {
    notifyEntitySaved('CONTRACT', ['*']);
  });
}

export const Contract = mongoose.model('Contract', contractSchema);
export default Contract;
