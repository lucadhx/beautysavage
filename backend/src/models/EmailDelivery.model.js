import mongoose from 'mongoose';
import { DELIVERY_STATUS, DELIVERY_STATUS_VALUES } from '../utils/emailTemplateConstants.js';

/**
 * Journal des envois d'e-mail — une ligne par (template, destinataire, tentative
 * logique).
 *
 * ═══ CE QUI N'EST PAS STOCKÉ, ET POURQUOI ════════════════════════════════════
 *
 * Ce journal est consulté pour diagnostiquer, pas pour relire des e-mails. Trois
 * décisions de minimisation, toutes assumées :
 *
 * ── 1. LE HTML FINAL N'EST JAMAIS PERSISTÉ ───────────────────────────────────
 *
 * Un e-mail rendu contient tout ce que le métier y a mis : nom, adresse,
 * téléphone, message libre d'un visiteur, montants. Le stocker créerait une
 * copie durable de données personnelles dans une collection technique — celle à
 * laquelle personne ne pense lors d'une demande d'effacement. Et il est
 * reconstructible : `templateId` + `templateVersion` donnent le contenu exact,
 * les valeurs viennent de l'événement.
 *
 * ── 2. LE SUJET EST STOCKÉ NON RENDU (avec ses placeholders) ─────────────────
 *
 * `subjectSnapshot` porte le sujet du TEMPLATE, pas celui reçu par le
 * destinataire :
 *
 *     stocké  : « Nouvelle demande de contact — {{contact.name}} »
 *     envoyé  : « Nouvelle demande de contact — Jean Dupont »
 *
 * Le sujet RENDU est une donnée personnelle (il porte souvent un nom, parfois un
 * montant). Le sujet NON RENDU n'en est pas une, et il répond pourtant à la seule
 * question qu'on se pose ici : « quel e-mail est parti ? ». Un hash aurait
 * répondu « lequel » sans dire « quoi » — illisible pour un humain qui débogue,
 * et sans bénéfice supplémentaire puisque le motif ne révèle rien.
 *
 * ── 3. LES ADRESSES SONT MASQUÉES ────────────────────────────────────────────
 *
 * `recipientEmailMasked` / `sender.emailMasked` : `j***@exemple.fr` (cf.
 * maskEmail). Le domaine reste lisible — c'est lui qui porte l'information de
 * délivrabilité (« tous les envois vers @orange.fr rebondissent »). La boîte, non.
 * L'IDENTITÉ exacte du destinataire n'est pas perdue pour autant : `recipientKey`
 * est une empreinte stable (cf. keyHash), suffisante pour dédupliquer et corréler
 * sans conserver l'adresse.
 *
 * ═══ SENT ≠ DELIVERED ════════════════════════════════════════════════════════
 *
 * `SENT` = Brevo a accepté et renvoyé un `messageId`. C'est le SEUL fait que
 * notre code puisse constater ; il ne dit rien de la boîte du destinataire.
 * `DELIVERED` et `BOUNCED` exigent un webhook Brevo (lot ultérieur) : tant qu'il
 * n'existe pas, aucun code n'écrit ces statuts. Voir docs/EMAIL_DELIVERY.md.
 */
const emailDeliverySchema = new mongoose.Schema(
  {
    /** Identifiant public, stable, non devinable. */
    deliveryId: { type: String, required: true, unique: true },

    /** Rattachement à l'événement métier. Absent pour un envoi de test DEV. */
    eventId: { type: String, default: null },
    /**
     * Exécution d'action à l'origine de l'envoi. Absent pour un envoi de test.
     * PORTE L'IDEMPOTENCE — voir l'index partiel plus bas.
     */
    actionExecutionId: { type: String, default: null },

    templateId: { type: String, required: true },
    /**
     * Version EXACTE utilisée — CELLE DU PANEL, jamais la nôtre (L11.1).
     *
     * ── CE QU'ELLE ÉTAIT, ET POURQUOI C'ÉTAIT UN MENSONGE ────────────────────
     *
     * Elle portait la version du document LOCAL de ce projet. Depuis que
     * l'autorité de contenu appartient au Panel (L8.4C), ce document n'est plus
     * expédié : le numéro décrivait donc un contenu que personne n'a reçu, avec
     * l'assurance d'un champ nommé « version exacte utilisée ».
     *
     * ── `0` SE LIT « PAS ENCORE SU », ET NON « VERSION ZÉRO » ────────────────
     *
     * La livraison est créée AVANT l'appel : à cet instant, seul le Panel saura
     * quelle version il rend. On écrit donc `0` à la création, puis la vérité à
     * l'acceptation. Une valeur provisoire tirée du local serait restée en cas
     * d'échec — et le suivi aurait affiché la version d'un contenu qui n'est
     * jamais parti, ce qui est exactement le défaut qu'on répare.
     */
    templateVersion: { type: Number, required: true, default: 0 },

    provider: { type: String, default: 'BREVO' },
    /**
     * Mode IntegratedAPI au moment de l'envoi. TEST et PROD peuvent porter deux
     * comptes Brevo distincts : sans cette trace, un envoi introuvable dans le
     * tableau de bord Brevo resterait inexplicable.
     */
    providerMode: { type: String, enum: ['TEST', 'PROD'], required: true },

    sender: {
      name: { type: String, default: '' },
      emailMasked: { type: String, default: '' },
    },

    /** Empreinte STABLE du destinataire (keyHash). Jamais l'adresse en clair. */
    recipientKey: { type: String, required: true },
    recipientEmailMasked: { type: String, default: '' },

    /** Sujet du TEMPLATE, placeholders inclus — jamais le sujet rendu (cf. §2). */
    subjectSnapshot: { type: String, default: '' },

    status: { type: String, enum: DELIVERY_STATUS_VALUES, default: DELIVERY_STATUS.PENDING },

    /** `messageId` renvoyé par Brevo. Notre seule poignée vers leur tableau de bord. */
    providerMessageId: { type: String, default: null },

    attempts: { type: Number, default: 0 },

    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
      retryable: { type: Boolean, default: false },
    },

    /** Brevo a accepté (≠ reçu). */
    sentAt: { type: Date, default: null },
    /** Écrit UNIQUEMENT par un webhook fournisseur. Jamais par le code d'envoi. */
    deliveredAt: { type: Date, default: null },

    /**
     * Dernier événement fournisseur appliqué — pour l'affichage en liste sans
     * relire la timeline. `type` est NORMALISÉ (jamais un code brut Brevo).
     */
    lastEventType: { type: String, default: null },
    lastEventAt: { type: Date, default: null },

    /**
     * ENGAGEMENT — historisé À PART du statut. Une ouverture/un clic ne change
     * JAMAIS le statut de livraison : ce ne sont pas des preuves de lecture ni
     * d'intention (blocage d'images, préchargement, proxy de confidentialité,
     * inspection de sécurité). Cf. docs/EMAIL_DELIVERY_TRACKING.md.
     */
    engagement: {
      firstOpenedAt: { type: Date, default: null },
      lastOpenedAt: { type: Date, default: null },
      openCount: { type: Number, default: 0 },
      firstClickedAt: { type: Date, default: null },
      lastClickedAt: { type: Date, default: null },
      clickCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/**
 * IDEMPOTENCE STRUCTURELLE — le cœur du « jamais deux fois le même e-mail ».
 *
 * Index PARTIEL et non `sparse` : `sparse` ignore les documents dont le champ est
 * ABSENT, mais pas ceux où il vaut `null`. Or le schéma pose `default: null` —
 * tous les envois de test porteraient donc `actionExecutionId: null` et le second
 * violerait un index sparse unique. `partialFilterExpression` sur `$type: 'string'`
 * ne contraint que les vraies exécutions, et laisse les tests libres.
 *
 * Conséquence VOULUE : si le processus meurt après l'appel à Brevo mais avant
 * d'avoir écrit `SENT`, la reprise retrouve la livraison existante au lieu d'en
 * créer une seconde. MongoDB tranche, pas une vérification applicative qui
 * perdrait la course.
 */
emailDeliverySchema.index(
  { actionExecutionId: 1 },
  { unique: true, partialFilterExpression: { actionExecutionId: { $type: 'string' } } }
);

/** Journal d'un événement. */
emailDeliverySchema.index({ eventId: 1 });
/** Consultation par template, le plus récent d'abord. */
emailDeliverySchema.index({ templateId: 1, createdAt: -1 });
/**
 * Rapprochement d'un webhook Brevo. La clé est (provider, providerMode,
 * providerMessageId) : un événement d'un mode ne rapproche JAMAIS une livraison
 * de l'autre mode (TEST et PROD = deux comptes Brevo distincts). Partiel pour ne
 * pas indexer les livraisons sans messageId (envois échoués/en attente).
 */
emailDeliverySchema.index(
  { provider: 1, providerMode: 1, providerMessageId: 1 },
  { partialFilterExpression: { providerMessageId: { $type: 'string' } } }
);
/** Consultation globale du suivi, le plus récent d'abord. */
emailDeliverySchema.index({ createdAt: -1 });

export const EmailDelivery = mongoose.model('EmailDelivery', emailDeliverySchema);
export default EmailDelivery;
