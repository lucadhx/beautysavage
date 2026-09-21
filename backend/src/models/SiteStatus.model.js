import mongoose from 'mongoose';
import { SITE_STATUS } from '../utils/constants.js';
import { notifyEntitySaved } from '../utils/syncNotifier.js';

/**
 * Statut global du site. Le champ `status` (ACTIVE/SUSPENDED) est DÉRIVÉ :
 *
 *   site accessible = AUCUNE suspension technique ET contrat honoré
 *   (contrat honoré = protection désactivée OU un contrat est actif/en fin de période)
 *
 * On distingue deux sources de suspension :
 *  - TECHNIQUE : levier manuel DEV (maintenance) — `technicalSuspension.active` ;
 *  - CONTRACTUELLE : aucun contrat vivant alors que la protection est activée.
 *
 * Lever une suspension technique ne réactive donc PAS un site dépourvu de
 * contrat actif : le statut est toujours recalculé par l'enforcement.
 */
/**
 * LA SUSPENSION MANUELLE — le levier humain, et sa mémoire (L10.6 FINAL).
 *
 * ══ POURQUOI ELLE S'APPELLE « TECHNIQUE » ET NON « MANUELLE » ═══════════════
 *
 * Parce que c'est la MÊME chose, et qu'inventer une quatrième cause pour la
 * renommer aurait ajouté une condition au moteur sans ajouter aucune décision.
 * Ce levier est déjà : déclenché par un humain, porteur d'un motif libre,
 * nominatif, daté, et retiré à la main. C'est la définition d'une suspension
 * manuelle ; « technique » en nomme le motif habituel, pas sa nature.
 *
 * Le renommer aurait par ailleurs migré un champ vivant sur toutes les
 * instances du parc, pour une différence de vocabulaire.
 *
 * ══ CE QUE LA REPRISE EFFAÇAIT, ET QU'ELLE N'EFFACE PLUS ═══════════════════
 *
 * Lever la suspension remettait ce sous-document à zéro : motif, auteur et
 * date disparaissaient. On ne pouvait donc plus répondre à « qui avait fermé
 * ce site, pourquoi, et qui l'a rouvert ? » — précisément les questions qu'on
 * pose six mois plus tard.
 *
 * L'état COURANT reste nettoyé — un motif qui traîne sur un site accessible se
 * lirait comme une fermeture en cours. La mémoire, elle, vit dans le journal
 * d'audit, qui n'a ni TTL ni plafond ; et les trois champs `lifted*` gardent la
 * dernière levée à portée d'écran, sans avoir à interroger le journal.
 */
const technicalSuspensionSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: String, default: '' }, // email du DEV
    /**
     * L'INTENTION DE PRÉVENIR, telle qu'elle a été exprimée à la suspension.
     *
     * Persistée parce qu'elle est une DÉCISION humaine, distincte de son
     * résultat : « on a voulu prévenir » et « le message est parti » sont deux
     * faits, et le second peut être faux alors que le premier reste vrai. Le
     * cahier des charges demande de pouvoir répondre à la question « la
     * notification a-t-elle été demandée ? » — pas seulement « a-t-elle
     * abouti ? ».
     */
    notifyAdminsRequested: { type: Boolean, default: false },

    /** ── LA DERNIÈRE LEVÉE — conservée après nettoyage de l'état courant ── */
    liftedAt: { type: Date, default: null },
    liftedBy: { type: String, default: '' },
  },
  { _id: false }
);

const siteStatusSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(SITE_STATUS),
      default: SITE_STATUS.ACTIVE,
    },
    // Cause effective de la suspension courante (dérivée).
    suspensionSource: {
      type: String,
      /**
       * L10.6 — `PAYMENT_DEFAULT` rejoint l'énumération de la cause DOMINANTE.
       * Elle n'est pas le stockage de la cause (voir `paymentDefault`), mais son
       * étiquette : ce que l'écran affiche quand c'est elle qui prime.
       */
      enum: ['NONE', 'TECHNICAL', 'CONTRACT', 'PAYMENT_DEFAULT'],
      default: 'NONE',
    },
    reason: { type: String, default: '' }, // motif affiché (dérivé)
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: String, default: '' },
    relatedContractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null },

    /**
     * L'INSTANTANÉ DES CAUSES ACTIVES (L10.6A) — écrit par le moteur, lu par
     * la projection. Ce n'est pas une source de vérité indépendante : c'est la
     * photographie de ce que `reconcileSiteStatus` vient de conclure, publiée
     * pour que le Panel n'ait rien à recalculer.
     */
    causes: {
      technical: { type: Boolean, default: false },
      contract: { type: Boolean, default: false },
      paymentDefault: { type: Boolean, default: false },
    },

    // Levier technique manuel (indépendant du contrat).
    technicalSuspension: { type: technicalSuspensionSchema, default: () => ({}) },

    /**
     * DÉFAUT DE PAIEMENT — la TROISIÈME cause, et elle est INDÉPENDANTE (L10.6).
     *
     * ══ POURQUOI UN CHAMP, ET NON UNE VALEUR DE `suspensionSource` ══════════
     *
     * `suspensionSource` n'est pas le stockage des causes : c'est l'ÉTIQUETTE
     * de la cause dominante, recalculée à chaque réconciliation. Y écrire
     * PAYMENT_DEFAULT aurait effacé TECHNICAL, et lever le défaut aurait
     * rouvert un site en maintenance.
     *
     * Les causes vivent donc chacune dans son champ, et l'accessibilité est
     * leur CONJONCTION. C'est ce qui permet à une maintenance de survivre à une
     * régularisation — et c'est déjà la façon dont `technicalSuspension` et la
     * protection contractuelle cohabitent depuis toujours.
     *
     * ══ QUI L'ÉCRIT ═══════════════════════════════════════════════════════
     *
     * Le PANEL, par le canal de synchronisation, et personne d'autre. Il est
     * l'autorité de la politique de grâce ; ce projet est l'autorité de
     * l'accessibilité. Aucun code local ne décide qu'un paiement manque.
     */
    paymentDefault: {
      active: { type: Boolean, default: false },
      /** Le motif exact exigé par le contrat de service. */
      reason: { type: String, default: '' },
      since: { type: Date, default: null },
      /** L'incident côté Panel — pour l'audit, jamais pour décider. */
      paymentDefaultId: { type: String, default: null },
      amountDueCents: { type: Number, default: 0 },
    },

    /**
     * PROTECTION CONTRACTUELLE — le contrat a-t-il le droit de suspendre ?
     *
     * ── CE QU'ELLE PILOTE, ET RIEN D'AUTRE ────────────────────────────────
     * Ce réglage n'autorise ni n'interdit l'accès au site : il dit seulement
     * si l'ABSENCE de contrat honoré constitue une cause de suspension. À
     * `false`, la cause CONTRACT ne peut plus naître ; toutes les autres
     * (technique aujourd'hui, d'autres demain) continuent d'agir exactement
     * comme avant. Le confondre avec un « site actif/inactif » rouvrirait un
     * site suspendu pour maintenance.
     *
     * ── POURQUOI `false` PAR DÉFAUT ───────────────────────────────────────
     * C'est le comportement historique, à l'identique. Le réglage a remplacé
     * un drapeau d'environnement (`CONTRACT_ENFORCEMENT_ENABLED`) qui valait
     * `false` dès qu'il n'était pas posé — et il ne l'était nulle part, pas
     * même dans le `.env` recopié vers les hôtes distants. Une fiche
     * antérieure à ce champ retombe donc sur `false` et ne change pas de
     * comportement : aucun site existant n'est suspendu par la migration.
     */
    contractProtectionEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/**
 * LE PANEL DOIT VOIR CE CHANGEMENT — on l'ANNONCE, sans rien savoir de lui.
 *
 * ══ LE MANQUE QUE CE HOOK COMBLE ════════════════════════════════════════════
 *
 * L'état du site était le seul état métier exposé au Panel qui ne voyageait
 * PAS. Il n'avait ni hook, ni projection, ni projecteur : le Panel l'obtenait
 * en interrogeant le projet EN DIRECT depuis l'écran, à chaque affichage de la
 * carte. Trois conséquences, toutes mauvaises :
 *
 *   · projet éteint → « état de la protection inconnu », alors que la dernière
 *     valeur connue aurait parfaitement fait l'affaire ;
 *   · rien n'était persisté, donc rien ne datait cette information ;
 *   · une commande du Panel (activer la protection) n'entraînait AUCUNE
 *     réémission : l'écran ne pouvait qu'afficher ce qu'il venait de demander,
 *     c'est-à-dire supposer le résultat au lieu de le constater.
 *
 * ══ POURQUOI SUR LE MODÈLE, ET NON DANS `reconcileSiteStatus` ═══════════════
 *
 * C'est la règle du dépôt : les hooks vivent dans les modèles, la DÉCISION
 * dans `syncTriggers`, l'envoi dans l'outbox. `reconcileSiteStatus` est
 * aujourd'hui le seul entonnoir d'écriture — mais « aujourd'hui » n'est pas une
 * garantie. Un `post('save')` couvre TOUS les appelants, présents et futurs,
 * sans qu'aucun service n'ait à penser au pont.
 *
 * `'*'` : cet état est un SNAPSHOT indivisible. Contrairement à `Company`, il
 * n'a pas de champs « publics » et « privés » à distinguer — tout ce qu'il
 * porte décrit l'accessibilité du site, et le Panel les affiche tous.
 */
siteStatusSchema.post('save', function announceSaved() {
  notifyEntitySaved('SITE_STATUS', ['*']);
});

export const SiteStatus = mongoose.model('SiteStatus', siteStatusSchema);
export default SiteStatus;
