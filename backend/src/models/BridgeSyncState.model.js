/**
 * OÙ EN EST CE PROJET DANS LE JOURNAL DU PANEL — persisté, enfin.
 *
 * ══ LA DETTE QUE CE MODÈLE FERME ════════════════════════════════════════════
 *
 * Le curseur de tirage (`pullCursor`) vivait dans une propriété d'instance du
 * pont. Il ne survivait donc à RIEN : ni un redémarrage du backend, ni une
 * release, ni un `pm2 restart`. À chaque démarrage, le projet repartait du
 * curseur reçu à l'appairage — c'est-à-dire, en pratique, de zéro.
 *
 * Conséquences, toutes réelles :
 *
 *   · le premier rattrapage après redémarrage rejouait TOUT le journal
 *     destiné à ce projet. Les protections d'idempotence (LWW sur
 *     `modifiedAt`, anti-rejeu par `writeId`) faisaient qu'il n'en résultait
 *     pas de corruption — mais le coût, lui, était réel, et il croissait avec
 *     l'âge du parc ;
 *   · le Panel ne pouvait rien dire de la consommation d'un projet, puisque
 *     ce que le projet déclarait repartait de zéro sans raison visible ;
 *   · une écriture appliquée puis « oubliée » au redémarrage réapparaissait
 *     dans les journaux comme une application neuve, ce qui rendait
 *     impossible de distinguer un rejeu d'une vraie livraison.
 *
 * ══ POURQUOI UN DOCUMENT, ET NON UN CHAMP SUR `BridgePairing` ═══════════════
 *
 * Parce que les deux n'ont ni le même cycle de vie ni la même sensibilité :
 *
 *   BridgePairing     une relation d'IDENTITÉ et de CONFIANCE. Elle contient
 *                     un SECRET chiffré, elle change rarement, et la toucher
 *                     est un acte lourd.
 *   BridgeSyncState   un ÉTAT DE PROGRESSION. Il change à chaque cycle, il ne
 *                     contient aucun secret, et l'écraser n'a aucune
 *                     conséquence de sécurité.
 *
 * Les fondre aurait fait écrire, plusieurs fois par minute, le document qui
 * porte le jeton du pont — multipliant sans raison les occasions de le perdre.
 *
 * ══ CE MODÈLE NE CONTIENT AUCUN SECRET, ET N'EN CONTIENDRA JAMAIS ═══════════
 *
 * Un curseur est une position opaque dans un journal ; les compteurs sont des
 * nombres ; les dates sont des dates. Rien ici ne se chiffre, parce que rien
 * ici n'a de valeur pour qui l'obtiendrait.
 *
 * Lu et écrit UNIQUEMENT par l'adaptateur de persistance du pont
 * (`services/panelBridge/persistence/`) — même règle que l'appairage, et
 * verrouillée par `bridge-conformity`.
 */
import mongoose from 'mongoose';

const bridgeSyncStateSchema = new mongoose.Schema(
  {
    /** Clé de singleton : il n'existe qu'UN état de consommation par instance. */
    key: { type: String, required: true, unique: true, default: 'SINGLETON' },

    /**
     * LE PROJET AUQUEL CE CURSEUR APPARTIENT.
     *
     * ══ POURQUOI IL EST STOCKÉ AVEC LE CURSEUR ══════════════════════════════
     *
     * Un curseur est une position dans le journal du Panel, et ce journal est
     * FILTRÉ par destinataire. Le conserver après un réappairage — donc après
     * un changement de `projectId` — ferait démarrer le nouveau projet au
     * milieu d'un journal qui ne le concernait pas : il sauterait toutes les
     * écritures antérieures à cette position, définitivement.
     *
     * C'est le seul cas où une remise à zéro est CORRECTE, et c'est ce champ
     * qui permet de le détecter sans rien deviner.
     */
    projectId: { type: String, default: null },

    /**
     * LE CURSEUR — opaque, stocké tel quel, renvoyé tel quel.
     *
     * Le contrat de pont est explicite : le projet ne l'interprète JAMAIS. Il
     * se trouve que c'est un numéro de séquence encodé, et c'est précisément
     * pour cela qu'il ne faut pas le décoder ici — le jour où le Panel changera
     * d'encodage, ce fichier n'aura pas à le savoir.
     *
     * `null` se lit « n'a encore rien consommé », jamais « a tout consommé ».
     */
    pullCursor: { type: String, default: null },

    /**
     * QUAND LE CURSEUR A RÉELLEMENT AVANCÉ.
     *
     * Distinct de `updatedAt` : ce dernier bouge à chaque écriture, même quand
     * le curseur n'a pas changé. C'est cette date-là, et elle seule, qui répond
     * à « le tirage progresse-t-il ? » — le signal que le Panel attend pour
     * distinguer « rien à recevoir » de « plus rien n'arrive ».
     */
    lastCursorAdvanceAt: { type: Date, default: null },

    /** La dernière écriture RÉELLEMENT appliquée. Voir ci-dessus : deux faits. */
    lastSuccessfulApplyAt: { type: Date, default: null },

    /**
     * COMPTEURS DE SANTÉ — remis à zéro par le succès, jamais par le temps.
     *
     * Ils comptent des ÉCHECS CONSÉCUTIFS, pas des échecs cumulés : un total
     * ne dirait rien (tout parc ancien finit par en avoir), une série dit
     * qu'une panne est EN COURS.
     */
    consecutivePullFailures: { type: Number, default: 0 },
    /**
     * Les écritures ÉCARTÉES parce qu'illisibles. C'est une PERTE définitive —
     * le curseur avance, le Panel ne les relivrera pas — d'où un compteur
     * distinct des échecs de transport, qui, eux, se rattrapent seuls.
     */
    consecutiveUnreadableChanges: { type: Number, default: 0 },

    /** Cumul des écritures appliquées. Informatif : il ne gouverne rien. */
    appliedTotal: { type: Number, default: 0 },

    /**
     * LES ÉCRITURES DÉJÀ APPLIQUÉES — une fenêtre BORNÉE, jamais un ensemble.
     *
     * ══ POURQUOI PAS TOUT L'HISTORIQUE ══════════════════════════════════════
     *
     * L'idempotence par `writeId` était assurée par un `Set` en mémoire qui
     * grandissait sans fin. Le persister tel quel aurait déplacé le problème :
     * un document Mongo contenant cinquante mille identifiants, relu et
     * réécrit à chaque cycle.
     *
     * ══ POURQUOI UNE FENÊTRE SUFFIT ════════════════════════════════════════
     *
     * Le curseur DURABLE rend l'ensemble inutile pour l'essentiel : une
     * écriture au-delà du curseur ne sera jamais reservie, donc jamais
     * réappliquée. Le seul rejeu possible est INTRA-PAGE — la même écriture
     * livrée en poussée immédiate puis retirée dans la page suivante, avant
     * que le curseur ne l'ait dépassée.
     *
     * Une fenêtre des derniers identifiants couvre exactement cette
     * fenêtre-là. Sa borne est celle d'une page de tirage, avec une marge :
     * au-delà, le curseur a nécessairement avancé.
     *
     * Ce qu'on accepte en échange : une écriture pourrait, dans un cas
     * extrême, être appliquée deux fois. Les applicateurs sont idempotents par
     * construction (LWW sur la version, `upsert` par identité) — c'est
     * précisément pourquoi cet ensemble n'a jamais été la vraie protection.
     */
    recentWriteIds: { type: [String], default: [] },

    /**
     * LA GÉNÉRATION — l'environnement au moment où ce curseur a été posé.
     *
     * Un projet redéployé de PROD vers TEST parle à un autre Panel, avec un
     * autre journal. Conserver le curseur ferait sauter des écritures. Même
     * raisonnement que `projectId`, pour un cas plus rare mais aussi net.
     */
    generation: { type: String, default: null },

    /**
     * ÉCHECS D'APPLICATION EN COURS — `{ [writeId]: n }`.
     *
     * Persisté, parce qu'un compteur en mémoire remettrait le plafond à zéro à
     * chaque redémarrage : une écriture toxique reprise indéfiniment
     * n'atteindrait jamais la lettre morte, et bloquerait le flux à vie.
     */
    /* ── LE BAIL DE CONSOMMATION — qui a le droit de tirer, en ce moment ─── */

    /**
     * QUI consomme. `hôte:pid:NONCE-DE-DÉMARRAGE`.
     *
     * Le nonce est la seule partie sérieuse : un processus redémarré peut
     * réutiliser un pid sur le même hôte, et se croirait alors titulaire d'un
     * bail qu'il a perdu en mourant.
     */
    leaseOwner: { type: String, default: null },
    leaseStartedAt: { type: Date, default: null },
    /**
     * Au-delà de cet instant, le titulaire est réputé MORT et un autre runtime
     * peut reprendre. C'est l'expiration qui débloque — jamais l'arrêt propre,
     * qu'un `kill -9` n'offre pas.
     */
    leaseExpiresAt: { type: Date, default: null },
    lastLeaseHeartbeatAt: { type: Date, default: null },

    applyFailures: { type: mongoose.Schema.Types.Mixed, default: {} },
    /**
     * L'ÉCRITURE QUI RETIENT LE CURSEUR — durable, parce qu'elle survit au
     * redémarrage qu'elle provoque souvent.
     *
     * Elle n'est PAS une lettre morte : une lettre morte est un renoncement,
     * celle-ci est une ATTENTE. Le curseur ne l'a pas dépassée, l'écriture est
     * toujours dans le journal du Panel, et la mise à niveau du runtime la fera
     * passer sans republication.
     *
     * Aucune charge utile : un type, une identité, un motif, des dates.
     */
    blockedChange: {
      type: {
        entityType: { type: String, default: null },
        entityId: { type: String, default: null },
        writeId: { type: String, default: null },
        reason: { type: String, default: null },
        contractVersion: { type: String, default: null },
        since: { type: String, default: null },
        lastSeenAt: { type: String, default: null },
        attempts: { type: Number, default: 0 },
      },
      default: null,
    },

    /**
     * LES ÉCRITURES GARÉES — celles qu'on a renoncé à appliquer, et qui le DISENT.
     *
     * Aucune charge utile : un type, un identifiant, un motif, une date. Assez
     * pour ouvrir une enquête, rien qui transforme la lettre morte en second
     * entrepôt de données personnelles.
     */
    deadLetters: {
      type: [{
        writeId: { type: String, default: null },
        entityType: { type: String, default: null },
        entityId: { type: String, default: null },
        reason: { type: String, default: null },
        attempts: { type: Number, default: 0 },
        parkedAt: { type: Date, default: null },
        /**
         * ══ UNE LETTRE MORTE RÉSOLUE RESTE UNE LETTRE MORTE ══════════════
         *
         * `PARKED` compte comme blocage actif ; `RESOLVED` ne compte plus, mais
         * ne disparaît pas. Supprimer l'entrée effacerait l'incident : on ne
         * saurait plus qu'une écriture avait été perdue, ni combien de temps.
         * Un journal qu'on nettoie n'est plus un journal.
         */
        status: { type: String, enum: ['PARKED', 'RESOLVED'], default: 'PARKED' },
        resolvedAt: { type: Date, default: null },
        /** Le `writeId` de la republication qui l'a débloquée — la causalité. */
        resolvedByWriteId: { type: String, default: null },
      }],
      default: [],
    },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const BridgeSyncState = mongoose.model('BridgeSyncState', bridgeSyncStateSchema);
export default BridgeSyncState;
