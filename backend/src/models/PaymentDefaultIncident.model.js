import mongoose from 'mongoose';

/**
 * INCIDENT DE PAIEMENT — la PROJECTION locale de ce que le Panel observe
 * (L10.6B-3).
 *
 * ══ CE N'EST PAS UNE SOURCE DE VÉRITÉ, ET CE N'EST PAS UN MOTEUR ════════════
 *
 * Rien ici n'est décidé par le projet. L'échec, les tentatives de Stripe, le
 * délai de grâce, l'échéance, la demande de suspension et sa confirmation :
 * tout vient du Panel par le canal de synchronisation, et tout y est REMPLACÉ à
 * chaque livraison. Le projet AFFICHE.
 *
 * ══ POURQUOI CETTE COLLECTION NE FERME AUCUN SITE ═══════════════════════════
 *
 * C'est la distinction qui porte tout le lot, et elle mérite d'être écrite là
 * où quelqu'un la lira avant de la casser :
 *
 *     un INCIDENT DE PAIEMENT   ≠   une CAUSE DE SUSPENSION
 *
 * L'incident existe dès le premier prélèvement refusé. La cause, elle,
 * n'apparaît qu'à l'expiration du délai de grâce — c'est précisément la
 * fonction de ce délai. Pendant toute la grâce :
 *
 *     incident   = présent
 *     cause      = inactive
 *     site       = accessible
 *
 * Les trois sont vraies ensemble. C'est pourquoi l'accessibilité du site NE SE
 * LIT PAS ici : elle vit dans `SiteStatus`, écrite par `reconcileSiteStatus()`,
 * qui seul connaît les AUTRES causes — maintenance technique, contrat éteint.
 *
 * `causeActive` est présent, et c'est une OBSERVATION : il permet à l'écran
 * d'expliquer pourquoi il montre — ou ne montre pas — une suspension. Il ne
 * permet à personne de conclure que le site est fermé. Un site peut fort bien
 * être inaccessible avec `causeActive: false` (maintenance), et accessible avec
 * `causeActive: true` n'arrive pas — mais c'est le moteur qui l'établit, pas ce
 * document.
 *
 * ══ POURQUOI UNE COLLECTION, ET NON UN CHAMP DE `SiteStatus` ════════════════
 *
 * Parce qu'un client peut connaître PLUSIEURS incidents. Deux périodes
 * d'abonnement impayées sont deux factures, donc deux incidents, et son
 * historique doit les distinguer. `SiteStatus` est un singleton avec un seul
 * sous-document de cause : il répond à « faut-il fermer ? », pas à « que s'est
 * -il passé, et quand ? ».
 *
 * ══ POURQUOI UNE PROJECTION LOCALE PLUTÔT QU'UN APPEL AU PANEL ══════════════
 *
 * Même raison que pour les prestations : l'espace de facturation doit s'afficher
 * quand le Panel est indisponible. Une lecture distante à chaque rendu aurait
 * fait disparaître l'incident au premier incident de l'autre côté.
 */
const paymentDefaultIncidentSchema = new mongoose.Schema(
  {
    /** L'identité que le Panel lui donne. Stable pour toute la vie de l'incident. */
    paymentDefaultId: { type: String, required: true, unique: true },

    /** Le contrat concerné. NE SERT JAMAIS D'IDENTITÉ — voir l'index plus bas. */
    contractId: { type: String, default: null },
    /**
     * La facture Stripe. Référence technique, réservée au volet « Détails » :
     * elle sert au support, pas à la lecture courante du client.
     */
    invoiceId: { type: String, default: null },

    /**
     * L'ABONNEMENT CONCERNÉ — ce que le règlement paie, pas une clé de jointure.
     *
     * Sert à NOMMER la prestation dans les relances (« votre abonnement »).
     * Sans lui, le message retombait sur « votre facture » : exact, et sans
     * valeur pour un client qui a plusieurs lignes chez nous.
     */
    subscriptionId: { type: String, default: null },

    /** OPEN | GRACE_EXPIRED | RESOLVED | CLOSED — décidé par le Panel. */
    /**
     * LES QUATRE ÉTATS QUE LE PANEL PEUT NOUS ENVOYER — déclarés, enfin.
     *
     * Le champ était un `String` libre : le statut est DÉCIDÉ par le Panel, et
     * on ne voulait pas qu'une valeur nouvelle fasse échouer une projection.
     * Mais l'absence d'énumération rendait une faute de frappe indiscernable
     * d'un état réel — elle s'écrivait, aucune transition ne la reconnaissait,
     * aucun message ne partait, aucune erreur n'était levée.
     *
     * L'énumération refuse l'écriture, ce qui est plus sûr que d'accepter une
     * valeur que personne ne sait lire : le pont journalise alors un
     * `APPLY_FAILED` nommé, et la republication corrigera. L'applicateur,
     * lui, garde sa garde de statut inconnu — les deux se complètent : ici on
     * refuse d'écrire n'importe quoi, là-bas on refuse d'en déduire n'importe
     * quoi.
     */
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'GRACE_EXPIRED', 'RESOLVED', 'CLOSED'],
    },

    // ── CE QUE STRIPE FAIT, ET QUE PERSONNE ICI NE PILOTE ─────────────────
    /**
     * OBSERVATIONS, RECOPIÉES. Stripe est l'unique ordonnanceur des tentatives
     * de prélèvement : ce projet n'en déclenche aucune, n'en programme aucune,
     * et n'expose aucun bouton qui le laisserait croire.
     *
     * L'écran dira « prochaine tentative prévue par Stripe », jamais « nous
     * retenterons ». `null` ne veut pas dire « aucune tentative prévue » : il
     * veut dire que Stripe ne l'a pas communiquée.
     */
    attemptCount: { type: Number, default: 0 },
    nextPaymentAttemptAt: { type: Date, default: null },
    firstFailedAt: { type: Date, default: null },
    lastFailedAt: { type: Date, default: null },

    // ── LA POLITIQUE, TELLE QUE LE PANEL L'A FIGÉE ────────────────────────
    /**
     * `null` ET `0` SONT DEUX DÉCISIONS OPPOSÉES, et le défaut est `null`.
     *
     *   null → aucune politique n'a été fixée. Le site ne fermera JAMAIS
     *          automatiquement pour cet incident.
     *   0    → aucune clémence. L'échéance tombe dès l'échec.
     *
     * Un `default: 0` aurait promis une fermeture automatique là où personne
     * n'a écrit de règle. C'est pour cela que le champ n'a pas de `min` non
     * plus : c'est une valeur reçue, pas une valeur validée ici.
     */
    graceDaysSnapshot: { type: Number, default: null },
    /** L'échéance, calculée UNE FOIS par le Panel. Jamais recalculée ici. */
    graceDeadlineAt: { type: Date, default: null },

    // ── CE QUI EST DÛ ─────────────────────────────────────────────────────
    amountDueCents: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    invoiceNumber: { type: String, default: null },
    /**
     * LA FACTURE DU CLIENT LUI APPARTIENT — des adresses hébergées par Stripe,
     * jamais une copie locale. Le document juridique appartient à qui l'a émis ;
     * en garder un double créerait une seconde vérité qui divergerait.
     */
    hostedInvoiceUrl: { type: String, default: null },
    invoicePdfUrl: { type: String, default: null },

    // ── DEMANDÉE, CONFIRMÉE, RETIRÉE — TROIS FAITS DISTINCTS ──────────────
    /**
     * `suspensionRequestedAt` dit « le Panel a RÉCLAMÉ la fermeture ».
     * `suspensionConfirmedAt` dit « elle a été APPLIQUÉE, et constatée ».
     *
     * Entre les deux, il y a un projet qui a pu être hors ligne. Afficher la
     * demande comme un fait ferait lire « site suspendu » à un client dont le
     * site répond encore parfaitement.
     */
    suspensionRequestedAt: { type: Date, default: null },
    suspensionConfirmedAt: { type: Date, default: null },
    /**
     * NOTRE cause a été retirée — ce qui n'est PAS « le site est rouvert ».
     * Une maintenance technique peut parfaitement subsister.
     */
    causeRemovalConfirmedAt: { type: Date, default: null },

    resolvedAt: { type: Date, default: null },
    /** Comment l'incident s'est terminé. Nommé par le Panel, jamais déduit. */
    resolution: { type: String, default: null },

    /**
     * LA CAUSE EST-ELLE APPLIQUÉE ? — observation, jamais autorité.
     *
     * Redondante avec `PAYMENT_DEFAULT_CAUSE.active`, et délibérément : les
     * deux viennent de la MÊME fonction côté Panel, si bien qu'aucune ne peut
     * dériver de l'autre. Celle-ci sert à EXPLIQUER un écran ; celle-là sert à
     * DÉCIDER d'un site. Seule la seconde atteint le moteur.
     */
    causeActive: { type: Boolean, default: false },
    /** Le motif exact, tel que le Panel le nomme. Jamais reformulé ici. */
    reason: { type: String, default: 'Défaut de paiement' },

    /**
     * L'HORLOGE DE LA SOURCE — celle du Panel, pas la nôtre.
     *
     * ══ POURQUOI ELLE EST PERSISTÉE ═══════════════════════════════════════
     *
     * Le pont dédoublonne par `writeId` : il reconnaît la MÊME livraison
     * rejouée. Il ne reconnaît pas une livraison PLUS ANCIENNE arrivée après
     * une plus récente — deux écritures distinctes, toutes deux légitimes,
     * livrées dans le désordre après un rattrapage.
     *
     * Sans cette date, la plus vieille gagnerait, et un incident résolu
     * repasserait « en échec » sous les yeux du client. L'applicateur la
     * compare et refuse de reculer.
     */
    sourceModifiedAt: { type: Date, default: null },
    /** Quand le projet a reçu cette version. Diagnostic de convergence. */
    receivedAt: { type: String, required: true },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

/**
 * L'ÉCRAN DE FACTURATION — « qu'est-ce qui cloche, et depuis quand ? ».
 *
 * Trié sur le premier échec : c'est la date qui ancre l'incident, et la seule
 * qui ne bouge pas quand Stripe retente.
 */
paymentDefaultIncidentSchema.index({ firstFailedAt: -1 }, { name: 'recent_first' });
/**
 * « Y a-t-il un incident EN COURS ? » — la question du bandeau.
 *
 * Sur `status`, jamais sur `contractId` : deux incidents successifs du même
 * contrat sont deux incidents, et les fusionner en effacerait un.
 */
paymentDefaultIncidentSchema.index({ status: 1, firstFailedAt: -1 }, { name: 'live_first' });

export const PaymentDefaultIncident = mongoose.model(
  'PaymentDefaultIncident',
  paymentDefaultIncidentSchema,
);
export default PaymentDefaultIncident;
