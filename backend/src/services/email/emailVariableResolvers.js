import { CONSUMED_TEMPLATE_CODES } from '../../utils/projectEmailTemplateUsage.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';

/**
 * Registre des RÉSOLVEURS DE VARIABLES — qui fournit les VALEURS d'un template.
 *
 * ─── LA VALEUR VIENT DU MÉTIER, JAMAIS DU TEMPLATE ───────────────────────────
 *
 * Le registre de templates déclare QUELLES variables existent et de quel TYPE
 * elles sont. Il ne contient aucune valeur réelle. Un résolveur est la fonction
 * métier qui, pour un événement donné, produit ces valeurs — explicitement, clé
 * par clé.
 *
 * AUCUNE variable ne lit un objet arbitrairement. Il n'existe pas de
 * « {{contract.anything}} » qui irait chercher un champ dans un document Mongo :
 * un résolveur ÉCRIT chaque clé à la main. C'est verbeux, et c'est le but — un
 * accès générique exposerait un jour un champ que personne n'avait prévu de
 * publier (un identifiant Stripe, une adresse, un secret).
 *
 * ─── CE QUE CE LOT FAIT, ET NE FAIT PAS ──────────────────────────────────────
 *
 * Aucun résolveur MÉTIER n'est enregistré ici. Les valeurs réelles de contact et
 * de résiliation viendront avec les lots correspondants, quand les événements
 * seront branchés. Ce fichier fournit :
 *
 *  - l'interface d'enregistrement (`registerVariableResolver`), prête à l'emploi ;
 *  - les données de DÉMONSTRATION pour l'aperçu et l'envoi de test ;
 *  - un REFUS EXPLICITE quand un résolveur manque.
 *
 * Le refus explicite est le point important : sans lui, activer une action par
 * mégarde produirait un e-mail aux variables vides, parti pour de bon. Mieux vaut
 * une erreur franche qu'un e-mail vide chez un client.
 */

/**
 * Erreur de résolution. `code` est stable.
 *
 * ══ « JAMAIS » ET « PAS ENCORE » NE SE TRAITENT PAS PAREIL (L12) ════════════
 *
 * `retryable` vaut FAUX par défaut, et ce défaut est le bon : la quasi-totalité
 * des refus de résolution sont des erreurs de configuration — un contrat
 * supprimé, une URL de Manager non renseignée, une identité de prestataire non
 * publiée. Aucun délai d'attente ne les répare, et quatre tentatives espacées
 * ne feraient que retarder de vingt minutes un DEAD_LETTER inévitable.
 *
 * Il existe pourtant un cas où l'attente EST la réparation, et il est au cœur
 * du cycle de paiement : le fournisseur annonce l'encaissement AVANT d'avoir
 * fini d'émettre la facture. Le fait métier est vrai, le message est dû, et la
 * seule donnée qui manque arrivera dans quelques secondes. La refuser
 * définitivement priverait le client de sa confirmation pour une course de
 * trois secondes ; l'envoyer sans le lien lui donnerait un bouton mort.
 *
 * Un résolveur qui lève avec `retryable: true` demande donc explicitement à
 * être rejoué — et l'ordonnanceur d'actions le rejoue selon sa cadence normale
 * (30 s, 2 min, 10 min), puis abandonne. C'est une demande, jamais un défaut.
 */
export class EmailVariableResolverError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = 'EmailVariableResolverError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

/** @type {Map<string, (context: object) => Promise<object|Map>>} */
const RESOLVERS = new Map();

/**
 * Surcharges appliquées PAR-DESSUS les données d'exemple, pour l'aperçu et
 * l'envoi de test. Voir `demoVariables`.
 * @type {Map<string, (context: object) => Promise<object|Map>>}
 */
const DEMO_OVERRIDES = new Map();

/**
 * Enregistre le résolveur métier d'un template.
 *
 * Renvoie une fonction de restauration — indispensable aux tests, qui doivent
 * pouvoir retirer leur stub sans le laisser fuiter sur les suites suivantes.
 * Même contrat que `registerHandler` du dispatcher : le sens de dépendance va du
 * métier vers ce registre, jamais l'inverse.
 */
export function registerVariableResolver(templateId, resolver) {
  /**
   * LA GARDE PORTE SUR CE QUE CE PROJET CONSOMME — plus sur un registre local.
   *
   * Elle interrogeait `EMAIL_TEMPLATE_IDS`, c'est-à-dire le registre de modèles
   * du projet, supprimé avec ce lot. Le remplacer par une liste de codes
   * recopiée du Panel aurait recréé la duplication qu'on retire.
   *
   * Ce que cette garde doit attraper n'a d'ailleurs jamais été « ce code
   * existe-t-il chez le Panel ? » — le Panel le dit à l'envoi, mieux — mais
   * « ce projet appelle-t-il vraiment ce code ? ». Un résolveur enregistré pour
   * un code qu'aucune action ne déclenche est du code mort qui donne l'illusion
   * d'une couverture.
   */
  if (!CONSUMED_TEMPLATE_CODES.includes(templateId)) {
    throw new Error(
      `Impossible d'enregistrer un résolveur pour « ${templateId} » : ce projet ne déclare `
      + 'consommer aucun modèle de ce code. Branchez d’abord une action ou un consommateur direct.',
    );
  }
  const previous = RESOLVERS.get(templateId);
  RESOLVERS.set(templateId, resolver);
  return () => {
    if (previous) RESOLVERS.set(templateId, previous);
    else RESOLVERS.delete(templateId);
  };
}

/** Idem, pour les surcharges d'aperçu/test. */
/*
 * `registerDemoOverride` / `demoVariables` ONT ÉTÉ SUPPRIMÉS (L12.1).
 *
 * Ils alimentaient un aperçu et un envoi de test rendus LOCALEMENT, à partir
 * des exemples du registre local. Les deux passent désormais par le Panel, qui
 * possède le modèle et ses variables d'exemple.
 *
 * Les garder aurait maintenu deux jeux de valeurs pour un seul contrat : un
 * aperçu pouvait réussir avec les exemples locaux et l'envoi réel échouer, sans
 * que rien ne le laisse voir. C'est précisément l'écart que ce lot ferme.
 */

function toMap(value) {
  if (value instanceof Map) return new Map(value);
  if (value && typeof value === 'object') return new Map(Object.entries(value));
  return new Map();
}

/**
 * Valeurs RÉELLES d'un template. Lève si aucun résolveur n'est enregistré.
 *
 * @param {object} input
 * @param {string} input.templateId
 * @param {object} [input.context] { event, recipient, … }
 * @returns {Promise<Map<string, unknown>>}
 */
export async function resolveVariables({ templateId, context = {} }) {
  const resolver = RESOLVERS.get(templateId);
  if (!resolver) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      `Aucun résolveur de variables pour « ${templateId} ». ` +
        "Ce template n'est pas encore branché à un événement métier : aucun envoi n'est possible."
    );
  }
  return toMap(await resolver(context));
}

/**
 * Valeurs de DÉMONSTRATION — aperçu et envoi de test uniquement.
 *
 * Part des données d'exemple du registre (fictives, et clairement identifiées
 * comme telles : « Jean Dupont (exemple) », « exemple.fr »), puis applique la
 * surcharge du template s'il en déclare une.
 *
 * La surcharge existe pour un cas précis : `EMAIL_SENDER_VERIFICATION_TEST` doit
 * afficher le VRAI expéditeur et le VRAI mode. Y écrire « Mode Brevo : TEST »
 * alors que l'envoi part en PROD ferait mentir le seul e-mail dont la raison
 * d'être est de dire la vérité sur la configuration.
 *
 * @returns {Promise<Map<string, unknown>>}
 */
export default { resolveVariables, registerVariableResolver };

