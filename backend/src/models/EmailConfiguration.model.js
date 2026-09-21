import mongoose from 'mongoose';
import { EMAIL_TEST_STATUS, EMAIL_TEST_STATUS_VALUES } from '../utils/emailConstants.js';

/**
 * Configuration e-mail de la plateforme (singleton, DEV uniquement).
 *
 * ─── DEUX DONNÉES MÉTIER, UN FAIT CONSTATÉ ───────────────────────────────────
 *
 * Par mode : un nom d'expéditeur, une adresse support, et l'issue du dernier
 * envoi de test. Rien d'autre. Aucun miroir de l'état Brevo (expéditeur vérifié,
 * domaine, DKIM, DNS) n'est stocké ici : ces états vivent chez Brevo, où ils sont
 * administrés, et les recopier créerait une seconde vérité à re-synchroniser en
 * permanence — pour une information dont le commerçant n'a aucun usage.
 *
 * ─── POURQUOI TOUT EST PAR MODE ──────────────────────────────────────────────
 *
 * La clé API Brevo appartient à UN compte. TEST et PROD portent deux clés, donc
 * potentiellement deux comptes distincts, deux expéditeurs autorisés, deux
 * quotas. Un test réussi en TEST ne prouve donc RIEN en PROD : l'état d'envoi
 * suit le mode, exactement comme `IntegratedApi.modes`.
 *
 * Aucun secret ici : la clé API vit dans `IntegratedApi` (chiffrée).
 */

const testStateSchema = new mongoose.Schema(
  {
    /**
     * Statut STOCKÉ à l'instant de l'envoi (ACCEPTED sur acceptation, FAILED sur
     * échec immédiat). L'issue FINALE — DELIVERED / REJECTED — vit dans
     * l'`EmailDelivery` pointée par `deliveryId` et n'est PAS recopiée ici : elle
     * est dérivée à la lecture. Un seul chemin d'écriture (le webhook met à jour
     * la livraison), une seule vérité.
     */
    status: {
      type: String,
      enum: EMAIL_TEST_STATUS_VALUES,
      default: EMAIL_TEST_STATUS.NOT_TESTED,
    },
    /** Identifiant interne du test — corrèle le test à sa livraison et à ses webhooks. */
    testExecutionId: { type: String, default: '' },
    /**
     * Lien vers l'`EmailDelivery` créée pour ce test. C'est ELLE que le pipeline
     * de webhooks existant fait transitionner (DELIVERED/HARD_BOUNCED/BLOCKED…) —
     * aucun second système. L'issue du test s'en déduit à la lecture.
     */
    deliveryId: { type: String, default: '' },
    /** `messageId` Brevo du dernier envoi accepté. Non sensible, DEV seulement. */
    providerMessageIdSafe: { type: String, default: '' },
    /** Destinataire du dernier test, MASQUÉ (l'écran DEV n'a pas besoin de la boîte). */
    recipientMasked: { type: String, default: '' },
    /**
     * Dernier destinataire saisi, EN CLAIR — pour préremplir la prochaine saisie.
     * C'est l'adresse de test du DEV, pas une donnée client ; la garder évite de
     * la retaper à chaque essai. Jamais utilisée pour un envoi automatique.
     */
    lastRecipient: { type: String, default: '', trim: true, lowercase: true },
    /** Brevo a accepté la requête (messageId reçu). */
    acceptedAt: { type: Date, default: null },
    /** Dernière tentative, quelle qu'en soit l'issue. */
    lastTestedAt: { type: Date, default: null },
    /**
     * Dernière LIVRAISON confirmée. Distinct de `lastTestedAt` : après un rejet,
     * savoir que la configuration a déjà livré un jour oriente le diagnostic.
     */
    lastSuccessAt: { type: Date, default: null },
    /** Dernier échec (immédiat ou rejet asynchrone). Deux dates, pas un journal. */
    lastFailureAt: { type: Date, default: null },
    /** Erreur SÛRE : code métier stable + message présentable. Jamais de payload. */
    lastErrorSafe: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },
  },
  { _id: false }
);

const modeSchema = new mongoose.Schema(
  {
    /**
     * ── `sender` A DISPARU EN R10.5B ──────────────────────────────────────────
     *
     * Il portait le From de CE projet. L'expéditeur du parc est désormais unique
     * et détenu par le Panel (`SystemConfiguration.email`) : un projet n'en
     * configure plus, n'en stocke plus et n'en lit plus.
     *
     * Le champ n'est plus déclaré, donc plus lu ni écrit. Les documents
     * antérieurs peuvent encore le porter en base — Mongo ne l'efface pas — mais
     * il est INERTE : aucune projection ne l'expose, aucun envoi ne le consulte.
     * Sa purge est un geste d'exploitation, pas une migration bloquante ; elle
     * n'est légitime qu'après la preuve cumulative exigée par le lot, et cette
     * preuve est établie ici (0 reader, 0 writer, 0 UI, 0 projection).
     */
    test: { type: testStateSchema, default: () => ({}) },
  },
  { _id: false }
);

const emailConfigurationSchema = new mongoose.Schema(
  {
    modes: {
      TEST: { type: modeSchema, default: () => ({}) },
      PROD: { type: modeSchema, default: () => ({}) },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const EmailConfiguration = mongoose.model('EmailConfiguration', emailConfigurationSchema);
export default EmailConfiguration;
