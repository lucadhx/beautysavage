/**
 * ÉMISSION AUTOMATIQUE VERS LE PANEL — identité et contrat.
 *
 * ── CE QUE CE MODULE CHANGE ─────────────────────────────────────────────────
 * Jusqu'ici, le Panel n'apprenait l'identité d'un projet qu'à l'appairage ou
 * sur une action manuelle « Rafraîchir le Manifest ». Modifier un logo dans le
 * Manager n'avait donc AUCUN effet visible côté Panel tant qu'un humain n'y
 * pensait pas. Ce module fait remonter chaque modification, d'elle-même.
 *
 * ── ORDRE, ET POURQUOI IL COMPTE ────────────────────────────────────────────
 * validation → écriture métier réussie → mise en file → tentative d'envoi.
 * Jamais l'inverse : une panne du Panel ne doit pas empêcher un garagiste
 * d'enregistrer son numéro de téléphone. La file étant durable, l'envoi
 * finira par passer.
 *
 * ── REGROUPEMENT ────────────────────────────────────────────────────────────
 * Un formulaire qui écrit trois champs déclenche trois sauvegardes. On attend
 * donc un court instant avant de projeter : une seule photographie part, celle
 * de l'état final. Sans cela, le Panel recevrait trois versions dont deux
 * périmées — appliquées puis écrasées.
 */
import crypto from 'node:crypto';
import { recurrenceOf, describeRecurrence } from '../../utils/subscriptionRecurrence.js';
import { getSingleton } from '../../utils/singleton.js';
import { Company } from '../../models/Company.model.js';
import SystemConfiguration from '../../models/SystemConfiguration.model.js';
import Contract from '../../models/Contract.model.js';
import SiteStatus from '../../models/SiteStatus.model.js';
import { SITE_STATUS } from '../../utils/constants.js';
import { CONTRACT_STATUS } from '../../utils/contractConstants.js';
import logger from '../../utils/logger.js';
import { recordSyncIncident, SYNC_INCIDENT } from '../panelBridge/syncIncidents.js';
import { describeProjectPresentation } from './projectPresentation.service.js';
/** Le lecteur neutre : le bloc `yousign` n'est plus écrit, seulement lisible. */
import { signatureOf } from '../signature/signatureRecord.js';
import { inspectContractStorage } from '../contractDocument.service.js';
import { selectCurrentAndPreviousContracts } from './contractSelection.js';
import {
  declarationRevision,
  declaredTemplateCodes,
} from '../../utils/projectEmailTemplateUsage.js';
import { contractFingerprints, refreshContracts } from '../email/emailTemplateContract.service.js';
import { panelSpeaks } from '../panelBridge/capabilityClient.js';
import { config } from '../../config/env.js';
import { PanelRosterState } from '../../models/PanelRosterState.model.js';
import { isAcceptingWork, isShuttingDown, onDrain } from '../lifecycle/runtimeLifecycle.js';

/** Fenêtre de regroupement — assez courte pour rester « immédiat » à l'œil. */
const COALESCE_MS = 500;

/**
 * `entityId` STABLE du projet. La projection d'identité est un ÉTAT unique :
 * elle doit toujours porter le même identifiant, sinon le Panel accumulerait
 * une projection par sauvegarde au lieu d'en remplacer une seule.
 */
export function projectEntityId() {
  return deterministicUuid(`project:${config.projectName || 'projet'}`);
}

/** UUID stable dérivé d'une chaîne — le contrat exige un UUID, pas un slug. */
function deterministicUuid(seed) {
  const hex = crypto.createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* -------------------------------------------------------------------------- */
/*  PROJECTIONS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Photographie COMPLÈTE de l'identité publique. Réutilise intégralement la
 * projection du Lot 1a — résolution des médias, filtrage des contacts, URLs :
 * rien n'est redéfini ici.
 */
export async function buildPresentationProjection() {
  const [{ presentation = {}, urls = {} }, company, cfg] = await Promise.all([
    describeProjectPresentation(),
    getSingleton(Company),
    getSingleton(SystemConfiguration),
  ]);

  // Un champ absent s'OMET, il ne vaut pas `undefined`.
  //
  // La nuance a l'air théorique ; elle ne l'est pas. La file est persistée en
  // Mongo, et Mongoose écrit `undefined` comme `null` dans un payload `Mixed`.
  // Une clé posée à `undefined` était donc RELUE à `null`, puis refusée par le
  // Panel — dont le schéma attend une chaîne ou rien. Un projet sans
  // `PROJECT_NAME` ne pouvait ainsi jamais publier son identité, alors que son
  // contrat passait : lui n'a aucun champ optionnel construit de la sorte.
  const projectName = String(config.projectName ?? '').trim();
  const project = {
    ...(projectName.length > 0 ? { name: projectName } : {}),
    ...(presentation.tagline ? { description: presentation.tagline } : {}),
  };

  const payload = {
    ...presentation,
    ...(Object.keys(project).length > 0 ? { project } : {}),
    ...(Object.keys(urls).length > 0 ? { network: urls } : {}),
  };

  // `modifiedAt` = la plus récente des sources RÉELLEMENT utilisées. Prendre
  // l'heure courante ferait gagner n'importe quelle réémission contre une
  // écriture plus récente venue d'ailleurs.
  const dates = [company?.updatedAt, cfg?.updatedAt].filter(Boolean).map((d) => new Date(d).getTime());
  const modifiedAt = new Date(dates.length > 0 ? Math.max(...dates) : Date.now()).toISOString();

  return { entityType: 'PROJECT_PRESENTATION', entityId: projectEntityId(), payload, modifiedAt };
}


/**
 * ÉTAT D'ACCESSIBILITÉ DU SITE — un SNAPSHOT, et un agrégat à lui seul.
 *
 * ── CE QUE LE PANEL NE POUVAIT PAS SAVOIR ───────────────────────────────────
 * Cet état ne voyageait pas. Le Panel l'obtenait en interrogeant ce projet EN
 * DIRECT depuis l'écran, à chaque affichage de la carte : rien n'était
 * persisté, rien n'était daté, et un projet éteint rendait l'information
 * « inconnue » alors que la dernière valeur connue aurait suffi.
 *
 * ── CE QU'IL TRANSPORTE, ET POURQUOI DEUX CAUSES SÉPARÉES ───────────────────
 * `status` est DÉRIVÉ : il résume l'accessibilité. Mais deux causes
 * indépendantes peuvent la retirer — une maintenance TECHNIQUE, et l'absence
 * de contrat quand la protection est active. Publier le seul résumé forcerait
 * le Panel à deviner laquelle, et il devinerait faux un jour sur deux. On
 * publie donc le verdict ET sa cause.
 *
 * `contractProtectionEnabled` accompagne le tout : c'est un RÉGLAGE, pas une
 * conséquence, et il reste vrai même quand il ne produit aucun effet (un site
 * protégé dont le contrat est honoré est parfaitement accessible).
 */
export async function buildSiteStatusProjection() {
  const site = await getSingleton(SiteStatus);

  const payload = {
    // Le verdict.
    accessible: site?.status === SITE_STATUS.ACTIVE,
    status: site?.status ?? SITE_STATUS.ACTIVE,
    // La cause, nommée. `NONE` est une réponse : « rien ne suspend ce site ».
    suspensionSource: site?.suspensionSource ?? 'NONE',
    ...(site?.reason ? { reason: site.reason } : {}),
    ...(site?.suspendedAt ? { suspendedAt: new Date(site.suspendedAt).toISOString() } : {}),
    // Le réglage, indépendant de son effet.
    contractProtectionEnabled: Boolean(site?.contractProtectionEnabled),
    technicalSuspension: Boolean(site?.technicalSuspension?.active),

    /**
     * ══ L'INSTANTANÉ DES CAUSES — TOUTES, PAS SEULEMENT LA DOMINANTE (L10.6A)
     *
     * `suspensionSource` ne nomme QUE la cause qui prime à l'affichage. C'est
     * suffisant pour un écran, et faux pour une preuve.
     *
     * Le cas qui l'établit : une maintenance technique ET un impayé coexistent.
     * `accessible` vaut `false`, mais `suspensionSource` vaut `TECHNICAL` parce
     * que la maintenance est prioritaire. Un Panel qui conclurait de là que sa
     * cause financière n'a pas été appliquée se tromperait — elle l'est, elle
     * n'est simplement pas celle qu'on affiche.
     *
     * On publie donc les trois conditions séparément. Le Panel n'a plus à
     * déduire quoi que ce soit : il lit.
     *
     * ══ POURQUOI PAS UN NOUVEL ÉVÉNEMENT DE CONFIRMATION ═══════════════════
     *
     * Parce qu'il y aurait alors DEUX vérités — un événement de suspension et
     * l'état réel du site — et elles divergeraient au premier désordre de
     * livraison. L'état canonique sait déjà tout dire ; il lui manquait
     * seulement de le dire complètement.
     */
    causes: {
      technical: Boolean(site?.causes?.technical),
      /**
       * VRAI quand l'absence de contrat honoré SUSPEND réellement. Distinct de
       * `contractProtectionEnabled`, qui n'est qu'un réglage : un site protégé
       * dont le contrat est actif n'a aucune cause contractuelle.
       */
      contract: Boolean(site?.causes?.contract),
      paymentDefault: Boolean(site?.causes?.paymentDefault),
    },
  };

  /**
   * `modifiedAt` vient du document, jamais de l'horloge courante : une
   * réémission (réconciliation au démarrage, reconnexion) ne doit pas gagner
   * le dernier-écrit-gagne contre une écriture réellement plus récente.
   */
  const modifiedAt = new Date(site?.updatedAt ?? Date.now()).toISOString();
  return {
    entityType: 'PROJECT_SITE_STATUS',
    entityId: projectEntityId(),
    payload,
    modifiedAt,
  };
}

/**
 * MÉTADONNÉES du document contractuel — jamais le fichier.
 *
 * Le PDF vit dans le stockage PRIVÉ du projet (voir
 * `docs/panelXvitrine/DOCUMENT_CONTRACTUEL.md`). Le transporter dans le
 * payload ferait grossir la file de plusieurs mégaoctets par écriture, pour
 * une donnée que le Panel n'a pas vocation à détenir. Il reçoit donc de quoi
 * DIRE ce qui existe, et un chemin d'API pour aller le chercher quand un
 * humain le demande.
 *
 * Aucun chemin disque n'est publié : `downloadPath` est une route du projet,
 * authentifiée par le jeton de pont.
 */
async function describeDocument(contract) {
  const doc = contract.document ?? {};
  /**
   * LE BLOC DE SIGNATURE, LU PAR SON LECTEUR NEUTRE.
   *
   * Cette ligne lisait `contract.yousign` en dur. Depuis la bascule, ce bloc
   * n'est plus ÉCRIT : la projection annonçait donc `signatureStatus: 'NONE'`
   * pour tout contrat récent, et « GÉNÉRÉ » au lieu de « EN ATTENTE DE
   * SIGNATURE » — c'est-à-dire un Panel qui décrit un contrat au repos alors
   * qu'une signature est en cours chez de vraies personnes.
   */
  const signature = signatureOf(contract);
  const stockage = await inspectContractStorage(contract);

  // La BASE dit ce qui a été écrit ; le STOCKAGE dit ce qui existe. On croise
  // les deux, et l'on nomme la différence plutôt que de la taire.
  const refSigne = Boolean(doc.signedFilename);
  const refOriginal = Boolean(doc.originalFilename);
  const aSigne = stockage.signed.exists;
  const aOriginal = stockage.original.exists;

  if (!refSigne && !refOriginal) {
    return { available: false, status: 'NONE', downloadAvailable: false };
  }

  // Référencé mais introuvable : le fichier a disparu du stockage. Le dire
  // franchement vaut mieux que d'annoncer un téléchargement qui échouera.
  if (!aSigne && !aOriginal) {
    return {
      available: true,
      status: 'UNAVAILABLE',
      downloadAvailable: false,
      filename: `contrat-${contract.reference || contract._id}.pdf`,
      signatureRequired: contract.signatureRequirement !== 'NOT_REQUIRED',
    };
  }

  /**
   * SIGNATURE NON REQUISE — un état à part entière, pas une absence.
   *
   * Un contrat dont la signature n'est pas requise dans le parcours n'est ni
   * « en attente de signature », ni « signé » : il est GÉNÉRÉ, point. Sans
   * cette distinction, le Panel affichait « Généré, non signé » — une phrase
   * qui laisse croire qu'une signature manque.
   */
  const signatureRequise = contract.signatureRequirement !== 'NOT_REQUIRED';
  const signatureEnCours = signatureRequise && ['ONGOING', 'DRAFT'].includes(signature.status);
  const status = aSigne ? 'SIGNED' : signatureEnCours ? 'PENDING_SIGNATURE' : 'GENERATED';

  return {
    available: true,
    status,
    downloadAvailable: true,
    filename: `contrat-${contract.reference || contract._id}.pdf`,
    contentType: 'application/pdf',
    pages: doc.pageCount || 0,
    sha256: (aSigne ? doc.signedChecksum : doc.originalChecksum) || null,
    version: contract.signatureConfiguration?.version ?? 0,
    signatureRequired: signatureRequise,
    signatureStatus: signatureRequise ? (signature.status || 'NONE') : 'NOT_REQUIRED',
    generatedAt: horodatage(stockage.original.modifiedAt ?? contract.createdAt),
    signedAt: aSigne ? horodatage(doc.signedFetchedAt ?? stockage.signed.modifiedAt) : null,
    downloadPath: `/api/project-bridge/v1/contracts/${contract._id}/document`,
  };
}

const horodatage = (v) => (v ? new Date(v).toISOString() : null);

/**
 * `modifiedAt` du contrat — il doit BOUGER quand le document bouge.
 *
 * Sans cela, un document déposé sans autre modification du contrat produisait
 * la même version que la projection précédente : même `writeId`, donc rien de
 * remis en file, et le Panel refusait de toute façon une écriture qui n'était
 * pas plus récente que ce qu'il connaissait. La photographie était juste, elle
 * n'arrivait simplement jamais.
 *
 * On prend donc la plus récente des dates RÉELLES : celle du contrat, celle
 * des fichiers sur le stockage, celle de la signature.
 */
function contractModifiedAt(contract, stockage) {
  const dates = [
    contract.updatedAt,
    contract.document?.signedFetchedAt,
    stockage.original.modifiedAt,
    stockage.signed.modifiedAt,
  ].filter(Boolean).map((d) => new Date(d).getTime());
  return new Date(dates.length > 0 ? Math.max(...dates) : Date.now()).toISOString();
}

/**
 * CONTRAT COURANT — règle DÉTERMINISTE, et une seule.
 *
 * Le modèle autorise plusieurs contrats simultanés ; le métier n'en reconnaît
 * qu'un. On choisit donc, dans l'ordre : le contrat ACTIF, puis — à défaut —
 * le plus récemment modifié parmi ceux qui ne sont ni archivés ni annulés.
 * Aucun masquage : s'il existe deux contrats ACTIVE (situation que le métier
 * ne veut pas), le plus récent gagne et l'anomalie est journalisée.
 *
 * Aucun contrat pertinent → TOMBSTONE : le Panel efface sa projection plutôt
 * que d'afficher indéfiniment un contrat qui n'existe plus.
 */
export async function buildContractProjection() {
  const entityId = projectEntityId();
  const tous = await Contract.find({}).sort({ updatedAt: -1 }).lean();
  const { current, previous } = selectCurrentAndPreviousContracts(tous);

  if (current && previous.length === 0 && tous.filter((c) => c.status === CONTRACT_STATUS.ACTIVE).length > 1) {
    logger.warn('[sync] plusieurs contrats ACTIVE simultanés — le plus récent est projeté.');
  }

  // AUCUN contrat, ni courant ni passé : le Panel efface sa projection plutôt
  // que d'afficher indéfiniment un contrat qui n'existe plus.
  if (!current && previous.length === 0) {
    return {
      entityType: 'CONTRACT',
      entityId,
      deleted: true,
      payload: null,
      modifiedAt: new Date().toISOString(),
    };
  }

  const stockage = current ? await inspectContractStorage(current) : null;

  /**
   * LE COURANT ET L'HISTOIRE, dans la même photographie.
   *
   * Les champs de premier niveau décrivent le contrat ACTUEL — c'est ce que
   * lisent les écrans, et ce que lisaient déjà les versions précédentes.
   * `hasCurrentContract` dit franchement qu'il n'y en a pas, plutôt que de
   * laisser deviner par des champs absents. `previousContracts` porte
   * l'histoire, qui reste consultable et n'est jamais effacée.
   */
  const payload = {
    hasCurrentContract: Boolean(current),
    ...(current ? await describeCurrent(current, stockage) : {}),
    ...(previous.length > 0
      ? { previousContracts: await Promise.all(previous.map((c) => describePrevious(c))) }
      : {}),
  };

  return {
    entityType: 'CONTRACT',
    entityId,
    deleted: false,
    payload,
    modifiedAt: current
      ? contractModifiedAt(current, stockage)
      : contractModifiedAt(previous[0], await inspectContractStorage(previous[0])),
  };
}

/**
 * ══ POURQUOI LA RÉCURRENCE MONTE, ET SOUS QUELLE FORME ══════════════════════
 *
 * Le Panel ne se contente pas d'afficher ce montant : c'est LUI qui crée le
 * tarif Stripe, en lisant cette projection (`stripePriceAuthority`). Sans
 * l'intervalle, il ne pouvait fabriquer que du mensuel ou de l'annuel — un
 * contrat trimestriel signé ici serait devenu, chez le fournisseur, un
 * abonnement mensuel au montant du trimestre. Le client aurait payé trois fois
 * trop souvent, et rien dans le parcours ne l'aurait dit.
 *
 * `recurrence` est la forme qui fait foi. `interval` (l'UNITÉ, sous son ancien
 * nom) reste publié en miroir : un Panel non encore redéployé ne connaît que
 * lui, et cesser de l'envoyer effacerait la périodicité de ses écrans.
 * `recurrenceLabel` accompagne, pour que la grammaire ne soit pas réécrite de
 * l'autre côté du pont.
 *
 * L'ORDRE DE DÉPLOIEMENT en découle : le Panel accepte le nouveau champ AVANT
 * que le projet ne l'émette — sa validation d'entrée est stricte.
 */

/**
 * UN ENTIER DE CENTIMES, ou `null` — et `null` doit RESTER `null`.
 *
 * `Number(null)` vaut `0`, et `0 centime hors taxe` est une AFFIRMATION : elle
 * ferait échouer le contrôle d'addition du Panel avec « la ventilation ne
 * s'additionne pas » là où il faut dire « il n'y a pas de ventilation ». Les
 * deux refus n'envoient pas la même personne au même endroit.
 */
const centimes = (valeur) => (Number.isInteger(valeur) ? valeur : null);
const taux = (valeur) => (Number.isFinite(valeur) ? valeur : null);

/**
 * UN MONTANT PROJETÉ — TTC, **VENTILATION FISCALE**, et pour l'abonnement sa
 * RÉCURRENCE.
 *
 * ══ LE DÉFAUT QUE CETTE FONCTION A LONGTEMPS PORTÉ ══════════════════════════
 *
 * Elle ne publiait que le TTC. Le contrat de pont 1.10.0 a pourtant DÉCLARÉ
 * `amountExcludingTax`, `taxAmount` et `taxRate` — « la ventilation que
 * `computePricing` calcule DÉJÀ ici et que le projet gardait pour lui » — et
 * le Panel a été construit pour les lire. La moitié émettrice n'a jamais suivi.
 *
 * Conséquence, invisible jusqu'à ce qu'on facture : le Panel recevait
 * `amountExcludingTax: null` sur les deux lignes, et refusait d'ouvrir le
 * moindre paiement avec `CONTRACT_TAX_BREAKDOWN_ABSENT`. Ni les frais de
 * lancement ni l'abonnement n'étaient encaissables. Le refus était JUSTE — le
 * Panel ne devait pas inventer un taux — mais il désignait un projet à
 * redéployer alors que la donnée existait, complète et cohérente, en base.
 *
 * ══ ON LIT, ON NE RECALCULE PAS ═════════════════════════════════════════════
 *
 * `computePricing` a écrit ces trois nombres à l'enregistrement du contrat, et
 * c'est LUI l'autorité fiscale. Les recalculer ici en ferait une seconde :
 * deux chemins d'arrondi pour la même ligne finissent par diverger d'un
 * centime, et cet écart-là est le plus indéfendable qui soit — il oppose le
 * contrat SIGNÉ à la facture ÉMISE.
 *
 * On publie donc ce que le document porte, tel quel. Le Panel vérifie de son
 * côté que `HT + TVA = TTC` et que `TVA = arrondi(HT × taux)`, et REFUSE si
 * l'égalité est fausse. La cohérence reste bloquante : elle n'est ni réparée
 * ici, ni supposée là-bas.
 *
 * ══ POURQUOI L'ÉMISSION N'EST PAS CONDITIONNÉE ═════════════════════════════
 *
 * Les nouveautés du battement le sont (`panelSpeaks`), parce qu'un champ
 * inconnu y fait refuser le message ENTIER. Cette projection-ci porte DÉJÀ,
 * depuis 1.10.0 et sans garde, le `taxRate` du contrat : les trois champs de
 * ligne voyagent sur le même objet et n'ajoutent donc aucune exposition
 * nouvelle. Les conditionner seuls produirait exactement la forme qu'on
 * corrige — un taux qui arrive sans les montants qu'il qualifie.
 */
const money = (line, { withRecurrence = false } = {}) => {
  if (!line || !line.enabled) return undefined;
  const base = {
    amountIncludingTax: line.amountIncludingTax ?? null,
    currency: line.currency ?? null,
    /** La ventilation, LUE sur le contrat — jamais recalculée. Voir l'en-tête. */
    amountExcludingTax: centimes(line.amountExcludingTax),
    taxAmount: centimes(line.taxAmount),
    /** POURCENTAGE : 20 vaut 20 %, comme partout dans ce projet. */
    taxRate: taux(line.taxRate),
  };
  if (!withRecurrence) return base;

  const recurrence = recurrenceOf(line);
  return {
    ...base,
    recurrence,
    recurrenceLabel: describeRecurrence(recurrence),
    interval: recurrence.unit,
  };
};

function pricingOf(contract) {
  // Seul l'abonnement se répète : des frais de mise en service n'ont pas de
  // récurrence, et leur en publier une inviterait à en chercher le sens.
  const subscription = money(contract.pricing?.subscription, { withRecurrence: true });
  const launchFee = money(contract.pricing?.launchFee);
  const pricing = {
    ...(subscription ? { subscription } : {}),
    ...(launchFee ? { launchFee } : {}),
  };
  return Object.keys(pricing).length > 0 ? pricing : undefined;
}

const horodatageOu = (v) => (v ? new Date(v).toISOString() : null);

/** Le contrat ACTUEL — description complète, document compris. */
async function describeCurrent(contract, stockage) {
  void stockage;
  const pricing = pricingOf(contract);
  return {
    sourceContractId: String(contract._id),
    document: await describeDocument(contract),
    status: contract.status,
    reference: contract.reference || null,
    createdAt: horodatageOu(contract.createdAt),
    activatedAt: horodatageOu(contract.activation?.activatedAt),
    ...(pricing ? { pricing } : {}),
    /**
     * LE TAUX DE TVA EFFECTIF DU CONTRAT (L10.5).
     *
     * ══ POURQUOI IL MONTE AU PANEL ═══════════════════════════════════════
     *
     * Le Panel facture désormais des prestations ponctuelles, et il doit en
     * calculer la TVA. Sans ce champ, il n'aurait eu que deux mauvaises
     * options : inscrire 20 % en dur — inventer une fiscalité — ou débiter le
     * HT en l'appelant TTC. Le taux appartient au CONTRAT ; il fallait donc
     * qu'il voyage, pas qu'il soit dupliqué.
     *
     * ══ POURQUOI AU NIVEAU DU CONTRAT, ET NON DANS `pricing` ═════════════
     *
     * Les lignes de `pricing` portent chacune leur taux parce qu'elles
     * décrivent des engagements distincts. Une prestation ponctuelle n'est
     * aucune de ces lignes : elle relève du taux PAR DÉFAUT du contrat, celui
     * que le modèle nomme déjà « taux par défaut du contrat ».
     *
     * POURCENTAGE, comme partout dans ce projet (`computePricing`) : 20 vaut
     * 20 %. Changer cette convention en route aurait fait facturer 20 fois
     * trop, ou 2000 fois trop peu.
     */
    taxRate: Number.isFinite(contract.taxRate) ? contract.taxRate : null,
    /**
     * LE DÉLAI DE GRÂCE (L10.6B-1) — la politique commerciale du contrat.
     *
     * `null` traverse tel quel : il signifie « non configurée », et le Panel en
     * a besoin pour refuser de suspendre plutôt que de supposer un délai.
     */
    paymentGraceDays: Number.isInteger(contract.paymentGraceDays)
      ? contract.paymentGraceDays
      : null,
  };
}

/**
 * Un contrat PASSÉ — tout ce qu'il faut pour le consulter, rien d'inventé.
 *
 * Les dates de fin viennent de l'abonnement quand elles existent ; aucune n'est
 * fabriquée à partir d'une autre. Le motif de résiliation n'est pas publié :
 * le modèle n'en conserve aucun, et en déduire un serait mentir.
 */
async function describePrevious(contract) {
  const pricing = pricingOf(contract);
  const fin = contract.stripe?.subscription?.endedAt ?? contract.stripe?.subscription?.cancelledAt ?? null;
  return {
    sourceContractId: String(contract._id),
    status: contract.status,
    reference: contract.reference || null,
    createdAt: horodatageOu(contract.createdAt),
    activatedAt: horodatageOu(contract.activation?.activatedAt),
    endedAt: horodatageOu(fin),
    document: await describeDocument(contract),
    ...(pricing ? { pricing } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  DÉCLENCHEMENT                                                             */
/* -------------------------------------------------------------------------- */

// Le pont est INJECTÉ : ce module ne l'importe pas, pour ne pas créer de
// dépendance circulaire avec le runtime du pont.
let enqueue = null;
let requestFlush = null;

export function configureProjectSync({ enqueueProjection, flush } = {}) {
  if (enqueueProjection) enqueue = enqueueProjection;
  if (flush) requestFlush = flush;
}

/** Débranchement explicite — les tests repartent d'un état net. */
export function resetProjectSync() {
  enqueue = null;
  requestFlush = null;
}

/** Le module est-il branché ? (faux pendant les seeds et les migrations) */
/** La mémoire de la dernière déclaration ÉMISE — voir `declarationChanged`. */
const USAGE_ROSTER_KIND = 'EMAIL_TEMPLATE_USAGE';

/**
 * CETTE DÉCLARATION EST-ELLE NOUVELLE ? — et la réponse évite une écriture.
 *
 * ══ LE PROBLÈME QUE CETTE FONCTION RÉSOUT ══════════════════════════════════
 *
 * Toutes les autres projections datent d'un DOCUMENT : `site.updatedAt`,
 * `contract.updatedAt`. Rejouer une réconciliation reproduit donc exactement le
 * même `modifiedAt`, donc le même `writeId` déterministe, donc AUCUNE nouvelle
 * ligne dans la file — c'est le mécanisme de déduplication du pont, et il
 * fonctionne parce que l'horodatage vient de la donnée.
 *
 * La déclaration d'usage, elle, est DÉRIVÉE DU CODE : il n'y a pas de document,
 * donc pas d'`updatedAt`. Deux réflexes existent, tous deux mauvais :
 *
 *   · `Date.now()` → un `writeId` neuf à chaque démarrage. Tant que le Panel
 *     acquitte, cela ne se voit pas ; le jour où il REFUSE — un Panel plus
 *     ancien qui ignore l'entité — la file grossit d'une ligne par démarrage.
 *     Constaté en recette : 123 écritures identiques empilées ;
 *   · un horodatage dérivé du hachage → déterministe, mais NON MONOTONE : une
 *     nouvelle liste peut hacher plus bas que l'ancienne, et le dernier-écrit-
 *     gagne rejetterait alors la déclaration la plus récente. Silencieusement.
 *
 * On garde donc l'horloge réelle — un `modifiedAt` doit se lire — et l'on
 * n'ÉMET QUE SI LA LISTE A CHANGÉ. La mémoire de ce qui a été annoncé vit dans
 * `PanelRosterState`, dont c'est exactement la raison d'être : « la mémoire de
 * ce que le projet a annoncé ».
 */
async function declarationChanged(revision) {
  const connue = await PanelRosterState.findOne({ kind: USAGE_ROSTER_KIND }).lean();
  return (connue?.entityIds ?? [])[0] !== revision;
}

async function rememberDeclaration(revision) {
  await PanelRosterState.updateOne(
    { kind: USAGE_ROSTER_KIND },
    { $set: { kind: USAGE_ROSTER_KIND, entityIds: [revision], updatedAt: new Date() } },
    { upsert: true },
  );
}

/**
 * CE QUE CE PROJET UTILISE COMME MODÈLES D'E-MAIL — déclaré, jamais deviné.
 */
export async function buildEmailTemplateUsageProjection() {
  const templateCodes = declaredTemplateCodes();

  /**
   * L'EMPREINTE DU CONTRAT DE VARIABLES QUE CE PROJET SAIT SERVIR (L12.1).
   *
   * ── CE QU'ELLE REND POSSIBLE ────────────────────────────────────────────
   *
   * Le Panel est autorité du vocabulaire (quelles variables, lesquelles sont
   * obligatoires, de quel type) ; ce projet est autorité de la façon de
   * produire les valeurs. Rien ne reliait ces deux autorités : l'audit a
   * constaté qu'elles s'accordaient « par chance », et qu'une variable devenue
   * obligatoire aurait cassé tous les envois d'un projet déployé — au premier
   * e-mail, des semaines plus tard, sans avertissement.
   *
   * En renvoyant l'empreinte qu'il a LUE, le projet permet au Panel de
   * constater l'écart à la déclaration, c'est-à-dire avant tout envoi.
   *
   * ── POURQUOI IL LA TRANSPORTE AU LIEU DE LA CALCULER ────────────────────
   *
   * La recalculer supposerait de connaître la règle de hachage du Panel, donc
   * de la dupliquer, donc de pouvoir en diverger : on retrouverait deux vérités
   * là où ce lot n'en veut qu'une.
   */
  /**
   * ── ÉMISSION CONDITIONNÉE, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE ────────
   *
   * Les schémas d'entrée du Panel sont `.strict()`, et sa garde de version ne
   * vérifie que la MAJEURE. Un projet en 1.11 qui enverrait ce champ à un Panel
   * en 1.10 passerait donc la garde, puis verrait sa déclaration REFUSÉE EN
   * BLOC pour un champ inconnu — pas seulement le champ.
   *
   * La panne serait silencieuse et différée : la déclaration cesse d'être
   * acceptée, les instances du projet cessent de converger, et personne ne le
   * remarque avant qu'un modèle manque à l'envoi.
   *
   * On ne publie donc qu'à un Panel qui a ANNONCÉ savoir lire — ce qui rend
   * l'ordre de déploiement indifférent, au lieu de l'imposer.
   */
  /**
   * ── LE CONTRAT SE LIT ICI, ET PLUS SEULEMENT AU DÉMARRAGE (L12.1) ────────
   *
   * Il n'était lu qu'une fois, dans `initEmailModule`, pendant l'amorçage — au
   * moment précis où le pont n'est pas encore branché. Le déployé l'a dit noir
   * sur blanc : « contrat de variables non lu (NOT_PAIRED) ». Rien ne
   * réessayait ensuite : le cache restait vide à vie, aucune empreinte n'était
   * jamais transmise, et tout le contrôle de compatibilité restait inerte —
   * silencieusement, puisqu'une empreinte absente se lit `UNDECLARED` et non
   * comme une panne.
   *
   * Il se lit donc à l'instant où il SERT : quand la déclaration se construit.
   * `reconcileAll()` l'appelle au démarrage ET à chaque (ré)appairage, c'est-à-
   * dire toujours après que le pont soit debout. Une lecture au bon moment vaut
   * mieux qu'une lecture au plus tôt.
   *
   * Ne lève jamais : un contrat non lu dégrade la validation locale, il
   * n'empêche pas de se déclarer.
   */
  if (panelSpeaks(11)) await refreshContracts().catch(() => null);

  const empreintes = panelSpeaks(11)
    ? await contractFingerprints().catch(() => ({}))
    : {};
  const contractFingerprintsDeclarees = Object.fromEntries(
    Object.entries(empreintes).filter(([code]) => templateCodes.includes(code)),
  );

  return {
    entityType: 'PROJECT_EMAIL_TEMPLATE_USAGE',
    entityId: projectEntityId(),
    payload: {
      /** Les codes dont ce projet a besoin d'une instance à lui. TRIÉS. */
      templateCodes,
      /**
       * L'EMPREINTE DE LA LISTE — la seule chose qui décide d'un changement.
       * Triée avant hachage : l'ordre d'itération d'un registre ne doit pas
       * pouvoir produire une fausse nouveauté.
       */
      revision: declarationRevision(templateCodes, contractFingerprintsDeclarees),
      /** Quand ce projet l'a annoncé. Informatif ; `modifiedAt` arbitre. */
      declaredAt: new Date().toISOString(),
      /** L'empreinte du contrat servi par le Panel, par code. Voir ci-dessus. */
      contractFingerprints: contractFingerprintsDeclarees,
      /** La version logicielle qui porte cette liste — le code EST la source. */
      softwareVersion: config.softwareVersion ?? null,
    },
    modifiedAt: new Date().toISOString(),
  };
}

/**
 * RAPPORTE UN INCIDENT TECHNIQUE AU CONTROL PLANE (L12.1).
 *
 * ── POURQUOI CE N'EST PAS UNE « PROJECTION » ────────────────────────────────
 *
 * Les projections de ce module décrivent un ÉTAT : une seule entité par projet,
 * regroupée en rafales, remplacée par la suivante. Un incident est un FAIT
 * daté : il n'a pas de dernière valeur, et deux incidents ne s'écrasent pas.
 * Le passer par `scheduleProjection` aurait fait disparaître le premier
 * incident d'une rafale — précisément ceux qu'on veut voir.
 *
 * Il est donc mis en file directement, avec un `entityId` DÉRIVÉ DES FAITS :
 * même composant, même première observation, même palier d'occurrences ⇒ même
 * identité. Un rejeu converge, deux paliers distincts restent distincts.
 *
 * NE LÈVE JAMAIS : un incident qu'on n'arrive pas à rapporter ne doit pas
 * devenir un second incident.
 */
export async function reportPlatformIncident(incident, { eventId = null } = {}) {
  if (!isSyncWired()) return { queued: false, reason: 'SYNC_NOT_WIRED' };
  try {
    const identity = [
      incident?.kind,
      incident?.component,
      incident?.environment,
      incident?.firstSeenAt,
      incident?.occurrences,
    ].join('|');

    const change = {
      entityType: 'PLATFORM_INCIDENT',
      entityId: deterministicUuid(`incident:${identity}`),
      payload: {
        kind: incident.kind,
        component: String(incident.component ?? '').slice(0, 120),
        environment: incident.environment,
        occurrences: incident.occurrences,
        firstSeenAt: incident.firstSeenAt,
        error: {
          code: String(incident?.error?.code ?? '').slice(0, 80),
          message: String(incident?.error?.message ?? '').slice(0, 400),
        },
        ...(eventId ? { eventId: String(eventId).slice(0, 64) } : {}),
      },
      modifiedAt: new Date().toISOString(),
    };

    const res = await enqueue(change);
    if (typeof requestFlush === 'function') requestFlush();
    return res ?? { queued: false };
  } catch (err) {
    recordSyncIncident(
      SYNC_INCIDENT.PROJECTION_BUILD_FAILED,
      { step: 'reportPlatformIncident', entityType: 'PLATFORM_INCIDENT', reason: err?.code || err?.message },
      'warn',
    );
    return { queued: false, reason: err?.code ?? 'REPORT_FAILED' };
  }
}

export function isSyncWired() {
  return typeof enqueue === 'function';
}

const timers = {
  PROJECT_PRESENTATION: null,
  CONTRACT: null,
  SITE_STATUS: null,
  EMAIL_TEMPLATE_USAGE: null,
};

/**
 * Programme une projection, en regroupant les rafales. Ne lève JAMAIS et
 * n'attend jamais le réseau : la sauvegarde métier est déjà validée quand on
 * arrive ici, et rien de ce qui suit ne doit pouvoir la remettre en cause.
 *
 * ══ PENDANT L'ARRÊT, ON NE PROGRAMME PLUS RIEN ══════════════════════════════
 *
 * Un minuteur armé au moment où la base se ferme s'exécuterait APRÈS elle : la
 * construction échouerait, et l'échec serait enregistré comme une panne alors
 * que le système s'arrête normalement. Voir `runtimeLifecycle`.
 *
 * Ne rien programmer ne PERD rien : l'écriture métier est déjà persistée, et
 * `reconcileAll()` reconstruit la photographie complète au prochain démarrage.
 * L'arrêt diffère la projection, il ne l'annule pas.
 */
export function scheduleProjection(kind) {
  if (!isSyncWired()) return;
  if (!isAcceptingWork()) return;
  if (timers[kind]) return; // une rafale, une seule projection
  timers[kind] = setTimeout(() => {
    timers[kind] = null;
    void projectNow(kind);
  }, COALESCE_MS);
  timers[kind].unref?.();
}

/**
 * VIDANGE — ce qui était programmé part MAINTENANT, pendant que la base vit.
 *
 * Appelée à l'entrée en drainage. Une projection attendait sa fenêtre de
 * coalescence : plutôt que de la perdre au prochain démarrage, on la construit
 * et on la met en file tout de suite. Le minuteur est désarmé d'abord, pour
 * qu'il ne rejoue pas le même travail derrière nous.
 *
 * Ne lève jamais : un arrêt ne doit pas dépendre de la réussite d'une
 * projection — c'est justement ce que l'outbox durable rend inutile.
 */
export async function drainPendingProjections() {
  const enAttente = [];
  for (const kind of Object.keys(timers)) {
    if (!timers[kind]) continue;
    clearTimeout(timers[kind]);
    timers[kind] = null;
    enAttente.push(kind);
  }
  for (const kind of enAttente) {
    // eslint-disable-next-line no-await-in-loop
    await projectNow(kind).catch(() => null);
  }
  return { drained: enAttente };
}

/** Les projections encore en attente de leur fenêtre — observabilité et tests. */
export function pendingProjections() {
  return Object.keys(timers).filter((k) => timers[k] !== null);
}

/** Construit et met en file immédiatement — utilisé aussi à l'amorçage. */
export async function projectNow(kind) {
  if (!isSyncWired()) return { queued: false };
  try {
    const change = kind === 'CONTRACT'
      ? await buildContractProjection()
      : kind === 'SITE_STATUS'
        ? await buildSiteStatusProjection()
        : kind === 'EMAIL_TEMPLATE_USAGE'
          ? await buildEmailTemplateUsageProjection()
          : await buildPresentationProjection();

    /**
     * RIEN DE NEUF, RIEN À DIRE — voir `declarationChanged`. On sort AVANT la
     * mise en file : une écriture identique n'apprendrait rien au Panel et
     * s'accumulerait s'il la refusait.
     */
    if (kind === 'EMAIL_TEMPLATE_USAGE') {
      const nouvelle = await declarationChanged(change.payload.revision);
      if (!nouvelle) return { queued: false, unchanged: true };
    }

    const res = await enqueue(change);
    if (kind === 'EMAIL_TEMPLATE_USAGE' && res?.queued) {
      await rememberDeclaration(change.payload.revision);
    }
    /**
     * ── LA POUSSÉE EST DEMANDÉE MÊME SANS NOUVELLE MISE EN FILE ─────────────
     *
     * La condition était `res.queued`. Or l'outbox répond `queued: false`
     * quand un tombstone identique attend déjà — et surtout, une entrée déjà
     * PENDING d'une tentative précédente n'est signalée par personne. Dans ces
     * cas, plus rien ne réclamait de vidange : la file attendait le tic
     * périodique alors qu'elle avait de quoi partir tout de suite.
     *
     * Demander une poussée est de toute façon sans coût quand la file est
     * vide : `flushOutbox` sort immédiatement.
     */
    if (typeof requestFlush === 'function') requestFlush();
    return res ?? { queued: false };
  } catch (err) {
    /**
     * ── UN ARRÊT N'EST PAS UNE PANNE ────────────────────────────────────────
     *
     * Pendant le drainage, la connexion à la base se ferme : une construction
     * en cours échoue alors pour une raison parfaitement attendue. L'inscrire
     * comme incident durable apprendrait à ignorer `PROJECTION_BUILD_FAILED` —
     * et le jour où l'un d'eux est vrai, plus personne ne le lirait.
     *
     * On le dit quand même, mais pour ce que c'est : une trace d'arrêt. Rien
     * n'est perdu — l'écriture métier est persistée et `reconcileAll()`
     * reconstruira la projection au prochain démarrage.
     *
     * La condition porte sur l'ÉTAT DU RUNTIME, jamais sur l'environnement :
     * un `SIGTERM` de production traverse exactement le même chemin.
     */
    if (isShuttingDown()) {
      logger.info(`[sync] projection ${kind} abandonnée : arrêt en cours (rejouée au prochain démarrage).`);
      return { queued: false, abandonedOnShutdown: true };
    }
    recordSyncIncident(
      SYNC_INCIDENT.PROJECTION_BUILD_FAILED,
      { step: 'project', entityType: kind, reason: err.code || err.message },
      'error',
    );
    return { queued: false };
  }
}

/**
 * RÉCONCILIATION au démarrage — répare un trou éventuel entre une écriture
 * métier réussie et une mise en file qui aurait échoué. La file étant
 * idempotente (writeId déterministe), rejouer un état déjà connu ne crée rien.
 */
export async function reconcileAll() {
  await projectNow('PROJECT_PRESENTATION');
  await projectNow('CONTRACT');
  // L'état du site fait partie de la photographie complète : sans lui, un
  // Panel qui redémarre resterait sur le dernier statut qu'il avait reçu,
  // sans moyen de savoir s'il est encore vrai.
  await projectNow('SITE_STATUS');
  /**
   * LA DÉCLARATION D'USAGE FAIT PARTIE DE LA PHOTOGRAPHIE COMPLÈTE.
   *
   * Elle est ici, et pas dans un mécanisme à part, pour une raison précise :
   * `reconcileAll()` est appelé au démarrage ET à chaque (ré)appairage. Un
   * projet qui vient d'être appairé — un projet DUPLIQUÉ, par exemple — déclare
   * donc ce qu'il utilise dans le même geste que le reste de son état, sans
   * qu'aucun code d'appairage n'ait à connaître l'existence des e-mails.
   *
   * C'est ce qui rend la duplication muette sur le sujet : elle n'a rien à
   * provisionner, parce que le runtime appairé le déclare de lui-même.
   */
  await projectNow('EMAIL_TEMPLATE_USAGE');
}

/**
 * L'INSCRIPTION VIT ICI, pas dans `server.js`.
 *
 * Ce module sait ce qu'il a programmé ; le point d'entrée, non. Écrire
 * l'ordre d'extinction ailleurs qu'à côté du travail qu'il ferme, c'est
 * accepter qu'il devienne faux au premier ajout.
 */
onDrain(() => drainPendingProjections(), { label: 'projections en attente' });

export default {
  buildEmailTemplateUsageProjection,
  buildPresentationProjection,
  buildContractProjection,
  buildSiteStatusProjection,
  configureProjectSync,
  scheduleProjection,
  drainPendingProjections,
  pendingProjections,
  projectNow,
  reconcileAll,
  projectEntityId,
  isSyncWired,
};
