/**
 * OUTBOX PERSISTÉE — les écritures du projet en attente de livraison au Panel.
 *
 * ── POURQUOI CE MODÈLE EXISTE ───────────────────────────────────────────────
 * L'outbox vivait en mémoire (`this.outbox = []`). Tant qu'elle ne portait que
 * des diagnostics de test, sa perte au redémarrage n'avait aucune conséquence.
 * Dès lors qu'elle transporte de l'identité et du contrat, la perdre signifie
 * qu'une modification faite dans le Manager n'arrive JAMAIS au Panel, sans que
 * personne ne s'en aperçoive — et la sauvegarde locale, elle, a réussi.
 *
 * ── GARANTIE OFFERTE ────────────────────────────────────────────────────────
 * AU MOINS UNE FOIS. Une écriture peut être livrée deux fois (accusé perdu,
 * reprise après panne) : c'est le Panel qui déduplique sur `writeId`. Prétendre
 * à « exactement une fois » entre deux systèmes distincts serait faux.
 *
 * Le `writeId` est DÉTERMINISTE par entité et par version (voir
 * `panelOutbox.service.js`) : réémettre la même projection ne crée pas une
 * seconde entrée, et une relivraison est reconnue comme doublon côté Panel.
 */
import mongoose from 'mongoose';

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'PENDING', // à livrer
  SENDING: 'SENDING', // lot en vol — libéré si le processus meurt
  ACKNOWLEDGED: 'ACKNOWLEDGED', // accusé par le Panel (APPLIED/DUPLICATE/IGNORED)
  /**
   * REFUSÉ PAR LE PANEL — l'écriture n'a PAS été appliquée.
   *
   * ══ CE QUE CE STATUT NE VEUT PLUS DIRE ══════════════════════════════════
   *
   * Il valait « sortie de la file, dossier clos ». `acknowledgedAt` était posé
   * comme pour une réussite, l'index TTL effaçait l'entrée au bout de sept
   * jours, et plus rien au monde ne rejouait cette écriture. Une donnée métier
   * enregistrée par un utilisateur disparaissait donc en silence, et la seule
   * trace était une ligne de journal.
   *
   * C'est exactement ainsi qu'un logo refusé par un schéma trop étroit a figé
   * le nom d'une entreprise sur la fiche du Panel — indéfiniment, sans que
   * personne ne puisse le voir.
   *
   * Il veut désormais dire : « refusée, CONSERVÉE, visible, et réaffirmée plus
   * tard ». Un refus est presque toujours réparable — par un déploiement du
   * destinataire, une correction de contrat, un lot livré. Ce qui ne l'est
   * jamais, c'est un refus qu'on a jeté.
   */
  REJECTED: 'REJECTED',
});

export const OUTBOX_STATUS_VALUES = Object.values(OUTBOX_STATUS);

const panelOutboxEntrySchema = new mongoose.Schema(
  {
    // --- l'écriture, au format EXACT du contrat (SyncChange) ---------------
    writeId: { type: String, required: true, unique: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    deleted: { type: Boolean, default: false },
    modifiedAt: { type: String, required: true },
    emitter: { type: String, required: true, default: 'PROJECT' },

    // --- cycle de livraison ------------------------------------------------
    status: {
      type: String,
      enum: OUTBOX_STATUS_VALUES,
      default: OUTBOX_STATUS.PENDING,
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    // Backoff BORNÉ : une entrée n'est reprise qu'à partir de cette date.
    // Sans elle, un Panel durablement absent ferait tourner la reprise en
    // boucle serrée pour rien.
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },

    // --- LE REFUS, COMME INCIDENT DURABLE ----------------------------------
    /**
     * L'ENTRÉE D'OUTBOX **EST** LE DOSSIER D'INCIDENT.
     *
     * Un modèle « SyncIncident » séparé aurait dupliqué l'identité de
     * l'écriture (writeId, entité, tentatives, dates) et créé deux vérités à
     * réconcilier. Tout ce qu'un incident doit dire est déjà ici ou s'y ajoute
     * en quatre champs — et il se ferme tout seul le jour où l'écriture passe.
     */
    /** Catégorie de l'échec — voir `rejectionPolicy.js`. */
    failureClass: { type: String, default: null },
    /** Le code rendu par le destinataire (`ENTITY_PAYLOAD_INVALID`…). */
    lastErrorCode: { type: String, default: null },
    /** Depuis QUAND cette écriture est refusée. Jamais réécrit. */
    firstRejectedAt: { type: Date, default: null },
    /** Combien de refus distincts — différent du nombre de tentatives. */
    rejections: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

// Sélection de la file : les entrées dues, dans l'ordre où elles sont nées.
panelOutboxEntrySchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

/**
 * RÉTENTION — les entrées acquittées s'effacent d'elles-mêmes après 7 jours.
 * Assez pour diagnostiquer une livraison douteuse, trop peu pour que la
 * collection enfle. Aucun moteur d'archivage : un index TTL suffit.
 *
 * ── CE QUE CET INDEX NE DOIT JAMAIS EFFACER ────────────────────────────────
 * Une entrée REFUSÉE ne porte PAS `acknowledgedAt` : elle n'a été ni appliquée
 * ni reconnue, et l'effacer reviendrait à faire disparaître la seule preuve
 * qu'une donnée métier n'est jamais arrivée. Le champ n'est posé qu'à la
 * RÉSOLUTION — succès, ou reconnaissance idempotente. Un refus vit donc tant
 * qu'il n'est pas réparé, puis s'efface avec les autres.
 */
panelOutboxEntrySchema.index(
  { acknowledgedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 3600, partialFilterExpression: { acknowledgedAt: { $type: 'date' } } },
);

export const PanelOutboxEntry = mongoose.model('PanelOutboxEntry', panelOutboxEntrySchema);
export default PanelOutboxEntry;
